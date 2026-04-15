import {
  state,
  settings,
  MIN_PLAYLIST_PRELOAD,
  MAX_PLAYLIST_PRELOAD,
  DEFAULT_PLAYLIST_PRELOAD,
} from './state.js';
import { clampSpeed, getExportSuffix, sanitize } from './utils.js';
import {
  play, pause, seekTo, silenceForScrub,
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
  startAnimLoop,
  stopAnimLoopIfIdle,
} from './visualizer.js';
import { handleFileObject, resetStudio, updateSourceImportUI } from './loader.js';
import { initImporter } from './importer.js';
import { doExport, closeModal } from './exporter.js';
import { loadSettings, saveSettings, syncSettingsUI } from './settings.js';
import { initSpotifyAuth } from './spotify_auth.js';
import { applyThemeFromCurrentTrack } from './theme.js';
import { $id, setText, toggleClass } from './dom.js';
import {
  jumpToTrack,
  isPlaylistActive,
  getCurrentIndex,
  refreshPreloadWindow,
} from './playlist.js';
import {
  syncSpeedControls,
  syncReverbControls,
  syncDecayControls,
  syncLoopButtonTitle,
} from './controls.js';
import { initMediaSession } from './mediasession.js';

// ─── Init ────────────────────────────────────────────────────────────────────
loadSettings();
syncSettingsUI();
initSpotifyAuth();
initImporter();
initMediaSession({
  play: () => { if (state.audioBuffer) play(); },
  pause: () => { if (state.audioBuffer) pause(); },
  nexttrack: () => {
    if (!state.audioBuffer) return;
    if (isPlaylistActive()) jumpToTrack(getCurrentIndex() + 1);
  },
  previoustrack: () => {
    if (!state.audioBuffer) return;
    if (isPlaylistActive()) {
      if (currentPosition() > 3) { seekTo(0); drawWaveform(); updateTimeDisplay(); }
      else jumpToTrack(getCurrentIndex() - 1);
    } else {
      seekTo(0); drawWaveform(); updateTimeDisplay();
    }
  },
});

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
});

$id('reverbSlider').addEventListener('input', e => {
  state.reverbMix = e.target.value / 100;
  syncReverbControls(state.reverbMix);
  applyEffects();
});

$id('decaySlider').addEventListener('input', e => {
  state.reverbDecay = e.target.value / 10;
  syncDecayControls(state.reverbDecay);
  if (state.convolver) {
    const ctx = getCtx();
    state.convolver.buffer = makeIR(ctx, state.reverbDecay);
  }
});

// ─── Transport Controls ──────────────────────────────────────────────────────
$id('playBtn').addEventListener('click', () => {
  if (!state.audioBuffer) return;
  if (state.playing) pause();
  else play();
});

$id('startBtn').addEventListener('click', () => {
  if (!state.audioBuffer) return;
  if (isPlaylistActive()) {
    // In playlist mode: go to previous track (or start of track if near beginning)
    if (currentPosition() > 3) {
      seekTo(0); drawWaveform(); updateTimeDisplay();
    } else {
      jumpToTrack(getCurrentIndex() - 1);
    }
    return;
  }
  seekTo(0);
  drawWaveform();
  updateTimeDisplay();
});

$id('endBtn').addEventListener('click', () => {
  if (!state.audioBuffer) return;
  if (isPlaylistActive()) {
    jumpToTrack(getCurrentIndex() + 1);
    return;
  }
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

  function getFraction(e) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    return Math.max(0, Math.min(1, x / rect.width));
  }

  function onScrubStart(e) {
    scrubbing = true;
    state.scrubFraction = getFraction(e);
    silenceForScrub();
    drawWaveform();
    updateTimeDisplay();
  }

  function onScrubMove(e) {
    if (!scrubbing) return;
    state.scrubFraction = getFraction(e);
    drawWaveform();
    updateTimeDisplay();
  }

  function onScrubEnd(e) {
    if (!scrubbing) return;
    scrubbing = false;
    const fraction = state.scrubFraction;
    state.scrubFraction = null;
    seekTo(fraction);
    drawWaveform();
    updateTimeDisplay();
  }

  canvas.addEventListener('mousedown', onScrubStart);
  canvas.addEventListener('mousemove', onScrubMove);
  canvas.addEventListener('mouseup', onScrubEnd);
  window.addEventListener('mouseup', () => { if (scrubbing) onScrubEnd(); });
  canvas.addEventListener('touchstart', e => { e.preventDefault(); onScrubStart(e); }, { passive: false });
  canvas.addEventListener('touchmove', e => { e.preventDefault(); onScrubMove(e); }, { passive: false });
  canvas.addEventListener('touchend', e => { e.preventDefault(); onScrubEnd(e); }, { passive: false });
})();

