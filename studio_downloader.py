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
import html as html_lib
import subprocess
import urllib.request
import urllib.parse
from pathlib import Path

import yt_dlp
from mutagen.id3 import ID3, APIC, TIT2, TPE1, TALB, ID3NoHeaderError
from backend_utils import clean_error_message

STUDIO_DIR = Path(__file__).parent
DOWNLOADS_DIR = STUDIO_DIR / "downloads"

_ytmusic = None


def _get_ytmusic():
    global _ytmusic
    if _ytmusic is None:
        from ytmusicapi import YTMusic
        _ytmusic = YTMusic()
    return _ytmusic

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


def has_spotify_oauth():
    """Returns True if a Spotify refresh token is stored."""
    return bool(os.environ.get("SPOTIFY_REFRESH_TOKEN", ""))


def _spotify_user_token():
    """Get a user-scoped access token using the stored refresh token."""
    import urllib.error
    refresh_token = os.environ.get("SPOTIFY_REFRESH_TOKEN", "")
    if not refresh_token:
        raise RuntimeError("spotify_auth_required")
    client_id = os.environ.get("SPOTIFY_CLIENT_ID", "")
    client_secret = os.environ.get("SPOTIFY_CLIENT_SECRET", "")
    creds = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    data = urllib.parse.urlencode({
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
    }).encode()
    req = urllib.request.Request(
        "https://accounts.spotify.com/api/token",
        data=data,
        headers={"Authorization": f"Basic {creds}"},
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())["access_token"]
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Failed to refresh Spotify token: {body}") from None


def _spotify_get(path, token):
    import urllib.error
    if path.startswith("http://") or path.startswith("https://"):
        url = path
    else:
        url = f"https://api.spotify.com/v1{path}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Spotify API {e.code}: {body}") from None


_SPOTIFY_SONG_META_RE = re.compile(
    r'<meta[^>]+name=["\']music:song["\'][^>]+content=["\']https://open\.spotify\.com/track/([A-Za-z0-9]+)["\']',
    re.IGNORECASE,
)


def _spotify_track_payload_to_dict(track_payload):
    """Normalise Spotify track payloads into the downloader's track shape."""
    if not isinstance(track_payload, dict):
        return None
    if track_payload.get("type") not in (None, "track"):
        return None
    if not track_payload.get("name"):
        return None
    album_obj = track_payload.get("album")
    if not isinstance(album_obj, dict):
        album_obj = {}
    images = album_obj.get("images")
    if not isinstance(images, list):
        images = []
    artists = track_payload.get("artists")
    if not isinstance(artists, list):
        artists = []
    first_artist = artists[0] if artists and isinstance(artists[0], dict) else {}
    artist_name = first_artist.get("name") or "Unknown"
    ext = track_payload.get("external_urls")
    if not isinstance(ext, dict):
        ext = {}
    spotify_url = ext.get("spotify")
    if not spotify_url:
        track_id = track_payload.get("id")
        if track_id:
            spotify_url = f"https://open.spotify.com/track/{track_id}"
    return {
        "name": track_payload["name"],
        "artist": artist_name,
        "album": album_obj.get("name", ""),
        "duration_ms": track_payload.get("duration_ms", 0),
        "image_url": images[0]["url"] if images else None,
        "spotify_url": spotify_url,
    }


def _spotify_extract_playlist_tracks(payload):
    """
    Extract track entries from either legacy `tracks.items` payloads
    or newer `items.items` payloads.
    """
    containers = []
    if isinstance(payload.get("tracks"), dict):
        containers.append(payload["tracks"].get("items") or [])
    if isinstance(payload.get("items"), dict):
        containers.append(payload["items"].get("items") or [])
    tracks = []
    for entries in containers:
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            track_payload = entry.get("track")
            if not isinstance(track_payload, dict):
                track_payload = entry.get("item")
            if not isinstance(track_payload, dict) and entry.get("name"):
                track_payload = entry
            track = _spotify_track_payload_to_dict(track_payload)
            if track:
                tracks.append(track)
    return tracks


def _spotify_playlist_next_url(payload):
    for key in ("items", "tracks"):
        container = payload.get(key)
        if isinstance(container, dict):
            next_url = container.get("next")
            if next_url:
                return next_url
    return None


def _spotify_fetch_playlist_tracks_via_items_api(sid, token):
    tracks = []
    page = _spotify_get(f"/playlists/{sid}/items?limit=100&offset=0", token)
    while True:
        tracks.extend(_spotify_extract_playlist_tracks(page))
        next_url = _spotify_playlist_next_url(page)
        if not next_url:
            break
        page = _spotify_get(next_url, token)
    return tracks


