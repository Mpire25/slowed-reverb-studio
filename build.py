#!/usr/bin/env python3
"""Build script: assembles index.html from parts + lamejs."""
import os, sys
from pathlib import Path

here = Path(__file__).parent
lame_path = Path("/tmp/lame.min.js")

if not lame_path.exists():
    print("Downloading lamejs...")
    import urllib.request
    urllib.request.urlretrieve(
        "https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js",
        lame_path
    )

lame_js = lame_path.read_text(encoding="utf-8")

HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Slowed &amp; Reverb Studio</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0a0a0f;
  --card:rgba(255,255,255,0.04);
  --border:rgba(255,255,255,0.08);
  --accent1:#7c3aed;
  --accent2:#06b6d4;
  --text:#e2e8f0;
  --muted:#64748b;
  --radius:16px;
}
html,body{height:100%;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.5;overflow-x:hidden}
body{
  background:radial-gradient(ellipse 80% 60% at 50% -10%,rgba(124,58,237,0.18) 0%,transparent 70%),
             radial-gradient(ellipse 60% 40% at 80% 80%,rgba(6,182,212,0.08) 0%,transparent 60%),
             var(--bg);
  min-height:100vh;
}

/* ── Layout ── */
.app{max-width:680px;margin:0 auto;padding:24px 20px 60px}

