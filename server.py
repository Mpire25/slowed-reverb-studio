#!/usr/bin/env python3
"""
Slowed & Reverb Studio — backend server
Runs on port 7337. Provides SSE-based download streaming and file serving.
"""

import json
import os
import queue
import re
import threading
import time
from pathlib import Path

from backend_utils import clean_error_message

from flask import Flask, Response, jsonify, request, send_file, send_from_directory, stream_with_context
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

STUDIO_DIR = Path(__file__).parent
DOWNLOADS_DIR = STUDIO_DIR / "downloads"
STATIC_DIR = STUDIO_DIR / "static"


CLEANUP_INTERVAL = 30 * 60  # seconds between periodic sweeps
CLEANUP_MAX_AGE  = 60 * 60  # files older than this are deleted


def cleanup_downloads(max_age=None):
    """Delete orphaned MP3s from the downloads directory.
    If max_age is None, deletes all MP3s (used at startup).
    """
    if not DOWNLOADS_DIR.exists():
        return
    now = time.time()
    for f in DOWNLOADS_DIR.glob("*.mp3"):
        if max_age is None or (now - f.stat().st_mtime) > max_age:
            try:
                f.unlink()
            except OSError:
                pass


def _cleanup_loop():
    while True:
        time.sleep(CLEANUP_INTERVAL)
        cleanup_downloads(max_age=CLEANUP_MAX_AGE)


# Delete any leftover files from a previous server run, then start background sweeper
cleanup_downloads()
threading.Thread(target=_cleanup_loop, daemon=True).start()


def _sse(event_type, data):
    return f"event: {event_type}\ndata: {json.dumps(data)}\n\n"


_ytmusic = None

def _get_ytmusic():
    global _ytmusic
    if _ytmusic is None:
        from ytmusicapi import YTMusic
        _ytmusic = YTMusic()
    return _ytmusic


@app.route("/ping")
def ping():
    return "pong"


@app.route("/api/search")
def search():
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify({"error": "No query"}), 400
    try:
        yt = _get_ytmusic()
        results = yt.search(q, filter="songs", limit=8)
        out = []
        for r in results:
            out.append({
                "videoId": r.get("videoId"),
                "title": r.get("title", ""),
                "artist": r["artists"][0]["name"] if r.get("artists") else "",
                "duration": r.get("duration", ""),
                "thumbnail": r["thumbnails"][-1]["url"] if r.get("thumbnails") else None,
            })
        return jsonify(out)
    except Exception as e:
        return jsonify({"error": clean_error_message(str(e))}), 500


@app.route("/api/playlist/info")
def playlist_info():
    """
    Fetch playlist metadata (no download).
    Returns JSON: {name, type, image_url, tracks:[{index,name,artist,duration_ms,image_url,video_id?}]}
    """
    url = request.args.get("url", "").strip()
    if not url:
        return jsonify({"error": "No URL provided"}), 400

    # Block regular YouTube playlists (not YouTube Music)
    is_ytmusic = "music.youtube.com" in url and "list=" in url
    is_yt_playlist = (
        re.search(r'(youtube\.com|youtu\.be)', url)
        and "list=" in url
        and not is_ytmusic
    )
    if is_yt_playlist:
        return jsonify({
            "error": "Regular YouTube playlists aren't supported — use music.youtube.com"
        }), 400

    try:
        from studio_downloader import (
            get_youtube_playlist_tracks,
            is_youtube_music_playlist,
            _get_spotify_tracks,
            _spotify_token,
        )
        if "spotify.com" in url:
            token = _spotify_token()
            tracks, meta = _get_spotify_tracks(url, token)
            return jsonify({
                "name": meta.get("name", ""),
                "type": meta.get("type", "spotify_playlist"),
                "image_url": meta.get("image_url"),
                "tracks": [
                    {
                        "index": i,
                        "name": t["name"],
                        "artist": t.get("artist", ""),
                        "album": t.get("album", ""),
                        "duration_ms": t.get("duration_ms", 0),
                        "image_url": t.get("image_url"),
                    }
                    for i, t in enumerate(tracks)
                ],
            })
        elif is_youtube_music_playlist(url):
            tracks, meta = get_youtube_playlist_tracks(url)
            return jsonify({
                "name": meta.get("name", "Playlist"),
                "type": meta.get("type", "ytmusic_playlist"),
                "image_url": meta.get("image_url"),
                "tracks": tracks,
            })
        else:
            return jsonify({"error": "URL is not a supported playlist"}), 400
    except Exception as e:
        return jsonify({"error": clean_error_message(str(e))}), 500