def _spotify_get_tracks_by_ids(track_ids, token):
    tracks = []
    cache = {}
    for track_id in track_ids:
        if track_id in cache:
            raw = cache[track_id]
        else:
            try:
                raw = _spotify_get(f"/tracks/{track_id}", token)
            except RuntimeError:
                raw = None
            cache[track_id] = raw
        track = _spotify_track_payload_to_dict(raw)
        if track:
            tracks.append(track)
    return tracks


def _html_meta_content(html_text, attr_name, attr_value):
    attr_value = re.escape(attr_value)
    p1 = re.compile(
        rf'<meta[^>]+{attr_name}=["\']{attr_value}["\'][^>]+content=["\']([^"\']+)["\']',
        re.IGNORECASE,
    )
    m = p1.search(html_text)
    if not m:
        p2 = re.compile(
            rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+{attr_name}=["\']{attr_value}["\']',
            re.IGNORECASE,
        )
        m = p2.search(html_text)
    return html_lib.unescape(m.group(1)).strip() if m else None


def _spotify_playlist_from_public_page(sid, token):
    """
    Fallback for public playlists where Spotify's playlist-items API is blocked.
    Uses open.spotify.com metadata to gather track IDs.
    """
    page_url = f"https://open.spotify.com/playlist/{sid}"
    req = urllib.request.Request(
        page_url,
        headers={"User-Agent": "Mozilla/5.0"},
    )
    try:
        with urllib.request.urlopen(req) as resp:
            html_text = resp.read().decode("utf-8", errors="replace")
    except Exception as e:
        raise RuntimeError(f"Could not fetch public Spotify playlist page: {e}") from None

    track_ids = _SPOTIFY_SONG_META_RE.findall(html_text)
    if not track_ids:
        raise RuntimeError("Spotify playlist is private or unavailable to your account")

    # Public track lookups are often available with app credentials even when playlist-items aren't.
    track_token = token
    try:
        tracks = _spotify_get_tracks_by_ids(track_ids, track_token)
    except Exception:
        track_token = _spotify_token()
        tracks = _spotify_get_tracks_by_ids(track_ids, track_token)

    if not tracks:
        raise RuntimeError("Spotify playlist has no playable tracks")

    playlist_name = _html_meta_content(html_text, "property", "og:title") or "Spotify Playlist"
    playlist_image = _html_meta_content(html_text, "property", "og:image") or tracks[0].get("image_url")
    return tracks, {"name": playlist_name, "type": "playlist", "image_url": playlist_image}


def _spotify_get_playlist_tracks(sid, token):
    """
    Get Spotify playlist tracks, supporting both legacy (`tracks`) and newer (`items`) payload shapes.
    Falls back to scraping open.spotify.com metadata for public playlists.
    """
    playlist_name = "Spotify Playlist"
    playlist_image = None
    tracks = []
    api_error = None

    try:
        meta = _spotify_get(f"/playlists/{sid}", token)
        playlist_name = meta.get("name") or playlist_name
        images = meta.get("images")
        if isinstance(images, list) and images:
            playlist_image = images[0].get("url")

        tracks.extend(_spotify_extract_playlist_tracks(meta))
        next_url = _spotify_playlist_next_url(meta)
        while next_url:
            page = _spotify_get(next_url, token)
            tracks.extend(_spotify_extract_playlist_tracks(page))
            next_url = _spotify_playlist_next_url(page)
    except RuntimeError as e:
        api_error = e

    if not tracks:
        try:
            tracks = _spotify_fetch_playlist_tracks_via_items_api(sid, token)
        except RuntimeError as e:
            api_error = e

    if not tracks:
        try:
            fallback_tracks, fallback_meta = _spotify_playlist_from_public_page(sid, token)
            if fallback_meta.get("name"):
                playlist_name = fallback_meta["name"]
            if fallback_meta.get("image_url"):
                playlist_image = fallback_meta["image_url"]
            tracks = fallback_tracks
        except RuntimeError:
            if api_error:
                raise api_error
            raise

    if not tracks:
        raise RuntimeError("Spotify playlist is empty")
    if not playlist_image:
        playlist_image = tracks[0].get("image_url")
    return tracks, {"name": playlist_name, "type": "playlist", "image_url": playlist_image}


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
        ext = data.get("external_urls", {})
        track = {
            "name": data["name"],
            "artist": artist,
            "album": album,
            "duration_ms": data["duration_ms"],
            "image_url": images[0]["url"] if images else None,
            "spotify_url": ext.get("spotify") or f"https://open.spotify.com/track/{sid}",
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
                "spotify_url": (
                    (t.get("external_urls") or {}).get("spotify")
                    or (
                        f"https://open.spotify.com/track/{t.get('id')}"
                        if t.get("id")
                        else None
                    )
                ),
            }
            for t in data["tracks"]["items"]
        ]
        return tracks, {"name": album_name, "artist": artist, "type": "album",
                        "image_url": image_url}

    else:  # playlist — requires user OAuth token for private lists
        return _spotify_get_playlist_tracks(sid, token)


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