/* ── Header ── */
header{display:flex;align-items:center;justify-content:space-between;margin-bottom:32px}
.logo{font-size:1.2rem;font-weight:700;letter-spacing:-0.02em;
  background:linear-gradient(90deg,#a78bfa,var(--accent2));
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.gear-btn{background:none;border:none;cursor:pointer;color:var(--muted);padding:6px;border-radius:8px;transition:color .2s,background .2s;line-height:0}
.gear-btn:hover{color:var(--text);background:var(--card)}
.gear-btn svg{width:20px;height:20px}

/* ── Glass card ── */
.card{
  background:var(--card);
  border:1px solid var(--border);
  border-radius:var(--radius);
  backdrop-filter:blur(12px);
  -webkit-backdrop-filter:blur(12px);
}

/* ── Drop zone ── */
.drop-zone{
  padding:36px 24px;
  text-align:center;
  cursor:pointer;
  transition:border-color .2s,background .2s;
  border:1.5px dashed var(--border);
  border-radius:var(--radius);
  position:relative;
  margin-bottom:20px;
}
.drop-zone.drag-over{border-color:var(--accent1);background:rgba(124,58,237,0.08)}
.drop-zone .icon{font-size:2.4rem;margin-bottom:10px;opacity:.5}
.drop-zone p{color:var(--muted);font-size:.9rem}
.drop-zone strong{color:var(--text)}
.drop-zone input[type=file]{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%}

.url-row{display:flex;gap:8px;margin-top:16px}
.url-row input{
  flex:1;background:rgba(255,255,255,0.06);border:1px solid var(--border);
  border-radius:10px;padding:9px 14px;color:var(--text);font-size:.875rem;outline:none;
  transition:border-color .2s;
}
.url-row input::placeholder{color:var(--muted)}
.url-row input:focus{border-color:var(--accent1)}
.url-row button{
  padding:9px 16px;border-radius:10px;border:none;cursor:pointer;font-size:.875rem;font-weight:600;
  background:linear-gradient(135deg,var(--accent1),var(--accent2));color:#fff;
  transition:opacity .2s,transform .1s;white-space:nowrap;
}
.url-row button:hover{opacity:.9}
.url-row button:active{transform:scale(.97)}
.url-row button:disabled{opacity:.4;cursor:not-allowed}
.server-status{font-size:.75rem;color:var(--muted);margin-top:6px;text-align:right}
.server-status.online{color:#34d399}

/* ── Track card ── */
.track-card{padding:20px;display:flex;gap:18px;align-items:flex-start;margin-bottom:20px}
.album-art{width:80px;height:80px;border-radius:10px;object-fit:cover;flex-shrink:0;
  background:linear-gradient(135deg,rgba(124,58,237,.3),rgba(6,182,212,.3));
  display:flex;align-items:center;justify-content:center;font-size:1.8rem;overflow:hidden}
.album-art img{width:100%;height:100%;object-fit:cover}
.track-info{flex:1;min-width:0}
.track-title{font-size:1.05rem;font-weight:600;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:text;outline:none;border-radius:4px;padding:1px 3px;margin-left:-3px;transition:background .15s}
.track-title:focus{background:rgba(255,255,255,.07);white-space:normal;overflow:visible;text-overflow:clip}
.track-artist{font-size:.85rem;color:var(--muted);margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.track-duration{font-size:.8rem;color:var(--muted)}
.track-card.hidden{display:none}

/* ── Waveform ── */
.waveform-wrap{margin-bottom:20px;position:relative}
#waveform{width:100%;height:72px;border-radius:var(--radius);cursor:pointer;display:block}
.waveform-wrap.hidden{display:none}

/* ── Transport ── */
.transport{display:flex;align-items:center;gap:12px;margin-bottom:24px}
.transport.hidden{display:none}
.play-btn{
  width:46px;height:46px;border-radius:50%;border:none;cursor:pointer;
  background:linear-gradient(135deg,var(--accent1),var(--accent2));
  color:#fff;display:flex;align-items:center;justify-content:center;
  transition:transform .1s,box-shadow .2s;flex-shrink:0;
  box-shadow:0 4px 20px rgba(124,58,237,.4);
}
.play-btn:hover{transform:scale(1.06);box-shadow:0 6px 28px rgba(124,58,237,.5)}
.play-btn:active{transform:scale(.96)}
.play-btn svg{width:20px;height:20px}
.transport-icon-btn{
  padding:6px;border:none;background:transparent;color:var(--muted);cursor:pointer;
  display:flex;align-items:center;justify-content:center;
  transition:color .2s;flex-shrink:0;
}
.transport-icon-btn:hover{color:var(--text)}
.transport-icon-btn svg{width:18px;height:18px}
.loop-btn.active{color:var(--text)}
.time-display{font-size:.85rem;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}

/* ── Effects ── */
.effects{margin-bottom:24px}
.effects.hidden{display:none}
.effects h3{font-size:.8rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:14px;padding:0 2px}
.slider-group{display:flex;flex-direction:column;gap:14px}
.slider-row{display:flex;align-items:center;gap:14px}
.slider-label{font-size:.825rem;color:var(--muted);min-width:90px;flex-shrink:0}
.slider-value{font-size:.825rem;color:var(--text);min-width:44px;text-align:right;font-variant-numeric:tabular-nums;flex-shrink:0}
input[type=range]{
  flex:1;-webkit-appearance:none;appearance:none;height:4px;border-radius:4px;outline:none;cursor:pointer;
  background:var(--border);position:relative;
}
input[type=range]::-webkit-slider-thumb{
  -webkit-appearance:none;width:18px;height:18px;border-radius:50%;
  background:linear-gradient(135deg,var(--accent1),var(--accent2));
  box-shadow:0 0 10px rgba(124,58,237,.6);cursor:pointer;transition:transform .1s;
}
input[type=range]::-webkit-slider-thumb:hover{transform:scale(1.2)}
input[type=range]::-moz-range-thumb{width:18px;height:18px;border-radius:50%;border:none;
  background:linear-gradient(135deg,var(--accent1),var(--accent2));cursor:pointer}

/* ── Download ── */
.download-btn{
  width:100%;padding:14px;border-radius:var(--radius);border:none;cursor:pointer;
  font-size:1rem;font-weight:700;letter-spacing:.02em;
  background:linear-gradient(135deg,var(--accent1),var(--accent2));
  color:#fff;transition:opacity .2s,transform .1s;
  box-shadow:0 4px 24px rgba(124,58,237,.35);
}
.download-btn:hover:not(:disabled){opacity:.92;transform:translateY(-1px)}
.download-btn:active:not(:disabled){transform:translateY(0)}
.download-btn:disabled{opacity:.35;cursor:not-allowed}
.download-btn.hidden{display:none}

/* ── Settings panel ── */
.overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:140;opacity:0;pointer-events:none;transition:opacity .25s;backdrop-filter:blur(2px)}
.overlay.open{opacity:1;pointer-events:auto}
.settings-panel{
  position:fixed;top:0;right:0;bottom:0;width:320px;max-width:90vw;
  background:#111118;border-left:1px solid var(--border);z-index:150;
  transform:translateX(100%);transition:transform .3s cubic-bezier(.4,0,.2,1);
  padding:28px 24px;overflow-y:auto;
}
.settings-panel.open{transform:translateX(0)}
.settings-panel h2{font-size:1rem;font-weight:700;margin-bottom:24px}
.settings-panel .close-btn{position:absolute;top:20px;right:20px;background:none;border:none;color:var(--muted);cursor:pointer;font-size:1.4rem;line-height:1;padding:4px}
.settings-panel .close-btn:hover{color:var(--text)}
.setting-group{margin-bottom:20px}
.setting-group label{display:block;font-size:.8rem;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.06em}
.setting-group input[type=text],.setting-group input[type=number]{
  width:100%;background:rgba(255,255,255,.06);border:1px solid var(--border);
  border-radius:10px;padding:9px 12px;color:var(--text);font-size:.875rem;outline:none;
  transition:border-color .2s;
}
.setting-group input:focus{border-color:var(--accent1)}

/* ── Download modal ── */
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:200;display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity .2s;backdrop-filter:blur(4px)}
.modal-overlay.open{opacity:1;pointer-events:auto}
.modal{background:#16161f;border:1px solid var(--border);border-radius:20px;padding:28px;width:380px;max-width:90vw;box-shadow:0 20px 80px rgba(0,0,0,.6)}
.modal h3{font-size:1rem;font-weight:700;margin-bottom:20px}
.modal label{display:block;font-size:.8rem;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.06em}
.modal input{
  width:100%;background:rgba(255,255,255,.06);border:1px solid var(--border);
  border-radius:10px;padding:10px 13px;color:var(--text);font-size:.9rem;outline:none;
  transition:border-color .2s;margin-bottom:20px;
}
.modal input:focus{border-color:var(--accent1)}
.modal-btns{display:flex;gap:10px}
.modal-btns button{flex:1;padding:11px;border-radius:10px;border:none;cursor:pointer;font-size:.9rem;font-weight:600;transition:opacity .15s}
.modal-cancel{background:rgba(255,255,255,.07);color:var(--text)}
.modal-confirm{background:linear-gradient(135deg,var(--accent1),var(--accent2));color:#fff}
.modal-cancel:hover{background:rgba(255,255,255,.11)}
.modal-confirm:hover{opacity:.9}
.modal-confirm:disabled{opacity:.4;cursor:not-allowed}

/* ── Progress / toast ── */
.toast{
  position:fixed;bottom:28px;left:50%;transform:translateX(-50%) translateY(20px);
  background:#1e1e2e;border:1px solid var(--border);border-radius:12px;
  padding:12px 20px;font-size:.875rem;color:var(--text);
  box-shadow:0 8px 32px rgba(0,0,0,.4);opacity:0;pointer-events:none;
  transition:opacity .25s,transform .25s;white-space:nowrap;z-index:300;
}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}

.progress-bar{height:3px;border-radius:3px;background:linear-gradient(90deg,var(--accent1),var(--accent2));width:0%;transition:width .3s}
.progress-wrap{background:rgba(255,255,255,.08);border-radius:3px;margin-top:8px;overflow:hidden}

/* ── Spinner ── */
@keyframes spin{to{transform:rotate(360deg)}}
.spinner{display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,.2);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle;margin-right:6px}
</style>
</head>
<body>

<div class="app">
  <header>
    <div class="logo">Slowed &amp; Reverb Studio</div>
    <button class="gear-btn" id="gearBtn" title="Settings" aria-label="Settings">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
    </button>
  </header>

  <!-- Drop zone -->
  <div class="drop-zone" id="dropZone">
    <div class="icon">🎵</div>
    <p><strong>Drop an MP3 here</strong><br>or click to browse</p>
    <input type="file" id="fileInput" accept=".mp3,audio/*" aria-label="Choose audio file">

    <div class="url-row" id="urlRow" style="display:none">
      <input type="text" id="urlInput" placeholder="Spotify or YouTube URL…" autocomplete="off">
      <button id="urlLoadBtn" disabled>Load</button>
    </div>
    <div class="server-status" id="serverStatus" style="display:none"></div>
  </div>

  <!-- Track card -->
  <div class="card track-card hidden" id="trackCard">
    <div class="album-art" id="albumArt">🎵</div>
    <div class="track-info">
      <div class="track-title" id="trackTitle" contenteditable="true" spellcheck="false">Unknown Title</div>
      <div class="track-artist" id="trackArtist">Unknown Artist</div>
      <div class="track-duration" id="trackDuration">0:00</div>
    </div>
  </div>

  <!-- Waveform -->
  <div class="card waveform-wrap hidden" id="waveformWrap">
    <canvas id="waveform"></canvas>
  </div>

  <!-- Transport -->
  <div class="transport hidden" id="transport">
    <button class="transport-icon-btn" id="startBtn" title="Start" aria-label="Start">
      <svg viewBox="0 0 24 24" fill="currentColor">
        <rect x="4.5" y="4" width="2.5" height="16" rx="1"/>
        <polygon points="18,5 8.5,12 18,19"/>
      </svg>
    </button>
    <button class="play-btn" id="playBtn" aria-label="Play/Pause">
      <svg id="playIcon" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
    </button>
    <button class="transport-icon-btn" id="endBtn" title="End" aria-label="End">
      <svg viewBox="0 0 24 24" fill="currentColor">
        <polygon points="6,5 15.5,12 6,19"/>
        <rect x="17" y="4" width="2.5" height="16" rx="1"/>
      </svg>
    </button>
    <button class="transport-icon-btn loop-btn" id="loopBtn" title="Loop Off" aria-label="Toggle Loop" aria-pressed="false">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 7h9l-2.5-2.5M16 17H7l2.5 2.5M17 7c2 0 3 1 3 3v1M7 17c-2 0-3-1-3-3v-1"/>
      </svg>
    </button>
    <span class="time-display" id="timeDisplay">0:00 / 0:00</span>
  </div>

  <!-- Effects -->
  <div class="card effects hidden" id="effects" style="padding:20px">
    <h3>Effects</h3>
    <div class="slider-group">
      <div class="slider-row">
        <span class="slider-label">Speed</span>
        <input type="range" id="speedSlider" min="50" max="100" value="75" step="1" aria-label="Speed">
        <span class="slider-value" id="speedVal">0.75×</span>
      </div>
      <div class="slider-row">
        <span class="slider-label">Reverb Mix</span>
        <input type="range" id="reverbSlider" min="0" max="100" value="40" step="1" aria-label="Reverb Mix">
        <span class="slider-value" id="reverbVal">40%</span>
      </div>
      <div class="slider-row">
        <span class="slider-label">Reverb Decay</span>
        <input type="range" id="decaySlider" min="10" max="80" value="30" step="1" aria-label="Reverb Decay">
        <span class="slider-value" id="decayVal">3.0s</span>
      </div>
    </div>
  </div>

  <!-- Download -->
  <button class="download-btn hidden" id="downloadBtn">Download MP3</button>
</div>

<!-- Settings panel -->
<div class="overlay" id="overlay"></div>
<div class="settings-panel" id="settingsPanel">
  <button class="close-btn" id="closeSettings">×</button>
  <h2>Settings</h2>
  <div class="setting-group">
    <label>Filename Suffix</label>
    <input type="text" id="suffixSetting" value=" (Slowed and Reverb)">
  </div>
  <div class="setting-group">
    <label>Default Speed (×)</label>
    <input type="number" id="defaultSpeed" value="0.75" min="0.5" max="1.0" step="0.05">
  </div>
  <div class="setting-group">
    <label>Default Reverb Mix (%)</label>
    <input type="number" id="defaultReverb" value="40" min="0" max="100" step="5">
  </div>
  <div class="setting-group">
    <label>Default Reverb Decay (s)</label>
    <input type="number" id="defaultDecay" value="3" min="1" max="8" step="0.5">
  </div>
</div>

<!-- Download modal -->
<div class="modal-overlay" id="modalOverlay">
  <div class="modal">
    <h3>Export MP3</h3>
    <label>Filename</label>
    <input type="text" id="filenameInput" autocomplete="off">
    <div class="modal-btns">
      <button class="modal-cancel" id="modalCancel">Cancel</button>
      <button class="modal-confirm" id="modalConfirm">Export</button>
    </div>
    <div class="progress-wrap" id="progressWrap" style="display:none">
      <div class="progress-bar" id="progressBar"></div>
    </div>
  </div>
</div>

<!-- Toast -->
<div class="toast" id="toast"></div>

<!-- lamejs (MP3 encoder) -->
<script>
LAMEJS_PLACEHOLDER
</script>

<script>
'use strict';

// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  audioCtx: null,
  audioBuffer: null,
  source: null,
  analyser: null,
  dryGain: null,
  wetGain: null,
  convolver: null,
  merger: null,
  startTime: 0,       // audioCtx.currentTime when playback started
  pausedAt: 0,        // seconds into track when paused
  playing: false,
  speed: 0.75,
  reverbMix: 0.40,
  reverbDecay: 3.0,
  loopEnabled: false,
  title: 'Unknown Title',
  artist: 'Unknown Artist',
  artBlob: null,      // Blob URL for album art
  artBytes: null,     // raw APIC bytes for re-embedding
  artMime: 'image/jpeg',
  duration: 0,
  waveformData: null,
  animFrame: null,
  serverOnline: false,
};

const settings = {
  suffix: ' (Slowed and Reverb)',
  defaultSpeed: 0.75,
  defaultReverb: 40,
  defaultDecay: 3,
  loopEnabled: false,
};

const SETTINGS_STORAGE_KEY = 'slowedReverbStudio.settings.v1';

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;
    if (typeof parsed.suffix === 'string') settings.suffix = parsed.suffix;
    if (Number.isFinite(parsed.defaultSpeed)) settings.defaultSpeed = parsed.defaultSpeed;
    if (Number.isFinite(parsed.defaultReverb)) settings.defaultReverb = parsed.defaultReverb;
    if (Number.isFinite(parsed.defaultDecay)) settings.defaultDecay = parsed.defaultDecay;
    if (typeof parsed.loopEnabled === 'boolean') settings.loopEnabled = parsed.loopEnabled;
  } catch (err) {
    console.warn('Failed to load settings from localStorage', err);
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn('Failed to save settings to localStorage', err);
  }
}

