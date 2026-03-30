import { state, settings } from './state.js';
import { readID3 } from './id3.js';
import { loadAudioBuffer, play, updatePlayBtn, stopActiveSource, resetAudioNodes } from './audio.js';
import { syncSpeedControls, syncReverbControls, syncDecayControls } from './controls.js';
import { buildWaveformData, drawWaveform } from './waveform.js';
import {
  clearBottomVisualizerFade,
  updateBottomVisualizerPlaybackState,
  drawBottomVisualizer,
} from './visualizer.js';
import { applyThemeFromCurrentTrack } from './theme.js';
import { toast, fmt } from './utils.js';
import { $id, toggleClass, setDisplay, setText } from './dom.js';
import { updateMediaSessionMetadata } from './mediasession.js';

function hasSameArtBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function updateTrackUI() {
  setText($id('trackTitle'), state.title);
  setText($id('trackArtist'), state.artist);
  setText($id('trackDuration'), fmt(state.duration));
  const spotifyLinkEl = $id('trackSpotifyLink');
  const youTubeLinkEl = $id('trackYouTubeLink');
  if (state.sourceSpotifyUrl) {
    spotifyLinkEl.href = state.sourceSpotifyUrl;
    spotifyLinkEl.classList.remove('hidden');
  } else {
    spotifyLinkEl.classList.add('hidden');
  }
  if (state.sourceYouTubeUrl) {
    youTubeLinkEl.href = state.sourceYouTubeUrl;
    youTubeLinkEl.classList.remove('hidden');
  } else {
    youTubeLinkEl.classList.add('hidden');
  }

  const artEl = $id('albumArt');
  const nextArtKey = state.artBlob || '__placeholder__';
  if (artEl.dataset.artKey === nextArtKey) return;
  artEl.dataset.artKey = nextArtKey;

  artEl.innerHTML = '';
  const placeholderEl = document.createElement('span');
  placeholderEl.className = 'album-art-placeholder';
  placeholderEl.setAttribute('aria-hidden', 'true');
  placeholderEl.textContent = '🎵';
  artEl.appendChild(placeholderEl);

  if (state.artBlob) {
    const img = new Image();
    img.className = 'album-art-img';
    img.alt = 'Album art';
    img.decoding = 'async';
    img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
    img.src = state.artBlob;
    artEl.appendChild(img);
    if (img.complete) {
      requestAnimationFrame(() => img.classList.add('loaded'));
    }
  }
}

export function showPlayerUI(show) {
  const els = ['trackCard', 'waveformWrap', 'transport', 'effects', 'downloadBtn'];
  els.forEach(id => {
    toggleClass($id(id), 'hidden', !show);
  });
  toggleClass($id('newSongBtn'), 'hidden', !show);
  if (show) {
    drawWaveform();
    drawBottomVisualizer(!state.playing);
  } else {
    updateBottomVisualizerPlaybackState();
  }
}

export function showLoading(on) {
  $id('downloadBtn').disabled = on;
}

export function updateSourceImportUI() {
  const hasTrack = !!state.audioBuffer;
  setDisplay($id('dropZone'), hasTrack ? 'none' : 'block');
  setDisplay($id('urlRow'), (!hasTrack && state.serverOnline) ? 'block' : 'none');
}

export async function loadFile(arrayBuffer, filename, { autoPlay = true, sourceLinks = null, suppressToast = false, keepEffects = false, preDecodedBuffer = null } = {}) {
  showLoading(true);

  if (!keepEffects) {
    // Reset effects to settings defaults so each song starts fresh
    state.speed = settings.defaultSpeed;
    state.reverbMix = settings.defaultReverb / 100;
    state.reverbDecay = settings.defaultDecay;
    syncSpeedControls(state.speed);
    syncReverbControls(state.reverbMix);
    syncDecayControls(state.reverbDecay);
  }

  try {
    const tags = readID3(arrayBuffer);
    state.title = tags['TIT2'] || filename.replace(/\.mp3$/i, '') || 'Unknown Title';
    state.artist = tags['TPE1'] || 'Unknown Artist';

    if (tags['APIC']) {
      const { bytes, mime } = tags['APIC'];
      const nextArtBytes = new Uint8Array(bytes);
      const isSameArtwork =
        !!state.artBlob &&
        state.artMime === mime &&
        hasSameArtBytes(state.artBytes, nextArtBytes);

      state.artBytes = nextArtBytes;
      state.artMime = mime;
      if (!isSameArtwork) {
        if (state.artBlob) URL.revokeObjectURL(state.artBlob);
        state.artBlob = URL.createObjectURL(new Blob([bytes], { type: mime }));
      }
    } else {
      if (state.artBlob) URL.revokeObjectURL(state.artBlob);
      state.artBlob = null;
      state.artBytes = null;
      state.artMime = 'image/jpeg';
    }

    void applyThemeFromCurrentTrack();

    const buf = preDecodedBuffer || await loadAudioBuffer(arrayBuffer);
    state.audioBuffer = buf;
    state.duration = buf.duration;
    state.pausedAt = 0;
    state.playing = false;
    clearBottomVisualizerFade();
    stopActiveSource();

    state.waveformData = buildWaveformData(buf);
    state.sourceSpotifyUrl = sourceLinks?.spotify || null;
    state.sourceYouTubeUrl = sourceLinks?.youtube || null;

    updateTrackUI();
    updateMediaSessionMetadata();
    showPlayerUI(true);
    updateSourceImportUI();
    if (!suppressToast) toast('Track loaded', 3000, 'success');
    if (autoPlay) play();
  } catch (err) {
    toast('Failed to decode audio: ' + err.message, 5000, 'error');
    console.error(err);
  } finally {
    showLoading(false);
  }
}

export function handleFileObject(file) {
  const reader = new FileReader();
  reader.onload = ev => loadFile(ev.target.result, file.name);
  reader.readAsArrayBuffer(file);
}

export function resetStudio() {
  if (window.__playlistCloseHook) window.__playlistCloseHook();
  stopActiveSource();
  resetAudioNodes();
  if (state.artBlob) { URL.revokeObjectURL(state.artBlob); state.artBlob = null; }

  state.audioBuffer = null;
  state.waveformData = null;
  state.visualizerFreqData = null;
  state.visualizerBarData = null;
  state.visualizerTimeData = null;
  state.visualizerLoudness = 0;
  clearBottomVisualizerFade();
  state.duration = 0;
  state.pausedAt = 0;
  state.playing = false;
  state.title = 'Unknown Title';
  state.artist = 'Unknown Artist';
  state.sourceSpotifyUrl = null;
  state.sourceYouTubeUrl = null;
  state.artBytes = null;
  state.artMime = 'image/jpeg';

  const urlInput = $id('urlInput');
  if (urlInput) urlInput.value = '';
  const statusEl = $id('importStatus');
  if (statusEl) statusEl.style.display = 'none';

  showPlayerUI(false);
  updatePlayBtn();
  updateSourceImportUI();
  updateBottomVisualizerPlaybackState();
  void applyThemeFromCurrentTrack();

  if (urlInput) urlInput.focus();
}
