import { state, settings } from './state.js';
import { clampSpeed, getExportSuffix, sanitize, toast } from './utils.js';
import {
  play, pause, seekTo,
  currentPosition, getCtx,
  updatePlayBtn, updateLoopBtn,
  makeIR, applyEffects, rebuildPlayback,
  applyVolume, updateMuteBtn,
} from './audio.js';
import { drawWaveform } from './waveform.js';
import {
  drawBottomVisualizer,
  updateBottomVisualizerVisibility,
  updateBottomVisualizerPlaybackState,
  beginBottomVisualizerFade,
  updateTimeDisplay,
} from './visualizer.js';
import { handleFileObject, resetStudio, updateSourceImportUI } from './loader.js';
import { initImporter } from './importer.js';
import { doExport, closeModal, setProgress } from './exporter.js';
import { loadSettings, saveSettings, syncSettingsUI } from './settings.js';
import { applyThemeFromCurrentTrack } from './theme.js';

// ─── Init ────────────────────────────────────────────────────────────────────
loadSettings();
syncSettingsUI();
initImporter();

// ─── Effect Sliders ──────────────────────────────────────────────────────────
document.getElementById('speedSlider').addEventListener('input', e => {
  const nextSpeed = e.target.value / 100;
  if (state.playing && state.audioCtx) {
    const pos = currentPosition();
    state.speed = nextSpeed;
    state.startTime = state.audioCtx.currentTime - pos / state.speed;
  } else {
    state.speed = nextSpeed;
  }
  document.getElementById('speedVal').textContent = state.speed.toFixed(2) + '×';
  if (state.source) state.source.playbackRate.value = state.speed;
  updateTimeDisplay();
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
  seekTo(0);
  drawWaveform();
  updateTimeDisplay();
});

document.getElementById('endBtn').addEventListener('click', () => {
  if (!state.audioBuffer) return;
  state.pausedAt = state.duration;
  if (state.source) {
    state.playing = false;
    beginBottomVisualizerFade();
    try { state.source.stop(); state.source.disconnect(); } catch(e) {}
    state.source = null;
    updatePlayBtn();
    updateBottomVisualizerPlaybackState();
  }
  drawWaveform();
  updateTimeDisplay();
});

document.getElementById('loopBtn').addEventListener('click', () => {
  const wasLooping = state.loopEnabled;
  const loopPos = wasLooping ? currentPosition() : 0;
  state.loopEnabled = !state.loopEnabled;
  settings.loopEnabled = state.loopEnabled;
  saveSettings();
  if (wasLooping && !state.loopEnabled && state.playing && state.audioCtx) {
    state.startTime = state.audioCtx.currentTime - loopPos / state.speed;
  }
  if (state.source) state.source.loop = state.loopEnabled;
  updateLoopBtn();
  document.getElementById('loopBtn').title = state.loopEnabled ? 'Loop On' : 'Loop Off';
});

// ─── Volume Control ──────────────────────────────────────────────────────────
function updateVolumeTrack() {
  const slider = document.getElementById('volumeSlider');
  const pct = state.muted ? 0 : Math.round(state.volume * 100);
  slider.style.background = `linear-gradient(to right, var(--accent1) 0%, var(--accent2) ${pct}%, var(--border) ${pct}%)`;
}

document.getElementById('muteBtn').addEventListener('click', () => {
  state.muted = !state.muted;
  applyVolume();
  updateMuteBtn();
  updateVolumeTrack();
});

document.getElementById('volumeSlider').addEventListener('input', e => {
  state.volume = e.target.value / 100;
  if (state.muted && state.volume > 0) {
    state.muted = false;
  }
  applyVolume();
  updateMuteBtn();
  updateVolumeTrack();
});
document.getElementById('volumeSlider').addEventListener('pointerup', e => e.target.blur());

updateVolumeTrack();

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

// ─── New Song ────────────────────────────────────────────────────────────────
document.getElementById('newSongBtn').addEventListener('click', resetStudio);

// ─── Export Modal ────────────────────────────────────────────────────────────
document.getElementById('downloadBtn').addEventListener('click', () => {
  if (!state.audioBuffer) return;
  const title = state.title;
  const suffix = getExportSuffix();
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
document.getElementById('modalConfirm').addEventListener('click', async () => {
  const filename = document.getElementById('filenameInput').value.trim() || 'track.mp3';
  await doExport(filename);
});

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

document.getElementById('defaultSpeed').addEventListener('change', e => {
  settings.defaultSpeed = clampSpeed(+e.target.value);
  e.target.value = settings.defaultSpeed;
  saveSettings();
  if (!state.audioBuffer) {
    state.speed = settings.defaultSpeed;
    document.getElementById('speedSlider').value = Math.round(settings.defaultSpeed * 100);
    document.getElementById('speedVal').textContent = settings.defaultSpeed.toFixed(2) + '×';
  }
});
document.getElementById('defaultReverb').addEventListener('change', e => {
  settings.defaultReverb = +e.target.value;
  saveSettings();
  if (!state.audioBuffer) {
    state.reverbMix = settings.defaultReverb / 100;
    document.getElementById('reverbSlider').value = settings.defaultReverb;
    document.getElementById('reverbVal').textContent = settings.defaultReverb + '%';
  }
});
document.getElementById('defaultDecay').addEventListener('change', e => {
  settings.defaultDecay = +e.target.value;
  saveSettings();
  if (!state.audioBuffer) {
    state.reverbDecay = settings.defaultDecay;
    document.getElementById('decaySlider').value = Math.round(settings.defaultDecay * 10);
    document.getElementById('decayVal').textContent = settings.defaultDecay.toFixed(1) + 's';
  }
});
document.getElementById('bottomVisualizerToggle').addEventListener('change', e => {
  settings.visualizerEnabled = e.target.checked;
  state.visualizerEnabled = settings.visualizerEnabled;
  saveSettings();
  updateBottomVisualizerVisibility();
  updateBottomVisualizerPlaybackState();
  drawBottomVisualizer(!state.playing);
});
document.getElementById('artThemeToggle').addEventListener('change', e => {
  settings.artThemeEnabled = e.target.checked;
  saveSettings();
  void applyThemeFromCurrentTrack();
});

// ─── Resize waveform on window resize ────────────────────────────────────────
window.addEventListener('resize', () => {
  if (state.waveformData) drawWaveform();
  drawBottomVisualizer(!state.playing);
});

// ─── Keyboard shortcuts ──────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (state.audioBuffer) state.playing ? pause() : play();
  }
  if (e.key === 'N' && e.shiftKey) {
    if (state.audioBuffer) { e.preventDefault(); resetStudio(); }
  }
});