@app.route("/api/download/track")
def download_track():
    """
    SSE endpoint — download a single track by metadata JSON.
    Query param: track_data (URL-encoded JSON with name, artist, album, duration_ms, image_url, video_id, index)
    Emits same events as /api/download/stream: stage, progress, found, complete, error
    """
    track_data_str = request.args.get("track_data", "").strip()
    if not track_data_str:
        return jsonify({"error": "No track_data provided"}), 400

    try:
        track = json.loads(track_data_str)
    except json.JSONDecodeError:
        return jsonify({"error": "Invalid track_data JSON"}), 400

    q = queue.Queue()

    def on_event(event_type, data):
        q.put((event_type, data))

    def run():
        try:
            from studio_downloader import _download_track
            mp3_path = _download_track(track, on_event)
            on_event("complete", {
                "file": str(mp3_path),
                "title": track.get("name", ""),
                "artist": track.get("artist", ""),
            })
        except Exception as e:
            on_event("error", {"message": clean_error_message(str(e))})
        finally:
            q.put(None)

    thread = threading.Thread(target=run, daemon=True)
    thread.start()

    def generate():
        while True:
            item = q.get()
            if item is None:
                break
            event_type, data = item
            yield _sse(event_type, data)

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.route("/api/download/stream")
def download_stream():
    """
    SSE endpoint — streams download progress as events.
    Query param: url (YouTube or Spotify)

    Event types emitted:
      stage         — {stage, message}
      metadata      — {name, artist, duration, image_url, total_tracks, tracks, type}
      found         — {youtube_url, query, fallback}
      progress      — {percent, stage}
      track_start   — {index, total, title, artist}
      track_complete— {index, total, file, title, artist}
      track_error   — {index, title, error}
      complete      — {file, title, artist}  or  {files, title}
      error         — {message}
    """
    url = request.args.get("url", "").strip()
    if not url:
        return jsonify({"error": "No URL provided"}), 400

    q = queue.Queue()

    def on_event(event_type, data):
        q.put((event_type, data))

    def run():
        try:
            from studio_downloader import download_spotify, download_youtube
            if "spotify.com" in url:
                results, meta = download_spotify(url, on_event)
                on_event("complete", {
                    "files": [str(p) for p in results],
                    "file": str(results[0]),
                    "title": meta.get("name", ""),
                    "artist": meta.get("artist", ""),
                })
            else:
                mp3_path, info = download_youtube(url, on_event)
                on_event("complete", {
                    "file": str(mp3_path),
                    "title": info["title"],
                    "artist": info["artist"],
                })
        except Exception as e:
            on_event("error", {"message": clean_error_message(str(e))})
        finally:
            q.put(None)  # sentinel

    thread = threading.Thread(target=run, daemon=True)
    thread.start()

    def generate():
        while True:
            item = q.get()
            if item is None:
                break
            event_type, data = item
            yield _sse(event_type, data)

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.route("/api/file")
def serve_file():
    path = request.args.get("path", "")
    consume = request.args.get("consume", "").strip().lower() in {"1", "true", "yes"}
    if not path:
        return jsonify({"error": "No path provided"}), 400
    p = Path(path).resolve()
    # Allow files anywhere under the studio directory
    try:
        p.relative_to(STUDIO_DIR.resolve())
    except ValueError:
        return jsonify({"error": "Access denied"}), 403
    if not p.exists() or p.suffix.lower() != ".mp3":
        return jsonify({"error": "File not found"}), 404

    if not consume:
        return send_file(str(p), mimetype="audio/mpeg")

    # Stream file manually so cleanup happens deterministically after transfer.
    def generate_and_cleanup():
        try:
            with p.open("rb") as f:
                while True:
                    chunk = f.read(64 * 1024)
                    if not chunk:
                        break
                    yield chunk
        finally:
            try:
                p.unlink()
            except FileNotFoundError:
                pass

    return Response(
        stream_with_context(generate_and_cleanup()),
        mimetype="audio/mpeg",
        headers={"Cache-Control": "no-cache"},
    )


@app.route("/")
def index():
    return send_from_directory(str(STATIC_DIR), "index.html")


@app.route("/<path:filename>")
def static_files(filename):
    return send_from_directory(str(STATIC_DIR), filename)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 7337))
    print("Slowed & Reverb Studio — server")
    print(f"Open http://localhost:{port} in your browser")
    app.run(host="127.0.0.1", port=port, debug=False, threaded=True, use_reloader=True)