function syncSettingsUI() {
  document.getElementById('suffixSetting').value = settings.suffix;
  document.getElementById('defaultSpeed').value = settings.defaultSpeed;
  document.getElementById('defaultReverb').value = settings.defaultReverb;
  document.getElementById('defaultDecay').value = settings.defaultDecay;

  state.speed = settings.defaultSpeed;
  state.reverbMix = settings.defaultReverb / 100;
  state.reverbDecay = settings.defaultDecay;
  state.loopEnabled = settings.loopEnabled;

  document.getElementById('speedSlider').value = Math.round(state.speed * 100);
  document.getElementById('speedVal').textContent = state.speed.toFixed(2) + '×';
  document.getElementById('reverbSlider').value = Math.round(state.reverbMix * 100);
  document.getElementById('reverbVal').textContent = Math.round(state.reverbMix * 100) + '%';
  document.getElementById('decaySlider').value = Math.round(state.reverbDecay * 10);
  document.getElementById('decayVal').textContent = state.reverbDecay.toFixed(1) + 's';
  updateLoopBtn();
  document.getElementById('loopBtn').title = state.loopEnabled ? 'Loop On' : 'Loop Off';
}

loadSettings();

// ─── Utils ───────────────────────────────────────────────────────────────────
function fmt(s) {
  s = Math.max(0, s | 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function sanitize(s) {
  return s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim() || 'track';
}

function toast(msg, ms = 3000) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), ms);
}

