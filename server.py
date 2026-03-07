#!/usr/bin/env python3
"""
Slowed & Reverb Studio — Flask bridge server (optional)
Bridges the Spotify/YouTube CLI scripts for the web app.
Run: python server.py  (port 7337)
"""

import os
import sys
import json
import subprocess
from pathlib import Path
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

BASE = Path(__file__).parent / "downloaders"


def extract_tags(mp3_path):
    """Extract title and artist from MP3 ID3 tags using mutagen."""
    try:
        from mutagen.id3 import ID3
        tags = ID3(str(mp3_path))
        title = str(tags.get("TIT2", mp3_path.stem))
        artist = str(tags.get("TPE1", "Unknown"))
        return title, artist
    except Exception:
        return mp3_path.stem, "Unknown"


def run_script(script_dir, url):
    """Run a downloader script and return the new MP3 path."""
    downloads_dir = script_dir / "downloads"
    before = set(downloads_dir.glob("*.mp3")) if downloads_dir.exists() else set()

    venv_python = script_dir / ".venv" / "bin" / "python3"
    python = str(venv_python) if venv_python.exists() else sys.executable

    result = subprocess.run(
        [python, "main.py", url, "--headless"],
        cwd=str(script_dir),
        capture_output=True,
        text=True,
        timeout=300,
    )

    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "Script failed")

    after = set(downloads_dir.glob("*.mp3"))
    new_files = after - before
    if not new_files:
        raise RuntimeError("Script ran but no MP3 file was created")

    return sorted(new_files, key=lambda f: f.stat().st_mtime)[-1]


@app.route("/ping")
def ping():
    return "pong"


@app.route("/api/spotify", methods=["POST"])
def spotify():
    url = (request.json or {}).get("url", "")
    if not url:
        return jsonify({"error": "No URL provided"}), 400
    try:
        mp3_path = run_script(BASE / "spotify-to-mp3", url)
        title, artist = extract_tags(mp3_path)
        return jsonify({"file": str(mp3_path.resolve()), "title": title, "artist": artist})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/youtube", methods=["POST"])
def youtube():
    url = (request.json or {}).get("url", "")
    if not url:
        return jsonify({"error": "No URL provided"}), 400
    try:
        mp3_path = run_script(BASE / "youtube-to-mp3", url)
        title, artist = extract_tags(mp3_path)
        return jsonify({"file": str(mp3_path.resolve()), "title": title, "artist": artist})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/file")
def serve_file():
    path = request.args.get("path", "")
    if not path:
        return jsonify({"error": "No path provided"}), 400
    p = Path(path).resolve()
    # Safety: only serve MP3 files under the project base directory
    try:
        p.relative_to(BASE.resolve())
    except ValueError:
        return jsonify({"error": "Access denied"}), 403
    if not p.exists() or p.suffix.lower() != ".mp3":
        return jsonify({"error": "File not found"}), 404
    return send_file(str(p), mimetype="audio/mpeg")


if __name__ == "__main__":
    print("Slowed & Reverb Studio — bridge server")
    print("Listening on http://localhost:7337")
    app.run(host="127.0.0.1", port=7337, debug=False)
