#!/usr/bin/env python3
"""
Slowed & Reverb Studio — backend server
Runs on port 7337. Provides SSE-based download streaming and file serving.
"""

import base64
import html
import json
import os
import queue
import re
import secrets
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

from backend_utils import clean_error_message

from flask import Flask, Response, jsonify, request, send_file, send_from_directory, stream_with_context
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

STUDIO_DIR = Path(__file__).parent
DOWNLOADS_DIR = STUDIO_DIR / "downloads"
STATIC_DIR = STUDIO_DIR / "static"

# Load .env from project root so OAuth/status routes can read Spotify keys
# before any lazy imports run.
_env_file = STUDIO_DIR / ".env"
if _env_file.exists():
    for _line in _env_file.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))


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


def _save_env_key(key, value):
    """Add, update, or remove a key in the .env file."""
    env_path = STUDIO_DIR / ".env"
    lines = env_path.read_text().splitlines() if env_path.exists() else []
    found = False
    new_lines = []
    for line in lines:
        if line.strip().startswith(f"{key}="):
            if value is not None:
                new_lines.append(f"{key}={value}")
            found = True
        else:
            new_lines.append(line)
    if not found and value is not None:
        new_lines.append(f"{key}={value}")
    env_path.write_text("\n".join(new_lines) + ("\n" if new_lines else ""))


_oauth_state_lock = threading.Lock()
_oauth_states = {}
_OAUTH_STATE_TTL_SECONDS = 10 * 60


def _prune_oauth_states(now=None):
    now = time.time() if now is None else now
    expired = [s for s, expires_at in _oauth_states.items() if expires_at <= now]
    for s in expired:
        _oauth_states.pop(s, None)


def _spotify_redirect_uri():
    """Build the OAuth redirect URI, normalising localhost → 127.0.0.1 per Spotify's requirements."""
    host = request.host.replace('localhost', '127.0.0.1')
    return f"{request.scheme}://{host}/spotify/callback"


@app.route("/spotify/auth")
def spotify_auth():
    client_id = os.environ.get("SPOTIFY_CLIENT_ID", "")
    client_secret = os.environ.get("SPOTIFY_CLIENT_SECRET", "")
    if not client_id or not client_secret:
        return jsonify({
            "error": "SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be set in .env"
        }), 400
    redirect_uri = _spotify_redirect_uri()
    oauth_state = secrets.token_hex(16)
    with _oauth_state_lock:
        _prune_oauth_states()
        _oauth_states[oauth_state] = time.time() + _OAUTH_STATE_TTL_SECONDS
    params = urllib.parse.urlencode({
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "scope": "playlist-read-private playlist-read-collaborative",
        "state": oauth_state,
    })
    return jsonify({"url": f"https://accounts.spotify.com/authorize?{params}"})