// ─── ID3v2 Reader ────────────────────────────────────────────────────────────
function readID3(buf) {
  const v = new Uint8Array(buf);
  if (v[0] !== 0x49 || v[1] !== 0x44 || v[2] !== 0x33) return {}; // No ID3 tag
  const major = v[3];
  // Syncsafe size
  const tagSize = ((v[6] & 0x7f) << 21) | ((v[7] & 0x7f) << 14) |
                  ((v[8] & 0x7f) << 7)  |  (v[9] & 0x7f);
  const result = {};
  let i = 10;
  const end = 10 + tagSize;

  const dec = new TextDecoder('utf-8');
  const decLatin = new TextDecoder('latin1');

  while (i < end - 10) {
    const frameId = String.fromCharCode(v[i], v[i+1], v[i+2], v[i+3]);
    if (frameId === '\x00\x00\x00\x00') break;
    let size;
    if (major >= 4) {
      size = ((v[i+4] & 0x7f) << 21) | ((v[i+5] & 0x7f) << 14) |
             ((v[i+6] & 0x7f) << 7)  |  (v[i+7] & 0x7f);
    } else {
      size = (v[i+4] << 24) | (v[i+5] << 16) | (v[i+6] << 8) | v[i+7];
    }
    if (size <= 0) { i += 10; continue; }
    const data = v.subarray(i + 10, i + 10 + size);

    if (frameId === 'TIT2' || frameId === 'TPE1') {
      const enc = data[0];
      let text = '';
      if (enc === 0) text = decLatin.decode(data.subarray(1));
      else if (enc === 1 || enc === 2) {
        // UTF-16: strip BOM
        const raw = data.subarray(1);
        const hasBOM = raw[0] === 0xFF && raw[1] === 0xFE || raw[0] === 0xFE && raw[1] === 0xFF;
        text = new TextDecoder(enc === 2 ? 'utf-16be' : 'utf-16').decode(hasBOM ? raw : raw);
      } else {
        text = dec.decode(data.subarray(1));
      }
      result[frameId] = text.replace(/\x00/g, '').trim();
    }

    if (frameId === 'APIC') {
      // encoding(1) + mimeType(var) + \x00 + picType(1) + desc(var) + \x00 + data
      let pos = 1;
      const enc = data[0];
      // read mime
      let mimeEnd = pos;
      while (mimeEnd < data.length && data[mimeEnd] !== 0) mimeEnd++;
      const mime = decLatin.decode(data.subarray(pos, mimeEnd)) || 'image/jpeg';
      pos = mimeEnd + 2; // skip mime \x00 and picType
      // skip description
      if (enc === 0 || enc === 3) {
        while (pos < data.length && data[pos] !== 0) pos++;
        pos++;
      } else {
        // UTF-16: null terminator is 2 bytes
        while (pos + 1 < data.length && !(data[pos] === 0 && data[pos+1] === 0)) pos += 2;
        pos += 2;
      }
      if (pos < data.length) {
        result['APIC'] = { bytes: data.subarray(pos), mime, raw: data };
      }
    }

    i += 10 + size;
  }
  return result;
}

// ─── ID3v2 Writer ────────────────────────────────────────────────────────────
function encodeID3Frame(id, data) {
  const idBytes = new TextEncoder().encode(id);
  const frame = new Uint8Array(10 + data.length);
  frame.set(idBytes, 0);
  const s = data.length;
  frame[4] = (s >> 24) & 0xff;
  frame[5] = (s >> 16) & 0xff;
  frame[6] = (s >> 8)  & 0xff;
  frame[7] =  s        & 0xff;
  frame.set(data, 10);
  return frame;
}

