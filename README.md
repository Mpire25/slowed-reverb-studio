# Slowed & Reverb Studio

A local web app for adding reverb and slowing down audio files, with live preview and MP3 download. No internet connection required — everything runs in the browser.

## Usage

Open `index.html` directly in your browser. No server, no install, no build step.

1. Drag an MP3 onto the drop zone (or click to browse)
2. Adjust the sliders:
   - **Speed** — 0.50× to 1.00× (default 0.75×). Lowers pitch as it slows, which is the aesthetic.
   - **Reverb Mix** — dry/wet blend (default 40%)
   - **Reverb Decay** — tail length in seconds (default 3s)
3. Hit play to preview
4. Click **Download MP3** → confirm the filename → an MP3 exports to your downloads folder with the correct ID3 tags (title, artist, album art) and a configurable suffix (default: ` (Slowed and Reverb)`)

Keyboard shortcut: `Space` to play/pause. Click the waveform to seek.

The gear icon (top right) opens settings where you can change the filename suffix and default slider values.

## Spotify / YouTube Integration (optional)

A companion Flask server bridges the existing CLI downloader scripts.

**Install dependencies:**

```bash
pip install flask flask-cors
```

**Start the server:**

```bash
python server.py
```

When the server is running on `localhost:7337`, a URL input field appears in the drop zone. Paste a Spotify or YouTube URL, click **Load**, and the track downloads and loads automatically.

The Spotify integration requires `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` environment variables (or a `.env` file in `spotify-to-mp3/`). Free credentials are available at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard).

## Files

```
slowed-reverb-studio/
├── index.html   — the full app (self-contained, 197 KB including MP3 encoder)
├── server.py    — optional Flask bridge for Spotify/YouTube
└── build.py     — rebuilds index.html if you edit build.py directly
```

## Technical notes

- MP3 encoding uses [lamejs](https://github.com/zhuker/lamejs) bundled inline at 192 kbps stereo
- Reverb impulse response is generated algorithmically (exponential noise decay) — no IR file needed
- Export renders via `OfflineAudioContext` then encodes to MP3 with a hand-written ID3v2.3 tag prepended
- Speed change intentionally shifts pitch (no pitch correction) — this is the slowed & reverb sound
