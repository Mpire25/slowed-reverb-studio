import { SERVER } from './config.js';
import {
  state,
  settings,
  MIN_PLAYLIST_PRELOAD,
  MAX_PLAYLIST_PRELOAD,
  DEFAULT_PLAYLIST_PRELOAD,
} from './state.js';
import { loadFile } from './loader.js';
import { setOnTrackEnded, getCtx } from './audio.js';
import { toast } from './utils.js';
import { createPlaylistView } from './playlist_view.js';

const BEHIND = 2;
const MAX_RETRIES = 2;

// ── Playlist state ─────────────────────────────────────────────────────────────

const ps = {
  active: false,
  loopEnabled: false,
  sourceUrl: null,
  containerYouTubeUrl: null,
  tracks: [],         // {index, name, artist, album, duration_ms, image_url, video_id?, spotify_url?, youtube_url?, filePath, status, retries}
  currentIndex: -1,
  activeES: null,     // currently open EventSource
  downloadingIndex: -1,
  pendingPlayIndex: -1,  // track index waiting on a download before playing
};
const view = createPlaylistView({
  onJumpToTrack: index => jumpToTrack(index),
  onToggleLoop: () => _togglePlaylistLoop(),
});

// ── Public API ─────────────────────────────────────────────────────────────────

export function isPlaylistActive() { return ps.active; }
export function getCurrentIndex() { return ps.currentIndex; }

export function initPlaylist(data, sourceUrl, { firstTrackPath = null } = {}) {
  // Close any existing playlist first (without triggering resetStudio)
  _teardown();

  ps.active = true;
  ps.loopEnabled = true;
  ps.sourceUrl = sourceUrl;
  ps.containerYouTubeUrl = data.youtube_url || null;
  ps.tracks = (data.tracks || []).map((t, i) => ({
    index: i,
    name: t.name || 'Unknown',
    artist: t.artist || '',
    album: t.album || '',
    duration_ms: t.duration_ms || 0,
    image_url: t.image_url || null,
    video_id: t.video_id || null,
    spotify_url: t.spotify_url || null,
    youtube_url: t.youtube_url || null,
    filePath: null,
    status: 'pending',
    retries: 0,
    cachedArrayBuffer: null,
    cachedDecodedBuffer: null,
  }));

  // If the first track was already downloaded by importer, mark it ready
  if (firstTrackPath && ps.tracks.length > 0) {
    ps.tracks[0].filePath = firstTrackPath;
    ps.tracks[0].status = 'ready';
  }

  // Register the close hook for resetStudio
  window.__playlistCloseHook = closePlaylist;

  _openPanel(data.name || 'Playlist', ps.tracks.length);
  _renderTrackList();

  // Start from track 0 but skip downloading it if already ready
  ps.currentIndex = 0;
  view.setCurrentRow(-1, 0);
  _updateRowStatus(0);
  setOnTrackEnded(_onTrackEnded);
  _downloadNext(); // downloads upcoming tracks in background (track 0 already ready)
  _syncMobileBar();
}

export function closePlaylist() {
  window.__playlistCloseHook = null;
  _teardown();
  _closePanelUI();
}

export function refreshPreloadWindow() {
  if (!ps.active || ps.currentIndex < 0) return;
  _evictOutsideWindow(ps.currentIndex);
  _downloadNext();
}

export function jumpToTrack(index) {
  if (!ps.active) return;
  if (ps.tracks.length === 0) return;

  let targetIndex = index;
  if (ps.loopEnabled) {
    const total = ps.tracks.length;
    targetIndex = ((index % total) + total) % total;
  } else if (index < 0 || index >= ps.tracks.length) {
    return;
  }

  const track = ps.tracks[targetIndex];
  if (!track) return;

  if (track.status === 'ready') {
    _setCurrentTrack(targetIndex);
    _loadAndPlayTrack(targetIndex);
  } else if (track.status === 'evicted') {
    track.status = 'pending';
    track.retries = 0;
    toast(`Loading "${track.name}"…`, 3000, 'info');
    _setCurrentTrack(targetIndex);
    _prioritizeAndDownload(targetIndex);
  } else {
    // pending / downloading / error
    if (track.status === 'error') {
      track.status = 'pending';
      track.retries = 0;
    }
    if (track.status !== 'downloading') {
      toast(`Loading "${track.name}"…`, 3000, 'info');
    }
    _setCurrentTrack(targetIndex);
    _prioritizeAndDownload(targetIndex);
  }
}