function encodeTextFrame(id, text) {
  const enc = new TextEncoder();
  const textBytes = enc.encode(text);
  const data = new Uint8Array(1 + textBytes.length);
  data[0] = 3; // UTF-8
  data.set(textBytes, 1);
  return encodeID3Frame(id, data);
}

function encodeAPICFrame(imageBytes, mime) {
  const enc = new TextEncoder();
  const mimeBytes = enc.encode(mime || 'image/jpeg');
  // encoding(1) + mime + \x00 + picType(1) + desc(\x00)
  const data = new Uint8Array(1 + mimeBytes.length + 1 + 1 + 1 + imageBytes.length);
  let pos = 0;
  data[pos++] = 0; // Latin-1 encoding
  data.set(mimeBytes, pos); pos += mimeBytes.length;
  data[pos++] = 0; // mime null terminator
  data[pos++] = 3; // cover art
  data[pos++] = 0; // empty description
  data.set(imageBytes, pos);
  return encodeID3Frame('APIC', data);
}

function buildID3Tag(title, artist, artBytes, artMime) {
  const frames = [];
  if (title)   frames.push(encodeTextFrame('TIT2', title));
  if (artist)  frames.push(encodeTextFrame('TPE1', artist));
  if (artBytes && artBytes.length) frames.push(encodeAPICFrame(artBytes, artMime));

  const totalFrameSize = frames.reduce((n, f) => n + f.length, 0);
  // Syncsafe encode size
  function toSyncsafe(n) {
    return [
      (n >> 21) & 0x7f,
      (n >> 14) & 0x7f,
      (n >> 7)  & 0x7f,
       n        & 0x7f,
    ];
  }
  const header = new Uint8Array(10);
  header[0] = 0x49; header[1] = 0x44; header[2] = 0x33; // ID3
  header[3] = 3; header[4] = 0; // v2.3
  header[5] = 0; // flags
  header.set(toSyncsafe(totalFrameSize), 6);

  const parts = [header, ...frames];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const tag = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { tag.set(p, off); off += p.length; }
  return tag;
}

// ─── Audio Context ────────────────────────────────────────────────────────────
function getCtx() {
  if (!state.audioCtx) {
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return state.audioCtx;
}

// ─── Reverb IR ───────────────────────────────────────────────────────────────
function makeIR(ctx, decay) {
  const sampleRate = ctx.sampleRate;
  const len = Math.ceil(sampleRate * decay);
  const ir = ctx.createBuffer(2, len, sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.5 + decay * 0.1);
    }
  }
  return ir;
}

// ─── Build Pipeline ──────────────────────────────────────────────────────────
function buildPipeline(ctx) {
  // tear down existing nodes
  if (state.source) { try { state.source.disconnect(); } catch(e) {} }
  if (state.convolver) { try { state.convolver.disconnect(); } catch(e) {} }
  if (state.dryGain) { try { state.dryGain.disconnect(); } catch(e) {} }
  if (state.wetGain) { try { state.wetGain.disconnect(); } catch(e) {} }
  if (state.merger) { try { state.merger.disconnect(); } catch(e) {} }
  if (state.analyser) { try { state.analyser.disconnect(); } catch(e) {} }

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  const dryGain = ctx.createGain();
  const wetGain = ctx.createGain();
  const convolver = ctx.createConvolver();

  dryGain.gain.value = 1 - state.reverbMix;
  wetGain.gain.value = state.reverbMix;
  convolver.buffer = makeIR(ctx, state.reverbDecay);

  dryGain.connect(analyser);
  convolver.connect(wetGain);
  wetGain.connect(analyser);
  analyser.connect(ctx.destination);

  state.analyser = analyser;
  state.dryGain = dryGain;
  state.wetGain = wetGain;
  state.convolver = convolver;
}

function createSource(ctx, offset) {
  if (state.source) { try { state.source.stop(); state.source.disconnect(); } catch(e) {} }
  const src = ctx.createBufferSource();
  src.buffer = state.audioBuffer;
  src.playbackRate.value = state.speed;
  src.loop = state.loopEnabled;
  src.connect(state.dryGain);
  src.connect(state.convolver);
  src.onended = () => {
    if (state.playing) {
      state.playing = false;
      state.pausedAt = 0;
      updatePlayBtn();
    }
  };
  state.source = src;
  src.start(0, offset);
  state.startTime = ctx.currentTime - offset / state.speed;
  state.playing = true;
}

// ─── Playback ────────────────────────────────────────────────────────────────
function play() {
  const ctx = getCtx();
  if (ctx.state === 'suspended') ctx.resume();
  buildPipeline(ctx);
  createSource(ctx, state.pausedAt);
  updatePlayBtn();
  startAnimLoop();
}

function pause() {
  if (!state.source) return;
  state.pausedAt = currentPosition();
  try { state.source.stop(); } catch(e) {}
  state.playing = false;
  updatePlayBtn();
}

function currentPosition() {
  if (!state.playing || !state.audioCtx) return state.pausedAt;
  const elapsed = (state.audioCtx.currentTime - state.startTime) * state.speed;
  return Math.min(elapsed, state.duration);
}

function seekTo(fraction) {
  const offset = fraction * state.duration;
  state.pausedAt = offset;
  if (state.playing) {
    const ctx = getCtx();
    buildPipeline(ctx);
    createSource(ctx, offset);
  }
}

function updatePlayBtn() {
  const icon = document.getElementById('playIcon');
  if (state.playing) {
    icon.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
  } else {
    icon.innerHTML = '<polygon points="5,3 19,12 5,21"/>';
  }
}

function updateLoopBtn() {
  const btn = document.getElementById('loopBtn');
  btn.classList.toggle('active', state.loopEnabled);
  btn.setAttribute('aria-pressed', state.loopEnabled ? 'true' : 'false');
}

