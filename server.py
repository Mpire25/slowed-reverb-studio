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

_ANSI_RE = re.compile(r'\x1b\[[0-9;]*[A-Za-z]')
_YTDLP_PREFIX_RE = re.compile(r'^(ERROR|WARNING):\s*(\[[^\]]+\]\s*)?', re.IGNORECASE)

def _clean(msg: str) -> str:
    msg = _ANSI_RE.sub('', msg).strip()
    # Take only the first line (yt-dlp sometimes appends stack traces)
    msg = msg.splitlines()[0].strip() if msg else msg
    # Strip "ERROR: [extractor] " prefix from yt-dlp messages
    msg = _YTDLP_PREFIX_RE.sub('', msg).strip()
    return msg

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


def extract_tags(mp3_path):
    try:
        from mutagen.id3 import ID3
        tags = ID3(str(mp3_path))
        title = str(tags.get("TIT2", Path(mp3_path).stem))
        artist = str(tags.get("TPE1", "Unknown"))
        return title, artist
    except Exception:
        return Path(mp3_path).stem, "Unknown"


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
        return jsonify({"error": _clean(str(e))}), 500


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
            on_event("error", {"message": _clean(str(e))})
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