def _find_youtube_id(track):
    """Search YouTube Music, fall back to YouTube search if confidence is low."""
    query = f"{track['artist']} - {track['name']}"
    duration_s = track["duration_ms"] // 1000

    best_id = None
    best_score = 0
    best_is_junk = False
    any_title_match = False

    try:
        ytm = _get_ytmusic()
        results = ytm.search(query, filter="songs", limit=20)
        for result in results:
            score = _score_result(result, track["name"], track["artist"], duration_s)
            if _core_title(result.get("title", "")) == _core_title(track["name"]):
                any_title_match = True
            if score > best_score:
                best_score = score
                best_id = result["videoId"]
                best_is_junk = bool(_JUNK_KEYWORDS.search(result.get("title", "")))
    except Exception:
        pass

    # Fall back to YouTube if: low confidence, best is junk, or no title match at all
    # If best is junk, reset score to 0 so any clean YouTube result can win
    if best_score < 50 or best_is_junk or not any_title_match:
        if best_is_junk:
            best_score = 0
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
                    if score > best_score:
                        best_score = score
                        best_id = fake_result["videoId"]
        except Exception:
            pass

    return best_id


def _candidate_album_score(result, expected_album, expected_artist):
    """Quick score for album search candidates before expensive album fetch calls."""
    album_title = result.get("title", "")
    core_expected_album = _core_title(expected_album)
    core_album_title = _core_title(album_title)

    title_score = 0
    if core_album_title == core_expected_album:
        title_score = 60
    elif core_expected_album and core_expected_album in core_album_title:
        title_score = 30

    artists = result.get("artists") or []
    artist_blob = " ".join(a.get("name", "") for a in artists)
    artist_score = 30 if _core_title(expected_artist) in _core_title(artist_blob) else 0
    return title_score + artist_score


def _match_album_tracks(spotify_tracks, ytm_tracks):
    """
    Attempt to match Spotify tracks to a YTM album tracklist.
    Returns (is_confident, mapping_by_spotify_index).
    """
    if len(spotify_tracks) != len(ytm_tracks):
        return False, {}

    ordered_mapping = {}
    ordered_title_matches = 0
    duration_matches = 0

    for i, (sp_track, yt_track) in enumerate(zip(spotify_tracks, ytm_tracks)):
        sp_title = _core_title(sp_track.get("name", ""))
        yt_title = _core_title(yt_track.get("title", ""))
        if sp_title and sp_title == yt_title:
            ordered_title_matches += 1

        sp_duration = (sp_track.get("duration_ms") or 0) // 1000
        yt_duration = yt_track.get("duration_seconds") or 0
        if sp_duration > 0 and yt_duration > 0 and abs(sp_duration - yt_duration) <= 15:
            duration_matches += 1

        video_id = yt_track.get("videoId")
        if not video_id:
            return False, {}
        ordered_mapping[i] = video_id

    min_title_matches = max(1, int(len(spotify_tracks) * 0.8))
    min_duration_matches = max(1, int(len(spotify_tracks) * 0.6))
    if ordered_title_matches >= min_title_matches and duration_matches >= min_duration_matches:
        return True, ordered_mapping

    # Fallback: title-based matching for occasional ordering differences.
    title_to_indices = {}
    for idx, yt_track in enumerate(ytm_tracks):
        title_to_indices.setdefault(_core_title(yt_track.get("title", "")), []).append(idx)

    used_yt_indices = set()
    mapping = {}
    title_matches = 0
    duration_matches = 0

    for sp_idx, sp_track in enumerate(spotify_tracks):
        key = _core_title(sp_track.get("name", ""))
        candidate_indices = title_to_indices.get(key, [])
        chosen = None
        for yt_idx in candidate_indices:
            if yt_idx not in used_yt_indices:
                chosen = yt_idx
                break
        if chosen is None:
            return False, {}

        yt_track = ytm_tracks[chosen]
        video_id = yt_track.get("videoId")
        if not video_id:
            return False, {}

        used_yt_indices.add(chosen)
        mapping[sp_idx] = video_id
        title_matches += 1

        sp_duration = (sp_track.get("duration_ms") or 0) // 1000
        yt_duration = yt_track.get("duration_seconds") or 0
        if sp_duration > 0 and yt_duration > 0 and abs(sp_duration - yt_duration) <= 15:
            duration_matches += 1

    min_title_matches = max(1, int(len(spotify_tracks) * 0.9))
    min_duration_matches = max(1, int(len(spotify_tracks) * 0.7))
    if title_matches >= min_title_matches and duration_matches >= min_duration_matches:
        return True, mapping

    return False, {}


