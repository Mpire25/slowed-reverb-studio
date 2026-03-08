#!/usr/bin/env python3
"""
Slowed & Reverb Studio — integrated download engine
Handles YouTube and Spotify downloads with live progress callbacks.
No CLI, no Finder, no subprocesses — runs directly in the Flask server.
"""

import os
import re
import json
import base64
import urllib.request
import urllib.parse
from pathlib import Path

import yt_dlp
from mutagen.id3 import ID3, APIC, TIT2, TPE1, TALB, ID3NoHeaderError

STUDIO_DIR = Path(__file__).parent
DOWNLOADS_DIR = STUDIO_DIR / "downloads"

# Load .env from studio directory
_env_file = STUDIO_DIR / ".env"
if _env_file.exists():
    for _line in _env_file.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))


def safe_filename(s):
    return re.sub(r'[<>:"/\\|?*]', '', s).strip()


# ── Spotify API ────────────────────────────────────────────────────────────────

def _spotify_token():
    client_id = os.environ.get("SPOTIFY_CLIENT_ID", "")
    client_secret = os.environ.get("SPOTIFY_CLIENT_SECRET", "")
    if not client_id or not client_secret:
        raise RuntimeError(
            "Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env "
            "(get free credentials at developer.spotify.com/dashboard)"
        )
    creds = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    data = urllib.parse.urlencode({"grant_type": "client_credentials"}).encode()
    req = urllib.request.Request(
        "https://accounts.spotify.com/api/token",
        data=data,
        headers={"Authorization": f"Basic {creds}"},
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())["access_token"]