// ── Internal: track management ─────────────────────────────────────────────────

function _setCurrentTrack(index) {
  const prev = ps.currentIndex;
  ps.currentIndex = index;

  _evictOutsideWindow(index);

  view.setCurrentRow(prev, index);

  setOnTrackEnded(_onTrackEnded);
  _downloadNext();
  _syncMobileBar();
}

function _onTrackEnded() {
  if (!ps.active) return;
  const next = ps.currentIndex + 1;
  if (next >= ps.tracks.length) {
    if (ps.loopEnabled && ps.tracks.length > 0) {
      jumpToTrack(0);
      return;
    }
    // Playlist ended (loop playlist disabled)
    setOnTrackEnded(null);
    return;
  }
  jumpToTrack(next);
}

async function _loadAndPlayTrack(index) {
  const track = ps.tracks[index];
  if (!track || !track.filePath) return;

  ps.pendingPlayIndex = -1;

  try {
    let ab = track.cachedArrayBuffer;
    const preDecoded = track.cachedDecodedBuffer;

    if (!ab) {
      const res = await fetch(`${SERVER}/api/file?path=${encodeURIComponent(track.filePath)}`);
      if (!res.ok) throw new Error('Could not fetch track file');
      ab = await res.arrayBuffer();
    }

    // Consume the cache — no longer needed after handoff to loadFile
    track.cachedArrayBuffer = null;
    track.cachedDecodedBuffer = null;

    const sourceLinks = {
      spotify: track.spotify_url || (/spotify/i.test(ps.sourceUrl) ? ps.sourceUrl : null),
      youtube: track.youtube_url || (track.video_id ? `https://www.youtube.com/watch?v=${track.video_id}` : null),
    };

    await loadFile(ab, track.name + '.mp3', {
      autoPlay: true,
      sourceLinks,
      suppressToast: true,
      keepEffects: true,
      preDecodedBuffer: preDecoded || null,
    });
  } catch (err) {
    console.error('Failed to load playlist track:', err);
    toast(`Error loading "${track.name}": ${err.message}`, 5000, 'error');
  }
}

// ── Internal: pre-fetch / pre-decode ──────────────────────────────────────────

async function _prefetchTrack(idx) {
  const track = ps.tracks[idx];
  if (!track || !track.filePath || track.cachedArrayBuffer || track.cachedDecodedBuffer) return;
  try {
    const res = await fetch(`${SERVER}/api/file?path=${encodeURIComponent(track.filePath)}`);
    if (!res.ok) return;
    const ab = await res.arrayBuffer();
    if (!ps.active || !ps.tracks[idx] || ps.tracks[idx].status !== 'ready') return; // evicted while fetching
    track.cachedArrayBuffer = ab;
    try {
      const decoded = await getCtx().decodeAudioData(ab.slice(0));
      if (ps.active && ps.tracks[idx] && ps.tracks[idx].status === 'ready') {
        track.cachedDecodedBuffer = decoded;
      }
    } catch (e) {
      // Pre-decode failed — will decode on demand
    }
  } catch (e) {
    // Pre-fetch failed — will fetch on demand
  }
}

// ── Internal: download queue ───────────────────────────────────────────────────

function _prioritizeAndDownload(targetIndex) {
  // If currently downloading something else, cancel it and reset to pending
  if (ps.activeES && ps.downloadingIndex !== targetIndex) {
    const interrupted = ps.tracks[ps.downloadingIndex];
    if (interrupted && interrupted.status === 'downloading') {
      interrupted.status = 'pending';
      _updateRowStatus(ps.downloadingIndex);
    }
    ps.activeES.close();
    ps.activeES = null;
    ps.downloadingIndex = -1;
  }
  _downloadNext();
}

