# Slowed & Reverb Studio

A browser-based audio editor for creating slowed + reverb versions of tracks. Import from local files, YouTube, or Spotify — apply speed and reverb effects — export as MP3 with embedded metadata.

## Usage

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

Then open **`http://localhost:7337`** in your browser.

1. Drag an MP3 onto the drop zone (or click to browse), **or** paste a YouTube/Spotify URL into the import field
2. Adjust the sliders:
   - **Speed** — 0.50× to 1.50× (default 0.75×). Lower values create slowed vocals; higher values create sped-up vocals.
   - **Reverb Mix** — dry/wet blend (default 40%)
   - **Reverb Decay** — tail length in seconds (default 3s)
3. Hit play to preview
4. Click **Download MP3** → confirm the filename → exports with correct ID3 tags (title, artist, album art). The suggested name auto-adds `Slowed`/`Sped Up` and `Reverb` only when those effects are active.

Keyboard shortcuts: `Space` to play/pause, `M` to toggle mute, `Shift+N` to reset/load a new track. Click the waveform to seek.

OS media controls (keyboard media keys, headphone buttons, lock screen controls) are supported — play/pause and prev/next track work system-wide while the studio is open.

The transport bar includes a **mute button** and **volume slider** for quick level control.

The gear icon (top right) opens settings to change default slider values.

When the backend is running, a URL import field appears below the drop zone. Paste any YouTube video URL or Spotify track/album/playlist URL — the studio streams live download progress directly in the UI.

Importing a Spotify album/playlist or a YouTube Music album/playlist opens a **playlist panel** alongside the studio. Tracks download progressively in the background; the studio auto-advances to the next track when one finishes. Use the **Prev/Next** transport buttons to skip, and toggle **Loop** to wrap back to the start. The number of tracks preloaded ahead can be adjusted in Settings.

The playlist panel header shows source links when available (Spotify, YouTube, or both).

---

## Architecture

```
slowed-reverb-studio/
  server.py             — Flask backend + static file serving (port 7337)
  studio_downloader.py  — integrated download engine (YouTube + Spotify)
  backend_utils.py      — shared backend helpers (error cleanup, formatting)
  requirements.txt
  downloads/            — imported MP3s saved here
  static/
    index.html          — app shell (HTML structure only)
    style.css           — all styles
    lib/lame.min.js     — lamejs MP3 encoder (classic script, window.lamejs global)
    js/
      ui.js             — entry point, event listeners
      audio.js          — Web Audio API pipeline
      visualizer.js     — bottom visualizer + animation loop
      waveform.js       — waveform rendering
      loader.js         — file loading, track UI
      importer.js       — SSE import flow
      exporter.js       — MP3 export
      settings.js       — settings persistence
      controls.js       — shared slider/loop UI sync helpers
      playlist.js       — playlist state, panel UI, progressive download + auto-advance
      dom.js            — cached DOM lookup + UI utilities
      theme.js          — color extraction + CSS theming
      id3.js            — ID3v2 reader/writer
      state.js          — shared state + settings objects
      utils.js          — fmt, toast, sanitize, clamp helpers
      config.js         — SERVER constant
```

---

## Technical notes

- MP3 encoding uses [lamejs](https://github.com/zhuker/lamejs) served at `static/lib/lame.min.js` at 320 kbps stereo
- Reverb impulse response is generated algorithmically (exponential noise decay) — no IR file needed
- Export renders via `OfflineAudioContext` then encodes to MP3 with a hand-written ID3v2.3 tag prepended
- Speed change intentionally shifts pitch (no pitch correction) — this is the slowed & reverb sound
- YouTube downloads use yt-dlp with Android/web player clients to avoid 403s
- Spotify track/album imports use the Client Credentials API flow
- Spotify playlist imports require connecting your Spotify account in Settings (OAuth)

### lame.min.js

`static/lib/lame.min.js` is committed to the repo. If it's missing, re-download it:

```bash
python build.py
```