// ─── File Drop / Pick ────────────────────────────────────────────────────────
const dropZone = $id('dropZone');
const fileInput = $id('fileInput');

dropZone.addEventListener('dragover', e => { if (state.importing) return; e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  if (state.importing) return;
  const file = e.dataTransfer.files[0];
  if (file) handleFileObject(file);
});

fileInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (file && !state.importing) handleFileObject(file);
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
  import('./spotify_auth.js').then(m => m.refreshSpotifyStatus());
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
$id('playlistPreloadCount').addEventListener('change', e => {
  const rounded = Math.round(Number(e.target.value));
  const next = Number.isFinite(rounded)
    ? Math.min(MAX_PLAYLIST_PRELOAD, Math.max(MIN_PLAYLIST_PRELOAD, rounded))
    : DEFAULT_PLAYLIST_PRELOAD;
  settings.playlistPreload = next;
  e.target.value = next;
  saveSettings();
  refreshPreloadWindow();
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
  if ((e.key === 'm' || e.key === 'M') && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    state.muted = !state.muted;
    applyVolume();
    updateMuteBtn();
    updateVolumeTrack();
  }
  if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey && !e.altKey) {
    if (state.audioBuffer) { e.preventDefault(); toggleVizFullscreen(); }
  }
  if (e.key === 'Escape' && document.body.classList.contains('viz-fullscreen')) {
    exitVizFullscreen();
  }
});

// ─── Visualizer Fullscreen ───────────────────────────────────────────────────
function syncVizFsPlayBtn() {
  const icon = $id('vizFsPlayIcon');
  if (!icon) return;
  if (state.playing) {
    icon.innerHTML = '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>';
  } else {
    icon.innerHTML = '<polygon points="5,3 19,12 5,21"/>';
  }
}

function syncVizFsMuteBtn() {
  const btn = $id('vizFsMuteBtn');
  if (!btn) return;
  const muted = state.muted || state.volume === 0;
  btn.setAttribute('aria-pressed', String(muted));
  const icon = $id('vizFsMuteIcon');
  if (!icon) return;
  if (muted) {
    icon.innerHTML = '<path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor" stroke="none"/><line x1="23" y1="9" x2="17" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="17" y1="9" x2="23" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
  } else {
    icon.innerHTML = '<path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor" stroke="none"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>';
  }
}

function syncVizFsLoopBtn() {
  const btn = $id('vizFsLoopBtn');
  if (!btn) return;
  btn.classList.toggle('active', state.loopEnabled);
  btn.setAttribute('aria-pressed', String(state.loopEnabled));
  btn.title = state.loopEnabled ? 'Loop On' : 'Loop Off';
}

function syncVizFsMeta() {
  const titleEl = $id('trackTitle');
  const artistEl = $id('trackArtist');
  const artEl = $id('albumArt');
  const fsTitle = $id('vizFsTitle');
  const fsArtist = $id('vizFsArtist');
  const fsArt = $id('vizFsArt');
  if (fsTitle) setText(fsTitle, titleEl ? titleEl.textContent : '—');
  if (fsArtist) setText(fsArtist, artistEl ? artistEl.textContent : '—');
  if (fsArt && artEl) fsArt.innerHTML = artEl.innerHTML;
}

function syncVizFsVolumeSlider() {
  const slider = $id('vizFsVolumeSlider');
  if (!slider) return;
  slider.value = Math.round(state.volume * 100);
  const pct = state.muted ? 0 : Math.round(state.volume * 100);
  slider.style.background = `linear-gradient(to right, var(--accent1) 0%, var(--accent2) ${pct}%, var(--border) ${pct}%)`;
}

function syncVizFullscreenBar() {
  syncVizFsPlayBtn();
  syncVizFsMuteBtn();
  syncVizFsLoopBtn();
  syncVizFsVolumeSlider();
  syncVizFsMeta();
  updateTimeDisplay();
}

function vizFsTransition(callback) {
  const overlay = $id('vizFsTransitionOverlay');
  overlay.classList.add('visible');
  setTimeout(() => {
    callback();
    requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.remove('visible')));
  }, 220);
}

function enterVizFullscreen() {
  vizFsTransition(() => {
    document.body.classList.add('viz-fullscreen');
    syncVizFullscreenBar();
    if (!state.animFrame) startAnimLoop();
  });
}