def _spotify_get(path, token):
    req = urllib.request.Request(
        f"https://api.spotify.com/v1{path}",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def _get_spotify_tracks(url, token):
    """Returns (tracks_list, meta_dict)."""
    m = re.search(r'spotify\.com/(track|album|playlist)/([A-Za-z0-9]+)', url)
    if not m:
        raise ValueError("Invalid Spotify URL")
    kind, sid = m.group(1), m.group(2)

    if kind == "track":
        data = _spotify_get(f"/tracks/{sid}", token)
        artist = data["artists"][0]["name"]
        album = data.get("album", {}).get("name", "")
        images = data.get("album", {}).get("images", [])
        track = {
            "name": data["name"],
            "artist": artist,
            "album": album,
            "duration_ms": data["duration_ms"],
            "image_url": images[0]["url"] if images else None,
        }
        return [track], {"name": data["name"], "artist": artist, "type": "track",
                         "image_url": track["image_url"]}

    elif kind == "album":
        data = _spotify_get(f"/albums/{sid}", token)
        artist = data["artists"][0]["name"]
        album_name = data["name"]
        images = data.get("images", [])
        image_url = images[0]["url"] if images else None
        tracks = [
            {
                "name": t["name"],
                "artist": artist,
                "album": album_name,
                "duration_ms": t["duration_ms"],
                "image_url": image_url,
            }
            for t in data["tracks"]["items"]
        ]
        return tracks, {"name": album_name, "artist": artist, "type": "album",
                        "image_url": image_url}

    else:  # playlist
        data = _spotify_get(f"/playlists/{sid}?fields=name,tracks.total", token)
        total = data["tracks"]["total"]
        tracks = []
        offset = 0
        while offset < total:
            page = _spotify_get(
                f"/playlists/{sid}/tracks"
                f"?fields=items(track(name,duration_ms,artists,album(name,images)))&limit=50&offset={offset}",
                token,
            )
            for item in page["items"]:
                t = item.get("track")
                if t and t.get("name"):
                    images = t.get("album", {}).get("images", [])
                    tracks.append({
                        "name": t["name"],
                        "artist": t["artists"][0]["name"] if t.get("artists") else "Unknown",
                        "album": t.get("album", {}).get("name", ""),
                        "duration_ms": t.get("duration_ms", 0),
                        "image_url": images[0]["url"] if images else None,
                    })
            offset += 50
        first_image = tracks[0]["image_url"] if tracks else None
        return tracks, {"name": data["name"], "type": "playlist",
                        "image_url": first_image}


# ── YouTube Music search ───────────────────────────────────────────────────────

_JUNK_KEYWORDS = re.compile(
    r'\b(remix|remaster|re-?master|cover|karaoke|instrumental|backing|tribute|version|edit|re-?edit|bootleg|mashup|acoustic|live)\b',
    re.IGNORECASE,
)


def _core_title(s):
    """Strip bracketed/parenthesised content and normalise."""
    s = re.sub(r'\[.*?\]', '', s)
    s = re.sub(r'\(.*?\)', '', s)
    return re.sub(r'[^\w\s]', '', s.lower()).strip()


def _strip_artist_prefix(title, artist):
    """Strip 'Artist - ' prefix from YouTube-style titles."""
    for sep in [' - ', ': ', ' — ']:
        idx = title.lower().find(sep)
        if idx > 0 and _core_title(artist) in _core_title(title[:idx]):
            return title[idx + len(sep):]
    return title


def _score_result(result, expected_title, expected_artist, duration_s):
    """Return a confidence score 0–100 for a YouTube Music/YouTube result."""
    result_title = result.get("title", "")
    vid_duration = result.get("duration_seconds") or 0

    # Title: exact core match only — no partial credit (avoids "Kiss" matching "Kiss Me Again")
    # Also try stripping "Artist - " prefix for YouTube-style titles
    core_exp = _core_title(expected_title)
    core_res = _core_title(result_title)
    if core_exp != core_res:
        core_res = _core_title(_strip_artist_prefix(result_title, expected_artist))
    title_score = 40 if core_exp == core_res else 0

    # Artist: check any result artist contains expected artist name
    result_artists = " ".join(
        a.get("name", "") for a in (result.get("artists") or [])
    ).lower()
    artist_score = 30 if _core_title(expected_artist) in result_artists else 0

    # Duration: within 2s = 30pts, within 10s = 20pts, within 20s = 10pts
    diff = abs(vid_duration - duration_s)
    if diff <= 2:
        dur_score = 30
    elif diff <= 10:
        dur_score = 20
    elif diff <= 20:
        dur_score = 10
    else:
        dur_score = 0

    # Junk penalty — skip if the expected title is itself a remix/etc
    expected_is_junk = bool(_JUNK_KEYWORDS.search(expected_title))
    junk_penalty = 0 if expected_is_junk else (-20 if _JUNK_KEYWORDS.search(result_title) else 0)

    return title_score + artist_score + dur_score + junk_penalty


_DEBUG_LOG = STUDIO_DIR / "search_debug.log"


def _dlog(msg):
    print(msg)
    with open(_DEBUG_LOG, "a", encoding="utf-8") as f:
        f.write(msg + "\n")


def _find_youtube_id(track):
    """Search YouTube Music, fall back to YouTube search if confidence is low."""
    from ytmusicapi import YTMusic
    query = f"{track['artist']} - {track['name']}"
    duration_s = track["duration_ms"] // 1000
    _dlog(f"\n{'='*60}\n[search] query={query!r} duration={duration_s}s")

    best_id = None
    best_score = 0
    best_is_junk = False
    any_title_match = False

    try:
        ytm = YTMusic()
        results = ytm.search(query, filter="songs", limit=20)
        for result in results:
            score = _score_result(result, track["name"], track["artist"], duration_s)
            _dlog(f"  ytmusic: {result.get('title')!r} dur={result.get('duration_seconds')}s score={score}")
            if _core_title(result.get("title", "")) == _core_title(track["name"]):
                any_title_match = True
            if score > best_score:
                best_score = score
                best_id = result["videoId"]
                best_is_junk = bool(_JUNK_KEYWORDS.search(result.get("title", "")))
    except Exception as e:
        _dlog(f"[search] YTMusic ERROR: {e}")

    # Fall back to YouTube if: low confidence, best is junk, or no title match at all
    if best_score < 50 or best_is_junk or not any_title_match:
        _dlog(f"  [low confidence={best_score}] falling back to YouTube search")
        try:
            with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True}) as ydl:
                info = ydl.extract_info(f"ytsearch5:{query}", download=False)
                for entry in (info.get("entries") or []):
                    fake_result = {
                        "title": entry.get("title", ""),
                        "artists": [{"name": entry.get("uploader", "")}],
                        "duration_seconds": entry.get("duration") or 0,
                        "videoId": entry.get("id"),
                    }
                    score = _score_result(fake_result, track["name"], track["artist"], duration_s)
                    _dlog(f"  youtube: {fake_result['title']!r} dur={fake_result['duration_seconds']}s score={score}")
                    if score > best_score:
                        best_score = score
                        best_id = fake_result["videoId"]
        except Exception as e:
            _dlog(f"[search] YouTube fallback ERROR: {e}")

    _dlog(f"  [chosen] id={best_id} score={best_score}")
    return best_id


# ── Art & tag embedding ────────────────────────────────────────────────────────

def _embed_tags(mp3_path, track):
    try:
        tags = ID3(str(mp3_path))
    except ID3NoHeaderError:
        tags = ID3()

    if track.get("name"):
        tags.add(TIT2(encoding=3, text=track["name"]))
    if track.get("artist"):
        tags.add(TPE1(encoding=3, text=track["artist"]))
    if track.get("album"):
        tags.add(TALB(encoding=3, text=track["album"]))

    image_url = track.get("image_url")
    if image_url:
        try:
            with urllib.request.urlopen(image_url) as resp:
                image_data = resp.read()
            tags.delall("APIC")
            tags.add(APIC(encoding=3, mime="image/jpeg", type=3,
                          desc="Cover", data=image_data))
        except Exception:
            pass

    tags.save(str(mp3_path))


# ── yt-dlp options ─────────────────────────────────────────────────────────────