function _downloadNext() {
  if (!ps.active) return;
  if (ps.activeES) return; // already downloading

  const total = ps.tracks.length;
  if (total === 0) return;

  const cur = ps.currentIndex;
  const seen = new Set();
  const candidates = [];

  const addCandidate = idx => {
    if (idx < 0 || idx >= total || seen.has(idx)) return;
    seen.add(idx);

    const track = ps.tracks[idx];
    if (!track) return;
    if (track.status === 'evicted') {
      track.status = 'pending';
      track.retries = 0;
      _updateRowStatus(idx);
    }
    if (track.status === 'pending') {
      candidates.push(idx);
    }
  };

  // Build priority order: current first, then ahead, then behind.
  addCandidate(cur);

  const aheadCount = _getAheadCount();

  if (ps.loopEnabled) {
    for (let step = 1; step <= aheadCount; step++) {
      addCandidate((cur + step + total) % total);
    }
    for (let step = 1; step <= BEHIND; step++) {
      addCandidate((cur - step + total) % total);
    }
  } else {
    for (let i = cur + 1; i <= Math.min(total - 1, cur + aheadCount); i++) {
      addCandidate(i);
    }
    for (let i = Math.max(0, cur - BEHIND); i < cur; i++) {
      addCandidate(i);
    }
  }

  if (candidates.length === 0) return;

  const idx = candidates[0];
  _startTrackDownload(idx);
}

function _startTrackDownload(idx) {
  const track = ps.tracks[idx];
  if (!track) return;

  track.status = 'downloading';
  ps.downloadingIndex = idx;
  _updateRowStatus(idx);

  const trackData = {
    index: track.index,
    name: track.name,
    artist: track.artist,
    album: track.album,
    duration_ms: track.duration_ms,
    image_url: track.image_url,
    video_id: track.video_id || null,
    spotify_url: track.spotify_url || null,
    youtube_url: track.youtube_url || null,
  };

  const es = new EventSource(
    `${SERVER}/api/download/track?track_data=${encodeURIComponent(JSON.stringify(trackData))}`
  );
  ps.activeES = es;

  es.addEventListener('complete', async e => {
    es.close();
    ps.activeES = null;
    ps.downloadingIndex = -1;

    const d = JSON.parse(e.data);
    track.filePath = d.file;
    track.status = 'ready';
    _updateRowStatus(idx);

    // If this was the track we were waiting on, play it now
    if (ps.pendingPlayIndex === idx || (idx === ps.currentIndex && !_isAnyTrackPlaying())) {
      ps.pendingPlayIndex = -1;
      _loadAndPlayTrack(idx);
    } else {
      // Pre-fetch and pre-decode in the background so it's instant when needed
      _prefetchTrack(idx);
    }

    _downloadNext();
  });

  es.addEventListener('found', e => {
    let d = null;
    try { d = JSON.parse(e.data); } catch {}
    if (!d) return;
    if (d.youtube_url) {
      track.youtube_url = d.youtube_url;
      if (!track.video_id) {
        const m = /[?&]v=([^&]+)/.exec(d.youtube_url);
        if (m && m[1]) track.video_id = m[1];
      }
    }
  });

  es.addEventListener('error', e => {
    es.close();
    ps.activeES = null;
    ps.downloadingIndex = -1;

    let msg = '';
    try { msg = JSON.parse(e.data).message; } catch {}

    if (track.retries < MAX_RETRIES) {
      track.retries++;
      track.status = 'pending';
    } else {
      track.status = 'error';
      console.warn(`Playlist track ${idx} failed: ${msg}`);
    }
    _updateRowStatus(idx);
    _downloadNext();
  });

  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) return;
    es.close();
    ps.activeES = null;
    ps.downloadingIndex = -1;

    if (track.retries < MAX_RETRIES) {
      track.retries++;
      track.status = 'pending';
    } else {
      track.status = 'error';
    }
    _updateRowStatus(idx);
    _downloadNext();
  };

  // If this is the current track and we're waiting to play it, mark pending
  if (idx === ps.currentIndex) {
    ps.pendingPlayIndex = idx;
  }
}