// ─── Waveform ────────────────────────────────────────────────────────────────
function buildWaveformData(buffer) {
  const ch = buffer.getChannelData(0);
  const W = 1200;
  const data = new Float32Array(W);
  const step = Math.floor(ch.length / W);
  for (let x = 0; x < W; x++) {
    let max = 0;
    const off = x * step;
    for (let j = 0; j < step; j++) {
      const v = Math.abs(ch[off + j] || 0);
      if (v > max) max = v;
    }
    data[x] = max;
  }
  return data;
}

function drawWaveform() {
  const canvas = document.getElementById('waveform');
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth, H = canvas.offsetHeight;
  if (canvas.width !== W * dpr) { canvas.width = W * dpr; canvas.height = H * dpr; }
  const ctx2d = canvas.getContext('2d');
  ctx2d.scale(dpr, dpr);

  ctx2d.clearRect(0, 0, W, H);

  if (!state.waveformData) { ctx2d.setTransform(1,0,0,1,0,0); return; }

  const pos = state.duration > 0 ? currentPosition() / state.duration : 0;
  const playX = pos * W;

  // Draw bars
  const data = state.waveformData;
  const n = data.length;
  const barW = W / n;

  for (let i = 0; i < n; i++) {
    const x = i * barW;
    const h = Math.max(2, data[i] * H * 0.9);
    const y = (H - h) / 2;
    const frac = x / W;
    if (frac < pos) {
      ctx2d.fillStyle = '#7c3aed';
    } else {
      ctx2d.fillStyle = 'rgba(255,255,255,0.15)';
    }
    ctx2d.fillRect(x, y, Math.max(1, barW - 0.5), h);
  }

  // Playhead
  ctx2d.fillStyle = '#06b6d4';
  ctx2d.fillRect(playX - 1, 0, 2, H);

  ctx2d.setTransform(1,0,0,1,0,0);
}

function startAnimLoop() {
  if (state.animFrame) cancelAnimationFrame(state.animFrame);
  function loop() {
    drawWaveform();
    updateTimeDisplay();
    if (state.playing) {
      state.animFrame = requestAnimationFrame(loop);
    }
  }
  state.animFrame = requestAnimationFrame(loop);
}

function updateTimeDisplay() {
  const pos = currentPosition();
  document.getElementById('timeDisplay').textContent = `${fmt(pos)} / ${fmt(state.duration)}`;
}

// ─── Load Audio ──────────────────────────────────────────────────────────────
async function loadAudioBuffer(arrayBuffer) {
  const ctx = getCtx();
  if (ctx.state === 'suspended') ctx.resume();
  const buf = await ctx.decodeAudioData(arrayBuffer.slice(0));
  return buf;
}

async function loadFile(arrayBuffer, filename, { autoPlay = true } = {}) {
  showLoading(true);
  try {
    // Parse ID3 tags
    const tags = readID3(arrayBuffer);
    state.title = tags['TIT2'] || filename.replace(/\.mp3$/i, '') || 'Unknown Title';
    state.artist = tags['TPE1'] || 'Unknown Artist';

    if (tags['APIC']) {
      const { bytes, mime } = tags['APIC'];
      state.artBytes = new Uint8Array(bytes);
      state.artMime = mime;
      if (state.artBlob) URL.revokeObjectURL(state.artBlob);
      state.artBlob = URL.createObjectURL(new Blob([bytes], { type: mime }));
    } else {
      state.artBlob = null;
      state.artBytes = null;
      state.artMime = 'image/jpeg';
    }

    // Decode audio
    const buf = await loadAudioBuffer(arrayBuffer);
    state.audioBuffer = buf;
    state.duration = buf.duration;
    state.pausedAt = 0;
    state.playing = false;
    if (state.source) { try { state.source.stop(); } catch(e) {} state.source = null; }

    state.waveformData = buildWaveformData(buf);

    // Update UI
    updateTrackUI();
    showPlayerUI(true);
    toast('Track loaded');
    if (autoPlay) play();
  } catch (err) {
    toast('Failed to decode audio: ' + err.message);
    console.error(err);
  } finally {
    showLoading(false);
  }
}

function updateTrackUI() {
  document.getElementById('trackTitle').textContent = state.title;
  document.getElementById('trackArtist').textContent = state.artist;
  document.getElementById('trackDuration').textContent = fmt(state.duration);

  const artEl = document.getElementById('albumArt');
  if (state.artBlob) {
    artEl.innerHTML = `<img src="${state.artBlob}" alt="Album art">`;
  } else {
    artEl.innerHTML = '🎵';
  }
}

function showPlayerUI(show) {
  const els = ['trackCard', 'waveformWrap', 'transport', 'effects', 'downloadBtn'];
  els.forEach(id => {
    document.getElementById(id).classList.toggle('hidden', !show);
  });
  if (show) drawWaveform();
}

function showLoading(on) {
  document.getElementById('downloadBtn').disabled = on;
}

// ─── Effect Sliders ──────────────────────────────────────────────────────────
function applyEffects() {
  if (!state.playing || !state.dryGain) return;
  state.dryGain.gain.value = 1 - state.reverbMix;
  state.wetGain.gain.value = state.reverbMix;
  // Rebuild IR only (speed requires new source)
}

function rebuildPlayback() {
  if (!state.audioBuffer) return;
  if (state.playing) {
    const offset = currentPosition();
    state.pausedAt = offset;
    const ctx = getCtx();
    buildPipeline(ctx);
    createSource(ctx, offset);
  }
}

document.getElementById('speedSlider').addEventListener('input', e => {
  state.speed = e.target.value / 100;
  document.getElementById('speedVal').textContent = state.speed.toFixed(2) + '×';
  if (state.source) state.source.playbackRate.value = state.speed;
});

document.getElementById('reverbSlider').addEventListener('input', e => {
  state.reverbMix = e.target.value / 100;
  document.getElementById('reverbVal').textContent = e.target.value + '%';
  applyEffects();
});