def _make_ydl_opts(output_template, on_event):
    def progress_hook(d):
        if d["status"] == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate", 0)
            downloaded = d.get("downloaded_bytes", 0)
            if total > 0:
                pct = (downloaded / total) * 100
                on_event("progress", {"percent": round(pct, 1), "stage": "downloading"})
        elif d["status"] == "finished":
            on_event("stage", {"stage": "converting", "message": "Converting to MP3…"})

    return {
        "format": "bestaudio/best",
        "outtmpl": output_template,
        "postprocessors": [
            {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}
        ],
        "quiet": True,
        "no_warnings": True,
        "progress_hooks": [progress_hook],
        "extractor_args": {"youtube": {"player_client": ["android", "web"]}},
    }


# ── Single track download (Spotify flow) ──────────────────────────────────────

def _download_track(track, on_event):
    DOWNLOADS_DIR.mkdir(exist_ok=True)
    query = f"{track['artist']} - {track['name']}"
    filename = safe_filename(query)
    output = str(DOWNLOADS_DIR / f"{filename}.%(ext)s")

    on_event("stage", {"stage": "searching",
                        "message": f"Searching YouTube Music for {query}…"})

    video_id = _find_youtube_id(track)
    if video_id:
        source = f"https://www.youtube.com/watch?v={video_id}"
        on_event("found", {"youtube_url": source, "query": query, "fallback": False})
    else:
        source = f"ytsearch1:{query}"
        on_event("found", {"youtube_url": None, "query": query, "fallback": True})

    on_event("stage", {"stage": "downloading", "message": "Downloading…"})

    with yt_dlp.YoutubeDL(_make_ydl_opts(output, on_event)) as ydl:
        ydl.download([source])

    mp3_path = DOWNLOADS_DIR / f"{filename}.mp3"
    if not mp3_path.exists():
        raise RuntimeError(f"MP3 not found after download: {filename}")

    on_event("stage", {"stage": "embedding", "message": "Embedding metadata & art…"})
    _embed_tags(str(mp3_path), track)
    on_event("progress", {"percent": 100, "stage": "embedding"})

    return mp3_path


# ── Public API ─────────────────────────────────────────────────────────────────

def download_youtube(url, on_event):
    """
    Download a YouTube URL. Calls on_event(type, data) throughout.
    Returns (mp3_path, {title, artist}).
    """
    DOWNLOADS_DIR.mkdir(exist_ok=True)

    on_event("stage", {"stage": "fetching_metadata", "message": "Fetching video info…"})

    with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True}) as ydl:
        info = ydl.extract_info(url, download=False)

    title = info.get("title", "Unknown")
    uploader = info.get("uploader", "Unknown")
    duration = info.get("duration", 0)
    thumbnail = info.get("thumbnail")

    on_event("metadata", {
        "name": title,
        "artist": uploader,
        "duration": duration,
        "image_url": thumbnail,
        "total_tracks": 1,
        "type": "youtube",
    })

    filename = safe_filename(title)
    output = str(DOWNLOADS_DIR / f"{filename}.%(ext)s")

    on_event("stage", {"stage": "downloading", "message": "Downloading…"})

    with yt_dlp.YoutubeDL(_make_ydl_opts(output, on_event)) as ydl:
        ydl.download([url])

    mp3_path = DOWNLOADS_DIR / f"{filename}.mp3"
    if not mp3_path.exists():
        raise RuntimeError("MP3 not found after download")

    on_event("stage", {"stage": "embedding", "message": "Embedding metadata…"})
    _embed_tags(str(mp3_path), {"name": title, "artist": uploader, "image_url": thumbnail})
    on_event("progress", {"percent": 100, "stage": "embedding"})

    return mp3_path, {"title": title, "artist": uploader}


def download_spotify(url, on_event):
    """
    Download a Spotify track/album/playlist. Calls on_event(type, data) throughout.
    Returns (list_of_mp3_paths, meta).
    """
    on_event("stage", {"stage": "fetching_metadata",
                        "message": "Fetching Spotify metadata…"})

    token = _spotify_token()
    tracks, meta = _get_spotify_tracks(url, token)

    on_event("metadata", {
        **meta,
        "total_tracks": len(tracks),
        "tracks": [
            {"name": t["name"], "artist": t["artist"], "duration_ms": t["duration_ms"]}
            for t in tracks
        ],
    })

    results = []
    for i, track in enumerate(tracks):
        on_event("track_start", {
            "index": i,
            "total": len(tracks),
            "title": track["name"],
            "artist": track["artist"],
        })
        try:
            mp3_path = _download_track(track, on_event)
            on_event("track_complete", {
                "index": i,
                "total": len(tracks),
                "file": str(mp3_path),
                "title": track["name"],
                "artist": track["artist"],
            })
            results.append(mp3_path)
        except Exception as e:
            on_event("track_error", {
                "index": i,
                "title": track["name"],
                "error": str(e),
            })

    if not results:
        raise RuntimeError("No tracks downloaded successfully")

    return results, meta
