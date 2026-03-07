# Slowed & Reverb Studio

A browser-based audio editor for creating slowed + reverb versions of tracks. Import from local files, YouTube, or Spotify — apply speed and reverb effects — export as MP3 with embedded metadata.

## Usage

Open `index.html` in your browser (double-click, or serve via the Flask server).

1. Drag an MP3 onto the drop zone (or click to browse), **or** paste a YouTube/Spotify URL into the import field
2. Adjust the sliders:
   - **Speed** — 0.50× to 1.00× (default 0.75×). Lowers pitch as it slows, which is the aesthetic.
   - **Reverb Mix** — dry/wet blend (default 40%)
   - **Reverb Decay** — tail length in seconds (default 3s)
3. Hit play to preview
4. Click **Download MP3** → confirm the filename → exports with correct ID3 tags (title, artist, album art) and a configurable suffix (default: ` (Slowed and Reverb)`)

Keyboard shortcut: `Space` to play/pause. Click the waveform to seek.

The gear icon (top right) opens settings to change the filename suffix and default slider values.

---

## YouTube & Spotify Import (requires Flask server)

### 1. Clone

```bash
git clone https://github.com/Mpire25/slowed-reverb-studio
cd slowed-reverb-studio
```

### 2. Install Python dependencies

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Also requires **ffmpeg** on your PATH:
```bash
brew install ffmpeg   # macOS
# or: sudo apt install ffmpeg
```

### 3. Spotify credentials (only needed for Spotify import)

Create a free app at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) and add a `.env` file in the project root:

```
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
```

### 4. Run the server

```bash
python server.py
```

Then open `index.html`. When the server is detected on `localhost:7337`, a URL import field appears below the drop zone. Paste any YouTube video URL or Spotify track/album/playlist URL — the studio streams live download progress directly in the UI.

---

## Architecture

```
slowed-reverb-studio/
  index.html            — single-file frontend (Web Audio API, vanilla JS, lamejs encoder)
  server.py             — Flask backend (port 7337), SSE streaming
  studio_downloader.py  — integrated download engine (YouTube + Spotify)
  requirements.txt
  downloads/            — imported MP3s saved here
```

### Live download status (SSE)

When you paste a URL and click Load, the frontend opens a Server-Sent Events stream to `/api/download/stream`. Progress events are streamed in real time:

| Event | What it carries |
|---|---|
| `stage` | Current stage (fetching metadata, searching, downloading, converting…) |
| `metadata` | Track/album/playlist info, artwork URL, total track count |
| `found` | YouTube Music match found (or fallback to search) |
| `progress` | Download percentage |
| `track_start` | Per-track info for playlists |
| `track_complete` | Per-track done + file path |
| `track_error` | Per-track failure with reason |
| `complete` | Final file path(s) — triggers load into studio |
| `error` | Fatal error message |

The studio has its own `studio_downloader.py` with callback-based progress rather than terminal output. If you want the standalone CLI tools separately, they live at [spotify-to-mp3](https://github.com/Mpire25/spotify-to-mp3) and [youtube-to-mp3](https://github.com/Mpire25/youtube-to-mp3).

---

## Technical notes

- MP3 encoding uses [lamejs](https://github.com/zhuker/lamejs) bundled inline at 192 kbps stereo
- Reverb impulse response is generated algorithmically (exponential noise decay) — no IR file needed
- Export renders via `OfflineAudioContext` then encodes to MP3 with a hand-written ID3v2.3 tag prepended
- Speed change intentionally shifts pitch (no pitch correction) — this is the slowed & reverb sound
- YouTube downloads use yt-dlp with Android/web player clients to avoid 403s
- Spotify uses the Client Credentials API flow — no user login required