document.getElementById('decaySlider').addEventListener('input', e => {
  state.reverbDecay = e.target.value / 10;
  document.getElementById('decayVal').textContent = state.reverbDecay.toFixed(1) + 's';
  if (state.playing) rebuildPlayback();
  else if (state.convolver) {
    const ctx = getCtx();
    state.convolver.buffer = makeIR(ctx, state.reverbDecay);
  }
});

// ─── Transport Controls ──────────────────────────────────────────────────────
document.getElementById('playBtn').addEventListener('click', () => {
  if (!state.audioBuffer) return;
  if (state.playing) pause();
  else play();
});

document.getElementById('startBtn').addEventListener('click', () => {
  if (!state.audioBuffer) return;
  state.pausedAt = 0;
  if (state.playing) {
    const ctx = getCtx();
    buildPipeline(ctx);
    createSource(ctx, 0);
  }
  drawWaveform();
  updateTimeDisplay();
});

document.getElementById('endBtn').addEventListener('click', () => {
  if (!state.audioBuffer) return;
  state.pausedAt = state.duration;
  if (state.source) {
    state.playing = false;
    try { state.source.stop(); state.source.disconnect(); } catch(e) {}
    state.source = null;
    updatePlayBtn();
  }
  drawWaveform();
  updateTimeDisplay();
});

document.getElementById('loopBtn').addEventListener('click', () => {
  state.loopEnabled = !state.loopEnabled;
  settings.loopEnabled = state.loopEnabled;
  saveSettings();
  if (state.source) state.source.loop = state.loopEnabled;
  updateLoopBtn();
  document.getElementById('loopBtn').title = state.loopEnabled ? 'Loop On' : 'Loop Off';
});

// ─── Waveform scrubbing ──────────────────────────────────────────────────────
(function() {
  const canvas = document.getElementById('waveform');
  let scrubbing = false;
  function doSeek(e) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    seekTo(Math.max(0, Math.min(1, x / rect.width)));
    drawWaveform();
    updateTimeDisplay();
  }
  canvas.addEventListener('mousedown', e => { scrubbing = true; doSeek(e); });
  canvas.addEventListener('mousemove', e => { if (scrubbing) doSeek(e); });
  canvas.addEventListener('mouseup', () => scrubbing = false);
  canvas.addEventListener('touchstart', e => { e.preventDefault(); scrubbing = true; doSeek(e); }, { passive: false });
  canvas.addEventListener('touchmove', e => { e.preventDefault(); if (scrubbing) doSeek(e); }, { passive: false });
  canvas.addEventListener('touchend', () => scrubbing = false);
})();

// ─── File Drop / Pick ────────────────────────────────────────────────────────
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleFileObject(file);
});

fileInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) handleFileObject(file);
  fileInput.value = '';
});

function handleFileObject(file) {
  const reader = new FileReader();
  reader.onload = ev => loadFile(ev.target.result, file.name);
  reader.readAsArrayBuffer(file);
}

// ─── Server Bridge ───────────────────────────────────────────────────────────
const SERVER = 'http://localhost:7337';

async function checkServer() {
  try {
    const r = await fetch(`${SERVER}/ping`, { signal: AbortSignal.timeout(800) });
    if (r.ok) {
      state.serverOnline = true;
      document.getElementById('urlRow').style.display = 'flex';
      document.getElementById('urlLoadBtn').disabled = false;
      const statusEl = document.getElementById('serverStatus');
      statusEl.style.display = 'block';
      statusEl.textContent = '● Bridge server connected';
      statusEl.className = 'server-status online';
    }
  } catch (_) {
    // Server not running — show instructions only
    const statusEl = document.getElementById('serverStatus');
    statusEl.style.display = 'block';
    statusEl.className = 'server-status';
    statusEl.textContent = 'Run server.py to enable Spotify/YouTube loading';
  }
}

checkServer();