def _resolve_album_video_ids(spotify_tracks, album_meta):
    """
    Find a high-confidence YTM album match and return track-index -> videoId mapping.
    Returns {} when no confident album-level match is found.
    """
    if not spotify_tracks:
        return {}

    album_name = album_meta.get("name", "")
    artist_name = album_meta.get("artist", "") or spotify_tracks[0].get("artist", "")
    query = f"{artist_name} - {album_name}".strip(" -")

    try:
        ytm = _get_ytmusic()
        candidates = ytm.search(query, filter="albums", limit=8)
    except Exception:
        return {}

    ranked = sorted(
        (c for c in candidates if isinstance(c, dict) and c.get("browseId")),
        key=lambda c: _candidate_album_score(c, album_name, artist_name),
        reverse=True,
    )[:5]

    if not ranked:
        return {}

    for candidate in ranked:
        browse_id = candidate.get("browseId")
        if not browse_id:
            continue
        try:
            album_data = ytm.get_album(browse_id)
        except Exception:
            continue

        ytm_tracks = album_data.get("tracks") or []
        if not isinstance(ytm_tracks, list):
            continue

        confident, mapping = _match_album_tracks(spotify_tracks, ytm_tracks)
        if confident and len(mapping) == len(spotify_tracks):
            return mapping

    return {}


def _apply_album_match_video_ids(spotify_tracks, album_meta):
    """
    Mutates spotify_tracks to add `video_id` when a confident album match is found.
    Returns number of assigned video IDs.
    """
    mapping = _resolve_album_video_ids(spotify_tracks, album_meta)
    if len(mapping) != len(spotify_tracks):
        return 0
    for idx, video_id in mapping.items():
        spotify_tracks[idx]["video_id"] = video_id
    return len(mapping)


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

def _make_ydl_opts(output_template, on_event, captured_path):
    def progress_hook(d):
        if d["status"] == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate", 0)
            downloaded = d.get("downloaded_bytes", 0)
            if total > 0:
                pct = (downloaded / total) * 100
                on_event("progress", {"percent": round(pct, 1), "stage": "downloading"})
        elif d["status"] == "finished":
            captured_path.append(d["filename"])

    return {
        "format": "bestaudio/best",
        "outtmpl": output_template,
        "quiet": True,
        "no_warnings": True,
        "progress_hooks": [progress_hook],
        "extractor_args": {"youtube": {"player_client": ["android", "web"]}},
    }


