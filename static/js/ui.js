import { state, settings } from './state.js';
import { clampSpeed, getExportSuffix, sanitize } from './utils.js';
import {
  play, pause, seekTo,
  currentPosition, getCtx,
  updatePlayBtn, updateLoopBtn,
  makeIR, applyEffects, rebuildPlayback,
  applyVolume, updateMuteBtn, stopActiveSource,
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
import { doExport, closeModal } from './exporter.js';
import { loadSettings, saveSettings, savePlaybackState, syncSettingsUI } from './settings.js';
import { applyThemeFromCurrentTrack } from './theme.js';
import { $id, setText, toggleClass } from './dom.js';
import {
  syncSpeedControls,
  syncReverbControls,
  syncDecayControls,
  syncLoopButtonTitle,
} from './controls.js';

// ─── Init ────────────────────────────────────────────────────────────────────
loadSettings();
syncSettingsUI();
initImporter();

// ─── Effect Sliders ──────────────────────────────────────────────────────────
$id('speedSlider').addEventListener('input', e => {
  const nextSpeed = e.target.value / 100;
  if (state.playing && state.audioCtx) {
    const pos = currentPosition();
    state.speed = nextSpeed;
    state.startTime = state.audioCtx.currentTime - pos / state.speed;
  } else {
    state.speed = nextSpeed;
  }
  syncSpeedControls(state.speed);
  if (state.source) state.source.playbackRate.value = state.speed;
  updateTimeDisplay();
  savePlaybackState();
});

$id('reverbSlider').addEventListener('input', e => {
  state.reverbMix = e.target.value / 100;
  syncReverbControls(state.reverbMix);
  applyEffects();
  savePlaybackState();
});

$id('decaySlider').addEventListener('input', e => {
  state.reverbDecay = e.target.value / 10;
  syncDecayControls(state.reverbDecay);
  if (state.playing) rebuildPlayback();
  else if (state.convolver) {
    const ctx = getCtx();
    state.convolver.buffer = makeIR(ctx, state.reverbDecay);
  }
  savePlaybackState();
});

// ─── Transport Controls ──────────────────────────────────────────────────────
$id('playBtn').addEventListener('click', () => {
  if (!state.audioBuffer) return;
  if (state.playing) pause();
  else play();
});

$id('startBtn').addEventListener('click', () => {
  if (!state.audioBuffer) return;
  seekTo(0);
  drawWaveform();
  updateTimeDisplay();
});

$id('endBtn').addEventListener('click', () => {
  if (!state.audioBuffer) return;
  state.pausedAt = state.duration;
  if (state.source) {
    state.playing = false;
    beginBottomVisualizerFade();
    stopActiveSource();
    updatePlayBtn();
    updateBottomVisualizerPlaybackState();
  }
  drawWaveform();
  updateTimeDisplay();
});

$id('loopBtn').addEventListener('click', () => {
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
  syncLoopButtonTitle(state.loopEnabled);
});

// ─── Volume Control ──────────────────────────────────────────────────────────
function updateVolumeTrack() {
  const slider = $id('volumeSlider');
  const pct = state.muted ? 0 : Math.round(state.volume * 100);
  slider.style.background = `linear-gradient(to right, var(--accent1) 0%, var(--accent2) ${pct}%, var(--border) ${pct}%)`;
}

$id('muteBtn').addEventListener('click', () => {
  state.muted = !state.muted;
  applyVolume();
  updateMuteBtn();
  updateVolumeTrack();
});

$id('volumeSlider').addEventListener('input', e => {
  state.volume = e.target.value / 100;
  if (state.muted && state.volume > 0) {
    state.muted = false;
  }
  applyVolume();
  updateMuteBtn();
  updateVolumeTrack();
});
$id('volumeSlider').addEventListener('pointerup', e => e.target.blur());

updateVolumeTrack();

// ─── Waveform scrubbing ──────────────────────────────────────────────────────
(function() {
  const canvas = $id('waveform');
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
const dropZone = $id('dropZone');
const fileInput = $id('fileInput');

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
$id('newSongBtn').addEventListener('click', resetStudio);

// ─── Export Modal ────────────────────────────────────────────────────────────
$id('downloadBtn').addEventListener('click', () => {
  if (!state.audioBuffer) return;
  const title = state.title;
  const suffix = getExportSuffix();
  const artist = state.artist;
  const suggested = sanitize(`${artist} - ${title}${suffix}`) + '.mp3';
  $id('filenameInput').value = suggested;
  $id('progressWrap').style.display = 'none';
  $id('progressBar').style.width = '0%';
  $id('modalConfirm').disabled = false;
  setText($id('modalConfirm'), 'Export');
  toggleClass($id('modalOverlay'), 'open', true);
  $id('filenameInput').focus();
  $id('filenameInput').select();
});

$id('modalCancel').addEventListener('click', closeModal);
$id('modalOverlay').addEventListener('click', e => {
  if (e.target === $id('modalOverlay')) closeModal();
});
$id('modalConfirm').addEventListener('click', async () => {
  const filename = $id('filenameInput').value.trim() || 'track.mp3';
  await doExport(filename);
});

// ─── Settings Panel ──────────────────────────────────────────────────────────
$id('gearBtn').addEventListener('click', () => {
  toggleClass($id('settingsPanel'), 'open', true);
  toggleClass($id('overlay'), 'open', true);
});
function closeSettings() {
  toggleClass($id('settingsPanel'), 'open', false);
  toggleClass($id('overlay'), 'open', false);
}
$id('closeSettings').addEventListener('click', closeSettings);
$id('overlay').addEventListener('click', closeSettings);

$id('defaultSpeed').addEventListener('change', e => {
  settings.defaultSpeed = clampSpeed(+e.target.value);
  e.target.value = settings.defaultSpeed;
  saveSettings();
  if (!state.audioBuffer) {
    state.speed = settings.defaultSpeed;
    syncSpeedControls(settings.defaultSpeed);
  }
});
$id('defaultReverb').addEventListener('change', e => {
  settings.defaultReverb = +e.target.value;
  saveSettings();
  if (!state.audioBuffer) {
    state.reverbMix = settings.defaultReverb / 100;
    syncReverbControls(state.reverbMix);
  }
});
$id('defaultDecay').addEventListener('change', e => {
  settings.defaultDecay = +e.target.value;
  saveSettings();
  if (!state.audioBuffer) {
    state.reverbDecay = settings.defaultDecay;
    syncDecayControls(settings.defaultDecay);
  }
});
$id('bottomVisualizerToggle').addEventListener('change', e => {
  settings.visualizerEnabled = e.target.checked;
  state.visualizerEnabled = settings.visualizerEnabled;
  saveSettings();
  updateBottomVisualizerVisibility();
  updateBottomVisualizerPlaybackState();
  drawBottomVisualizer(!state.playing);
});
$id('artThemeToggle').addEventListener('change', e => {
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
  if (e.key === 'm' || e.key === 'M') {
    e.preventDefault();
    state.muted = !state.muted;
    applyVolume();
    updateMuteBtn();
    updateVolumeTrack();
  }
});
