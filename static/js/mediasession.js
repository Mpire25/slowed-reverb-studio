import { state } from './state.js';

// Silent <audio> element to hold media session focus while a track is loaded.
// Without this, browsers hand media key ownership to other tabs (e.g. YouTube) when paused.
// Generates a 1-second silent WAV at 8kHz mono — negligible overhead.
const _silent = (() => {
  const sr = 8000, dataSize = 8000;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const str = (off, s) => [...s].forEach((c, i) => v.setUint8(off + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr, true);
  v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  str(36, 'data'); v.setUint32(40, dataSize, true);
  for (let i = 0; i < dataSize; i++) v.setUint8(44 + i, 128); // 8-bit silence = 128
  const el = document.createElement('audio');
  el.loop = true;
  el.src = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  return el;
})();

export function updateMediaSessionMetadata() {
  if (!('mediaSession' in navigator)) return;
  const artwork = state.artBlob
    ? [{ src: state.artBlob, sizes: '512x512', type: state.artMime || 'image/jpeg' }]
    : [];
  navigator.mediaSession.metadata = new MediaMetadata({
    title: state.title || '',
    artist: state.artist || '',
    artwork,
  });
}

export function releaseMediaFocus() {
  _silent.pause();
  _silent.currentTime = 0;
}

export function updateMediaSessionPlaybackState(playing) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  // Sync silent audio so the browser fires 'play' (not 'pause') when we're paused.
  // The <audio> element staying loaded (even paused) is enough to hold media session focus.
  if (playing) {
    _silent.play().catch(() => {});
  } else {
    _silent.pause();
  }
}

export function initMediaSession({ play, pause, nexttrack, previoustrack }) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.setActionHandler('play', play);
  navigator.mediaSession.setActionHandler('pause', pause);
  navigator.mediaSession.setActionHandler('nexttrack', nexttrack ?? null);
  navigator.mediaSession.setActionHandler('previoustrack', previoustrack ?? null);
}