def _convert_to_mp3(input_path, output_path, duration_s, on_event):
    on_event("stage", {"stage": "converting", "message": "Converting to MP3…"})
    cmd = [
        "ffmpeg", "-y", "-i", str(input_path),
        "-vn", "-acodec", "libmp3lame", "-ab", "320k",
        "-progress", "pipe:1", "-nostats",
        str(output_path),
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    for line in proc.stdout:
        if line.startswith("out_time_ms=") and duration_s > 0:
            try:
                us = int(line.split("=")[1])
                pct = min(99, round((us / 1_000_000 / duration_s) * 100, 1))
                on_event("progress", {"percent": pct, "stage": "converting"})
            except ValueError:
                pass
    proc.wait()
    Path(input_path).unlink(missing_ok=True)


# ── YouTube Music playlist ─────────────────────────────────────────────────────

def is_youtube_music_playlist(url):
    """Returns True only for music.youtube.com playlist URLs (not plain YouTube)."""
    return "music.youtube.com" in url and "list=" in url


def get_youtube_playlist_tracks(url):
    """
    Fetch a YouTube Music playlist without downloading anything.
    Returns (tracks_list, meta_dict) in the same shape as _get_spotify_tracks.
    """
    m = re.search(r'[?&]list=([A-Za-z0-9_-]+)', url)
    if not m:
        raise ValueError("No playlist ID found in URL")
    playlist_id = m.group(1)

    try:
        ytm = _get_ytmusic()
        data = ytm.get_playlist(playlist_id, limit=None)
    except Exception as e:
        raise RuntimeError(f"Could not fetch YouTube Music playlist: {e}") from e

    tracks = []
    for item in (data.get("tracks") or []):
        video_id = item.get("videoId")
        if not video_id:
            continue
        title = item.get("title") or "Unknown"
        artists = item.get("artists") or []
        artist = artists[0].get("name", "") if artists else (item.get("uploader") or "")
        album_info = item.get("album") or {}
        album = album_info.get("name", "") if isinstance(album_info, dict) else ""
        thumbnails = item.get("thumbnails") or []
        image_url = thumbnails[-1].get("url") if thumbnails else None
        duration_seconds = item.get("duration_seconds") or 0
        tracks.append({
            "index": len(tracks),
            "name": title,
            "artist": artist,
            "album": album,
            "duration_ms": int(duration_seconds * 1000),
            "image_url": image_url,
            "video_id": video_id,
        })

    playlist_thumbnails = data.get("thumbnails") or []
    playlist_image = playlist_thumbnails[-1].get("url") if playlist_thumbnails else (
        tracks[0]["image_url"] if tracks else None
    )
    meta = {
        "name": data.get("title") or "Playlist",
        "type": "ytmusic_playlist",
        "image_url": playlist_image,
    }
    return tracks, meta


# ── Single track download (Spotify flow) ──────────────────────────────────────

def _download_track(track, on_event):
    DOWNLOADS_DIR.mkdir(exist_ok=True)
    query = f"{track['artist']} - {track['name']}"
    idx = track.get("index", 0)
    filename = safe_filename(query)
    output = str(DOWNLOADS_DIR / f"{filename}_{idx}.%(ext)s")
    duration_s = (track.get("duration_ms") or 0) // 1000

    # If we already know the video ID (e.g. from a YTM playlist), skip search
    known_video_id = track.get("video_id")
    if known_video_id:
        source = f"https://www.youtube.com/watch?v={known_video_id}"
        on_event("found", {"youtube_url": source, "query": query, "fallback": False})
    else:
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

    captured = []
    with yt_dlp.YoutubeDL(_make_ydl_opts(output, on_event, captured)) as ydl:
        ydl.download([source])

    mp3_path = DOWNLOADS_DIR / f"{filename}_{idx}.mp3"
    _convert_to_mp3(captured[0], mp3_path, duration_s, on_event)

    on_event("stage", {"stage": "embedding", "message": "Embedding metadata & art…"})
    _embed_tags(str(mp3_path), track)

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

    captured = []
    with yt_dlp.YoutubeDL(_make_ydl_opts(output, on_event, captured)) as ydl:
        ydl.download([url])

    mp3_path = DOWNLOADS_DIR / f"{filename}.mp3"
    _convert_to_mp3(captured[0], mp3_path, duration, on_event)

    on_event("stage", {"stage": "embedding", "message": "Embedding metadata…"})
    _embed_tags(str(mp3_path), {"name": title, "artist": uploader, "image_url": thumbnail})

    return mp3_path, {"title": title, "artist": uploader}


def download_spotify(url, on_event):
    """
    Download a Spotify track/album/playlist. Calls on_event(type, data) throughout.
    Returns (list_of_mp3_paths, meta).
    """
    on_event("stage", {"stage": "fetching_metadata",
                        "message": "Fetching Spotify metadata…"})

    is_playlist = bool(re.search(r'spotify\.com/playlist/', url))
    token = _spotify_user_token() if is_playlist else _spotify_token()
    tracks, meta = _get_spotify_tracks(url, token)

    on_event("metadata", {
        **meta,
        "total_tracks": len(tracks),
        "tracks": [
            {"name": t["name"], "artist": t["artist"], "duration_ms": t["duration_ms"]}
            for t in tracks
        ],
    })

    if meta.get("type") == "album":
        on_event("stage", {"stage": "searching",
                            "message": "Trying album-level match on YouTube Music…"})
        matched = _apply_album_match_video_ids(tracks, meta)
        if matched == len(tracks):
            on_event("stage", {"stage": "searching",
                                "message": "Found confident album match; using album track IDs."})
        else:
            on_event("stage", {"stage": "searching",
                                "message": "No confident album match; falling back to per-track search."})

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
                "error": clean_error_message(str(e)),
            })

    if not results:
        raise RuntimeError("No tracks downloaded successfully")

    return results, meta