function exitVizFullscreen() {
  vizFsTransition(() => {
    document.body.classList.remove('viz-fullscreen');
    stopAnimLoopIfIdle();
    drawBottomVisualizer(!state.playing);
    drawWaveform();
  });
}

function toggleVizFullscreen() {
  if (document.body.classList.contains('viz-fullscreen')) {
    exitVizFullscreen();
  } else {
    enterVizFullscreen();
  }
}

$id('vizFullscreenBtn').addEventListener('click', toggleVizFullscreen);
$id('vizFsExitBtn').addEventListener('click', exitVizFullscreen);

// Fullscreen transport mirrors main transport
$id('vizFsPlayBtn').addEventListener('click', () => {
  if (!state.audioBuffer) return;
  if (state.playing) pause(); else play();
  syncVizFsPlayBtn();
});
$id('vizFsStartBtn').addEventListener('click', () => $id('startBtn').click());
$id('vizFsEndBtn').addEventListener('click', () => $id('endBtn').click());

$id('vizFsLoopBtn').addEventListener('click', () => {
  $id('loopBtn').click();
  syncVizFsLoopBtn();
});

$id('vizFsMuteBtn').addEventListener('click', () => {
  state.muted = !state.muted;
  applyVolume();
  updateMuteBtn();
  updateVolumeTrack();
  syncVizFsMuteBtn();
  syncVizFsVolumeSlider();
});

$id('vizFsVolumeSlider').addEventListener('input', e => {
  state.volume = e.target.value / 100;
  if (state.muted && state.volume > 0) state.muted = false;
  applyVolume();
  updateMuteBtn();
  updateVolumeTrack();
  syncVizFsMuteBtn();
  syncVizFsVolumeSlider();
});
$id('vizFsVolumeSlider').addEventListener('pointerup', e => e.target.blur());

// Progress bar scrubbing in fullscreen
(function () {
  const track = $id('vizFsProgressTrack');
  let fsScrubbing = false;

  function getFsFraction(e) {
    const rect = track.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    return Math.max(0, Math.min(1, x / rect.width));
  }

  track.addEventListener('mousedown', e => {
    if (!state.audioBuffer) return;
    fsScrubbing = true;
    state.scrubFraction = getFsFraction(e);
    silenceForScrub();
    drawWaveform();
    updateTimeDisplay();
  });
  window.addEventListener('mousemove', e => {
    if (!fsScrubbing) return;
    state.scrubFraction = getFsFraction(e);
    drawWaveform();
    updateTimeDisplay();
  });
  window.addEventListener('mouseup', () => {
    if (!fsScrubbing) return;
    fsScrubbing = false;
    const fraction = state.scrubFraction;
    state.scrubFraction = null;
    seekTo(fraction);
    drawWaveform();
    updateTimeDisplay();
  });
  track.addEventListener('touchstart', e => {
    if (!state.audioBuffer) return;
    e.preventDefault();
    fsScrubbing = true;
    state.scrubFraction = getFsFraction(e);
    silenceForScrub();
    updateTimeDisplay();
  }, { passive: false });
  track.addEventListener('touchmove', e => {
    if (!fsScrubbing) return;
    e.preventDefault();
    state.scrubFraction = getFsFraction(e);
    updateTimeDisplay();
  }, { passive: false });
  track.addEventListener('touchend', e => {
    if (!fsScrubbing) return;
    e.preventDefault();
    fsScrubbing = false;
    const fraction = state.scrubFraction;
    state.scrubFraction = null;
    seekTo(fraction);
    updateTimeDisplay();
  }, { passive: false });
})();

// Keep fullscreen bar meta in sync when track changes (MutationObserver)
(function () {
  const obs = new MutationObserver(() => {
    if (document.body.classList.contains('viz-fullscreen')) syncVizFsMeta();
  });
  const titleEl = $id('trackTitle');
  const artistEl = $id('trackArtist');
  const artEl = $id('albumArt');
  if (titleEl) obs.observe(titleEl, { characterData: true, childList: true, subtree: true });
  if (artistEl) obs.observe(artistEl, { characterData: true, childList: true, subtree: true });
  if (artEl) obs.observe(artEl, { childList: true, subtree: true, attributes: true });
})();

// Keep fullscreen play button in sync (poll state.playing each anim frame via drawBottomVisualizer)
// We hook into the play/pause events by overriding the functions locally
(function () {
  // Patch: after play/pause clicks on main transport, sync fullscreen bar
  const mainPlayBtn = $id('playBtn');
  mainPlayBtn.addEventListener('click', () => {
    // Synced after the event propagates and state updates
    requestAnimationFrame(syncVizFsPlayBtn);
  }, true);
})();