function _isAnyTrackPlaying() {
  return state.playing;
}

// ── Internal: teardown ─────────────────────────────────────────────────────────

function _teardown() {
  setOnTrackEnded(null);
  if (ps.activeES) {
    ps.activeES.close();
    ps.activeES = null;
  }
  // Clean up any remaining downloaded files and caches
  for (const t of ps.tracks) {
    if (t.filePath && t.status === 'ready') {
      fetch(`${SERVER}/api/file?path=${encodeURIComponent(t.filePath)}&consume=1`).catch(() => {});
    }
    t.cachedArrayBuffer = null;
    t.cachedDecodedBuffer = null;
  }
  ps.active = false;
  ps.loopEnabled = false;
  ps.tracks = [];
  ps.currentIndex = -1;
  ps.downloadingIndex = -1;
  ps.pendingPlayIndex = -1;
  ps.sourceUrl = null;
  ps.containerYouTubeUrl = null;
}

// ── Internal: panel UI ─────────────────────────────────────────────────────────

function _openPanel(name, count) {
  const source = ps.sourceUrl || '';
  const isSpotifySource = /spotify/i.test(source);
  const isYouTubeSource = /music\.youtube\.com/i.test(source);
  const sourceLinks = {
    spotify: isSpotifySource ? source : null,
    youtube: isYouTubeSource ? source : ps.containerYouTubeUrl,
  };
  view.openPanel(name, count, ps.loopEnabled, sourceLinks);
}

function _closePanelUI() {
  view.closePanel();
}

function _togglePlaylistLoop() {
  if (!ps.active) return;
  ps.loopEnabled = !ps.loopEnabled;
  view.setLoopEnabled(ps.loopEnabled);
  _downloadNext();
}

function _getAheadCount() {
  const rounded = Math.round(Number(settings.playlistPreload));
  if (!Number.isFinite(rounded)) return DEFAULT_PLAYLIST_PRELOAD;
  return Math.min(MAX_PLAYLIST_PRELOAD, Math.max(MIN_PLAYLIST_PRELOAD, rounded));
}

function _evictOutsideWindow(currentIndex) {
  for (let i = 0; i < ps.tracks.length; i++) {
    const t = ps.tracks[i];
    const inWindow = _isInRetentionWindow(i, currentIndex);
    if (!inWindow && t.status === 'ready' && t.filePath) {
      // Fire-and-forget file cleanup
      fetch(`${SERVER}/api/file?path=${encodeURIComponent(t.filePath)}&consume=1`).catch(() => {});
      t.filePath = null;
      t.status = 'evicted';
      t.cachedArrayBuffer = null;
      t.cachedDecodedBuffer = null;
      _updateRowStatus(i);
    }
  }
}

function _isInRetentionWindow(trackIndex, currentIndex) {
  const total = ps.tracks.length;
  if (total === 0) return false;
  const aheadCount = _getAheadCount();

  if (!ps.loopEnabled) {
    return trackIndex >= currentIndex - BEHIND && trackIndex <= currentIndex + aheadCount;
  }

  const aheadDistance = (trackIndex - currentIndex + total) % total;
  const behindDistance = (currentIndex - trackIndex + total) % total;
  return aheadDistance <= aheadCount || behindDistance <= BEHIND;
}

function _syncMobileBar() {
  view.syncMobileBar(ps.tracks, ps.currentIndex);
}

function _renderTrackList() {
  view.renderTrackList(ps.tracks);
}

function _updateRowStatus(index) {
  const track = ps.tracks[index];
  if (!track) return;
  view.updateRowStatus(index, track, ps.currentIndex);
}
