import { state } from './state.js';

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

export function updateMediaSessionPlaybackState(playing) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
}

export function initMediaSession({ play, pause, nexttrack, previoustrack }) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.setActionHandler('play', play);
  navigator.mediaSession.setActionHandler('pause', pause);
  navigator.mediaSession.setActionHandler('nexttrack', nexttrack ?? null);
  navigator.mediaSession.setActionHandler('previoustrack', previoustrack ?? null);
}