document.getElementById('urlLoadBtn').addEventListener('click', async () => {
  const url = document.getElementById('urlInput').value.trim();
  if (!url) return;
  const btn = document.getElementById('urlLoadBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Loading…';
  try {
    let endpoint = url.includes('spotify') ? '/api/spotify' : '/api/youtube';
    const res = await fetch(`${SERVER}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(300000),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');

    // Fetch the MP3 file via the server
    const fileRes = await fetch(`${SERVER}/api/file?path=${encodeURIComponent(data.file)}&consume=1`);
    if (!fileRes.ok) throw new Error('Could not retrieve file');
    const ab = await fileRes.arrayBuffer();
    await loadFile(ab, data.title + '.mp3');
    document.getElementById('urlInput').value = '';
  } catch (err) {
    toast('Error: ' + err.message, 5000);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Load';
  }
});

// ─── Download ────────────────────────────────────────────────────────────────
document.getElementById('downloadBtn').addEventListener('click', () => {
  if (!state.audioBuffer) return;
  const title = document.getElementById('trackTitle').textContent.trim() || state.title;
  const suffix = settings.suffix;
  const artist = state.artist;
  const suggested = sanitize(`${artist} - ${title}${suffix}`) + '.mp3';
  document.getElementById('filenameInput').value = suggested;
  document.getElementById('progressWrap').style.display = 'none';
  document.getElementById('progressBar').style.width = '0%';
  document.getElementById('modalConfirm').disabled = false;
  document.getElementById('modalConfirm').textContent = 'Export';
  document.getElementById('modalOverlay').classList.add('open');
  document.getElementById('filenameInput').focus();
  document.getElementById('filenameInput').select();
});

document.getElementById('modalCancel').addEventListener('click', closeModal);
document.getElementById('modalOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modalOverlay')) closeModal();
});
function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
}

document.getElementById('modalConfirm').addEventListener('click', async () => {
  const filename = document.getElementById('filenameInput').value.trim() || 'track.mp3';
  await doExport(filename);
});

async function doExport(filename) {
  const confirmBtn = document.getElementById('modalConfirm');
  confirmBtn.disabled = true;
  confirmBtn.innerHTML = '<span class="spinner"></span>Rendering…';
  document.getElementById('progressWrap').style.display = 'block';
  setProgress(0);

  try {
    const buf = state.audioBuffer;
    const speed = state.speed;
    const mix = state.reverbMix;
    const decay = state.reverbDecay;
    const outDuration = buf.duration / speed;
    const sr = buf.sampleRate;

    // OfflineAudioContext: same pipeline
    const offCtx = new OfflineAudioContext(2, Math.ceil(outDuration * sr), sr);

    const src = offCtx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = speed;

    const dryGain = offCtx.createGain();
    const wetGain = offCtx.createGain();
    const conv = offCtx.createConvolver();
    dryGain.gain.value = 1 - mix;
    wetGain.gain.value = mix;
    conv.buffer = makeIR(offCtx, decay);

    src.connect(dryGain);
    src.connect(conv);
    conv.connect(wetGain);
    dryGain.connect(offCtx.destination);
    wetGain.connect(offCtx.destination);

    src.start(0);
    setProgress(10);

    const rendered = await offCtx.startRendering();
    setProgress(40);

    // Float32 → Int16
    function f32ToI16(f32) {
      const i16 = new Int16Array(f32.length);
      for (let i = 0; i < f32.length; i++) {
        const v = Math.max(-1, Math.min(1, f32[i]));
        i16[i] = v < 0 ? v * 32768 : v * 32767;
      }
      return i16;
    }

    const left  = f32ToI16(rendered.getChannelData(0));
    const right = rendered.numberOfChannels > 1 ? f32ToI16(rendered.getChannelData(1)) : left;

    // Encode MP3 with lamejs
    const encoder = new lamejs.Mp3Encoder(2, sr, 192);
    const chunkSize = 1152;
    const mp3Parts = [];
    const total = left.length;

    for (let i = 0; i < total; i += chunkSize) {
      const l = left.subarray(i, i + chunkSize);
      const r = right.subarray(i, i + chunkSize);
      const enc = encoder.encodeBuffer(l, r);
      if (enc.length) mp3Parts.push(new Uint8Array(enc));
      if (i % (chunkSize * 100) === 0) {
        setProgress(40 + 50 * (i / total));
        await new Promise(r => setTimeout(r, 0)); // yield to UI
      }
    }
    const flush = encoder.flush();
    if (flush.length) mp3Parts.push(new Uint8Array(flush));
    setProgress(92);

    // Build ID3 tag
    const title = document.getElementById('trackTitle').textContent.trim() || state.title;
    const artBytes = state.artBytes
      ? (state.artBytes instanceof Uint8Array ? new Uint8Array(state.artBytes) : new Uint8Array(state.artBytes))
      : null;
    const id3Tag = buildID3Tag(title + settings.suffix, state.artist, artBytes, state.artMime);

    // Assemble: ID3 + MP3 bytes
    const mp3Len = mp3Parts.reduce((n, p) => n + p.length, 0);
    const final = new Uint8Array(id3Tag.length + mp3Len);
    final.set(id3Tag, 0);
    let off = id3Tag.length;
    for (const p of mp3Parts) { final.set(p, off); off += p.length; }

    setProgress(98);

    // Download
    const blob = new Blob([final], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.endsWith('.mp3') ? filename : filename + '.mp3';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);

    setProgress(100);
    toast('Download started!');
    setTimeout(closeModal, 800);
  } catch (err) {
    toast('Export failed: ' + err.message, 5000);
    console.error(err);
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Export';
  }
}

function setProgress(pct) {
  document.getElementById('progressBar').style.width = pct + '%';
}

// ─── Settings Panel ──────────────────────────────────────────────────────────
document.getElementById('gearBtn').addEventListener('click', () => {
  document.getElementById('settingsPanel').classList.add('open');
  document.getElementById('overlay').classList.add('open');
});
function closeSettings() {
  document.getElementById('settingsPanel').classList.remove('open');
  document.getElementById('overlay').classList.remove('open');
}
document.getElementById('closeSettings').addEventListener('click', closeSettings);
document.getElementById('overlay').addEventListener('click', closeSettings);

syncSettingsUI();

document.getElementById('suffixSetting').addEventListener('input', e => {
  settings.suffix = e.target.value;
  saveSettings();
});
document.getElementById('defaultSpeed').addEventListener('change', e => {
  settings.defaultSpeed = +e.target.value;
  saveSettings();
  if (!state.audioBuffer) {
    state.speed = settings.defaultSpeed;
    const sl = document.getElementById('speedSlider');
    sl.value = Math.round(settings.defaultSpeed * 100);
    document.getElementById('speedVal').textContent = settings.defaultSpeed.toFixed(2) + '×';
  }
});
document.getElementById('defaultReverb').addEventListener('change', e => {
  settings.defaultReverb = +e.target.value;
  saveSettings();
  if (!state.audioBuffer) {
    state.reverbMix = settings.defaultReverb / 100;
    const sl = document.getElementById('reverbSlider');
    sl.value = settings.defaultReverb;
    document.getElementById('reverbVal').textContent = settings.defaultReverb + '%';
  }
});
document.getElementById('defaultDecay').addEventListener('change', e => {
  settings.defaultDecay = +e.target.value;
  saveSettings();
  if (!state.audioBuffer) {
    state.reverbDecay = settings.defaultDecay;
    const sl = document.getElementById('decaySlider');
    sl.value = Math.round(settings.defaultDecay * 10);
    document.getElementById('decayVal').textContent = settings.defaultDecay.toFixed(1) + 's';
  }
});

// ─── Resize waveform on window resize ────────────────────────────────────────
window.addEventListener('resize', () => { if (state.waveformData) drawWaveform(); });

// ─── Keyboard shortcuts ──────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || (e.target.getAttribute && e.target.getAttribute('contenteditable') === 'true')) return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (state.audioBuffer) state.playing ? pause() : play();
  }
});
</script>
</body>
</html>
"""

# Inject lamejs
html = HTML.replace("LAMEJS_PLACEHOLDER", lame_js)

out = here / "index.html"
out.write_text(html, encoding="utf-8")
print(f"Built {out} ({out.stat().st_size // 1024} KB)")
