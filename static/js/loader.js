import { state } from './state.js';
import { readID3 } from './id3.js';
import { loadAudioBuffer, play, updatePlayBtn } from './audio.js';
import { buildWaveformData, drawWaveform } from './waveform.js';
import {
  clearBottomVisualizerFade,
  updateBottomVisualizerPlaybackState,
  drawBottomVisualizer,
} from './visualizer.js';
import { applyThemeFromCurrentTrack } from './theme.js';
import { toast, fmt } from './utils.js';

export function updateTrackUI() {
  document.getElementById('trackTitle').textContent = state.title;
  document.getElementById('trackArtist').textContent = state.artist;
  document.getElementById('trackDuration').textContent = fmt(state.duration);
  const spotifyLinkEl = document.getElementById('trackSpotifyLink');
  const youTubeLinkEl = document.getElementById('trackYouTubeLink');
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

  const artEl = document.getElementById('albumArt');
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
    document.getElementById(id).classList.toggle('hidden', !show);
  });
  document.getElementById('newSongBtn').classList.toggle('hidden', !show);
  if (show) {
    drawWaveform();
    drawBottomVisualizer(!state.playing);
  } else {
    updateBottomVisualizerPlaybackState();
  }
}

export function showLoading(on) {
  document.getElementById('downloadBtn').disabled = on;
}

export function updateSourceImportUI() {
  const hasTrack = !!state.audioBuffer;
  document.getElementById('dropZone').style.display = hasTrack ? 'none' : 'block';
  document.getElementById('urlRow').style.display = (!hasTrack && state.serverOnline) ? 'block' : 'none';
}

export async function loadFile(arrayBuffer, filename, { autoPlay = true, sourceLinks = null } = {}) {
  showLoading(true);
  try {
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

    const buf = await loadAudioBuffer(arrayBuffer);
    state.audioBuffer = buf;
    state.duration = buf.duration;
    state.pausedAt = 0;
    state.playing = false;
    clearBottomVisualizerFade();
    if (state.source) { try { state.source.stop(); } catch(e) {} state.source = null; }

    state.waveformData = buildWaveformData(buf);
    state.sourceSpotifyUrl = sourceLinks?.spotify || null;
    state.sourceYouTubeUrl = sourceLinks?.youtube || null;

    updateTrackUI();
    void applyThemeFromCurrentTrack();
    showPlayerUI(true);
    updateSourceImportUI();
    toast('Track loaded');
    if (autoPlay) play();
  } catch (err) {
    toast('Failed to decode audio: ' + err.message);
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
  if (state.source) {
    try { state.source.stop(); } catch(e) {}
    try { state.source.disconnect(); } catch(e) {}
    state.source = null;
  }
  if (state.convolver) { try { state.convolver.disconnect(); } catch(e) {} state.convolver = null; }
  if (state.dryGain) { try { state.dryGain.disconnect(); } catch(e) {} state.dryGain = null; }
  if (state.wetGain) { try { state.wetGain.disconnect(); } catch(e) {} state.wetGain = null; }
  if (state.analyser) { try { state.analyser.disconnect(); } catch(e) {} state.analyser = null; }
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

  const urlInput = document.getElementById('urlInput');
  if (urlInput) urlInput.value = '';
  const statusEl = document.getElementById('importStatus');
  if (statusEl) statusEl.style.display = 'none';

  showPlayerUI(false);
  updatePlayBtn();
  updateSourceImportUI();
  updateBottomVisualizerPlaybackState();
  void applyThemeFromCurrentTrack();
}