@app.route("/spotify/callback")
def spotify_callback():
    error = request.args.get("error")
    if error:
        safe_error = html.escape(error)
        return (
            "<html><body><p>Auth failed: "
            f"{safe_error}"
            "</p><script>window.close();</script></body></html>"
        )
    state = request.args.get("state", "")
    with _oauth_state_lock:
        _prune_oauth_states()
        expires_at = _oauth_states.pop(state, None)
    if not state or not expires_at:
        return "Invalid state", 400
    code = request.args.get("code", "")
    client_id = os.environ.get("SPOTIFY_CLIENT_ID", "")
    client_secret = os.environ.get("SPOTIFY_CLIENT_SECRET", "")
    if not client_id or not client_secret:
        return (
            "<html><body><p>Spotify OAuth is not configured correctly on this server.</p>"
            "<script>window.close();</script></body></html>"
        ), 500
    if not code:
        return (
            "<html><body><p>Spotify did not return an authorization code.</p>"
            "<script>window.close();</script></body></html>"
        ), 400
    redirect_uri = _spotify_redirect_uri()
    creds = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    data = urllib.parse.urlencode({
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
    }).encode()
    req = urllib.request.Request(
        "https://accounts.spotify.com/api/token",
        data=data,
        headers={"Authorization": f"Basic {creds}"},
    )
    try:
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read())
    except Exception:
        app.logger.exception("Spotify token exchange failed")
        return (
            "<html><body><p>Could not complete Spotify authorization. "
            "Please try again.</p><script>window.close();</script></body></html>"
        ), 500
    if result.get("error"):
        app.logger.error("Spotify token endpoint returned error: %s", result.get("error"))
        return (
            "<html><body><p>Spotify authorization failed. Please try again.</p>"
            "<script>window.close();</script></body></html>"
        ), 400
    refresh_token = result.get("refresh_token", "")
    if not refresh_token:
        app.logger.error("Spotify token response did not include refresh_token")
        return (
            "<html><body><p>Spotify did not return a refresh token. "
            "Please reconnect and ensure your app settings are correct.</p>"
            "<script>window.close();</script></body></html>"
        ), 400
    _save_env_key("SPOTIFY_REFRESH_TOKEN", refresh_token)
    os.environ["SPOTIFY_REFRESH_TOKEN"] = refresh_token
    return """<html><head><title>Spotify Connected</title></head><body>
<p style="font-family:sans-serif;padding:20px">Spotify connected! You can close this window.</p>
<script>window.close();</script>
</body></html>"""


@app.route("/spotify/status")
def spotify_status():
    connected = bool(os.environ.get("SPOTIFY_REFRESH_TOKEN", ""))
    return jsonify({
        "connected": connected,
        "callback_url": _spotify_redirect_uri(),
    })


@app.route("/spotify/disconnect", methods=["POST"])
def spotify_disconnect():
    _save_env_key("SPOTIFY_REFRESH_TOKEN", None)
    os.environ.pop("SPOTIFY_REFRESH_TOKEN", None)
    return jsonify({"ok": True})


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
            _apply_album_match_video_ids,
        )
        if "spotify.com" in url:
            from studio_downloader import has_spotify_oauth, _spotify_user_token
            is_playlist = bool(re.search(r'spotify\.com/playlist/', url))
            if is_playlist:
                if not has_spotify_oauth():
                    return jsonify({"error": "spotify_auth_required"}), 403
                token = _spotify_user_token()
            else:
                token = _spotify_token()
            tracks, meta = _get_spotify_tracks(url, token)
            if meta.get("type") == "album":
                _apply_album_match_video_ids(tracks, meta)
            return jsonify({
                "name": meta.get("name", ""),
                "type": meta.get("type", "spotify_playlist"),
                "image_url": meta.get("image_url"),
                "youtube_url": meta.get("youtube_url"),
                "tracks": [
                    {
                        "index": i,
                        "name": t["name"],
                        "artist": t.get("artist", ""),
                        "album": t.get("album", ""),
                        "duration_ms": t.get("duration_ms", 0),
                        "image_url": t.get("image_url"),
                        "spotify_url": t.get("spotify_url"),
                        "video_id": t.get("video_id"),
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
                "youtube_url": url,
                "tracks": tracks,
            })
        else:
            return jsonify({"error": "URL is not a supported playlist"}), 400
    except Exception as e:
        msg = clean_error_message(str(e))
        if (
            msg == "spotify_auth_required"
            or "Failed to refresh Spotify token" in msg
            or "Spotify API 401" in msg
        ):
            return jsonify({"error": "spotify_auth_required"}), 403
        if "Spotify API 403" in msg:
            return jsonify({
                "error": (
                    "Spotify denied playlist track access. Reconnect Spotify, "
                    "then try a playlist your account can access."
                )
            }), 403
        if "Spotify API 404" in msg:
            return jsonify({
                "error": "Spotify couldn't find that playlist for your account."
            }), 404
        if msg in ("Invalid Spotify URL", "Playlist is empty"):
            return jsonify({"error": msg}), 400
        return jsonify({"error": msg}), 500


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
