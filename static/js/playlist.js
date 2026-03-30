import { SERVER } from './config.js';
import { state } from './state.js';
import { loadFile } from './loader.js';
import { setOnTrackEnded } from './audio.js';
import { fmt } from './utils.js';
import { $id } from './dom.js';

const AHEAD = 5;
const BEHIND = 2;
const MAX_RETRIES = 2;

// ── Playlist state ─────────────────────────────────────────────────────────────

const ps = {
  active: false,
  sourceUrl: null,
  tracks: [],         // {index, name, artist, album, duration_ms, image_url, video_id?, filePath, status, retries}
  currentIndex: -1,
  activeES: null,     // currently open EventSource
  downloadingIndex: -1,
  pendingPlayIndex: -1,  // track index waiting on a download before playing
};

// ── Public API ─────────────────────────────────────────────────────────────────

export function isPlaylistActive() { return ps.active; }
export function getCurrentIndex() { return ps.currentIndex; }

export function initPlaylist(data, sourceUrl) {
  // Close any existing playlist first (without triggering resetStudio)
  _teardown();

  ps.active = true;
  ps.sourceUrl = sourceUrl;
  ps.tracks = (data.tracks || []).map((t, i) => ({
    index: i,
    name: t.name || 'Unknown',
    artist: t.artist || '',
    album: t.album || '',
    duration_ms: t.duration_ms || 0,
    image_url: t.image_url || null,
    video_id: t.video_id || null,
    filePath: null,
    status: 'pending',
    retries: 0,
  }));

  // Register the close hook for resetStudio
  window.__playlistCloseHook = closePlaylist;

  _openSidebar(data.name || 'Playlist', ps.tracks.length);
  _renderTrackList();
  _setCurrentTrack(0);
}

export function closePlaylist() {
  window.__playlistCloseHook = null;
  _teardown();
  _closeSidebar();
}

export function jumpToTrack(index) {
  if (!ps.active) return;
  if (index < 0 || index >= ps.tracks.length) return;
  const track = ps.tracks[index];
  if (!track) return;

  if (track.status === 'ready') {
    _setCurrentTrack(index);
    _loadAndPlayTrack(index);
  } else if (track.status === 'evicted') {
    // Re-queue it
    track.status = 'pending';
    track.retries = 0;
    _setCurrentTrack(index);
    _prioritizeAndDownload(index);
  } else {
    // pending / downloading / error
    _setCurrentTrack(index);
    if (track.status === 'error') {
      track.status = 'pending';
      track.retries = 0;
    }
    _prioritizeAndDownload(index);
  }
}

// ── Internal: track management ─────────────────────────────────────────────────

function _setCurrentTrack(index) {
  const prev = ps.currentIndex;
  ps.currentIndex = index;

  // Evict tracks that fall outside the window
  for (let i = 0; i < ps.tracks.length; i++) {
    const t = ps.tracks[i];
    const inWindow = i >= index - BEHIND && i <= index + AHEAD;
    if (!inWindow && (t.status === 'ready') && t.filePath) {
      // Fire-and-forget file cleanup
      fetch(`${SERVER}/api/file?path=${encodeURIComponent(t.filePath)}&consume=1`).catch(() => {});
      t.filePath = null;
      t.status = 'evicted';
      _updateRowStatus(i);
    }
  }

  // Update sidebar highlighting
  if (prev >= 0) {
    const prevRow = $id(`pl-row-${prev}`);
    if (prevRow) prevRow.classList.remove('is-playing');
  }
  const curRow = $id(`pl-row-${index}`);
  if (curRow) {
    curRow.classList.add('is-playing');
    curRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  setOnTrackEnded(_onTrackEnded);
  _downloadNext();
}

function _onTrackEnded() {
  if (!ps.active) return;
  const next = ps.currentIndex + 1;
  if (next >= ps.tracks.length) {
    // Playlist ended
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
    const res = await fetch(`${SERVER}/api/file?path=${encodeURIComponent(track.filePath)}`);
    if (!res.ok) throw new Error('Could not fetch track file');
    const ab = await res.arrayBuffer();

    const sourceLinks = {
      spotify: /spotify/i.test(ps.sourceUrl) ? ps.sourceUrl : null,
      youtube: track.video_id ? `https://www.youtube.com/watch?v=${track.video_id}` : null,
    };

    await loadFile(ab, track.name + '.mp3', {
      autoPlay: true,
      sourceLinks,
      suppressToast: true,
    });
  } catch (err) {
    console.error('Failed to load playlist track:', err);
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

  const cur = ps.currentIndex;
  // Build priority order: current first, then ahead, then behind
  const candidates = [];
  for (let i = cur; i <= Math.min(ps.tracks.length - 1, cur + AHEAD); i++) {
    if (ps.tracks[i].status === 'pending') candidates.push(i);
  }
  for (let i = Math.max(0, cur - BEHIND); i < cur; i++) {
    if (ps.tracks[i].status === 'pending') candidates.push(i);
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
    }

    _downloadNext();
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
  // Clean up any remaining downloaded files
  for (const t of ps.tracks) {
    if (t.filePath && t.status === 'ready') {
      fetch(`${SERVER}/api/file?path=${encodeURIComponent(t.filePath)}&consume=1`).catch(() => {});
    }
  }
  ps.active = false;
  ps.tracks = [];
  ps.currentIndex = -1;
  ps.downloadingIndex = -1;
  ps.pendingPlayIndex = -1;
  ps.sourceUrl = null;
}

// ── Internal: sidebar UI ───────────────────────────────────────────────────────

function _openSidebar(name, count) {
  const sidebar = $id('playlistSidebar');
  const nameEl = $id('playlistSidebarName');
  const countEl = $id('playlistSidebarCount');
  if (nameEl) nameEl.textContent = name;
  if (countEl) countEl.textContent = `${count} track${count !== 1 ? 's' : ''}`;
  if (sidebar) sidebar.classList.add('open');
  document.body.classList.add('playlist-open');

  const closeBtn = $id('playlistSidebarClose');
  if (closeBtn) {
    closeBtn.onclick = () => {
      closePlaylist();
      // Also call resetStudio to clear the player? No — user might want to keep current track.
      // Just close the sidebar and deactivate playlist mode.
    };
  }
}

function _closeSidebar() {
  const sidebar = $id('playlistSidebar');
  if (sidebar) sidebar.classList.remove('open');
  document.body.classList.remove('playlist-open');
  const list = $id('playlistTrackList');
  if (list) list.innerHTML = '';
}

function _renderTrackList() {
  const list = $id('playlistTrackList');
  if (!list) return;
  list.innerHTML = '';

  for (const track of ps.tracks) {
    const row = document.createElement('div');
    row.className = 'pl-row';
    row.id = `pl-row-${track.index}`;
    row.dataset.index = track.index;

    const dur = track.duration_ms > 0 ? fmt(track.duration_ms / 1000) : '–';

    row.innerHTML = `
      <span class="pl-row-num">${track.index + 1}</span>
      <div class="pl-row-art">
        ${track.image_url ? `<img src="${_esc(track.image_url)}" loading="lazy" alt="">` : '<span class="pl-row-art-placeholder">♪</span>'}
      </div>
      <div class="pl-row-info">
        <div class="pl-row-title">${_esc(track.name)}</div>
        <div class="pl-row-artist">${_esc(track.artist)}</div>
      </div>
      <span class="pl-row-dur">${dur}</span>
      <span class="pl-row-status" id="pl-status-${track.index}"></span>
    `;

    row.addEventListener('click', () => jumpToTrack(track.index));
    list.appendChild(row);
  }
}

function _updateRowStatus(index) {
  const statusEl = $id(`pl-status-${index}`);
  if (!statusEl) return;
  const track = ps.tracks[index];
  if (!track) return;

  switch (track.status) {
    case 'downloading':
      statusEl.innerHTML = '<span class="pl-spinner"></span>';
      break;
    case 'ready':
      statusEl.innerHTML = '<span class="pl-status-ready">✓</span>';
      break;
    case 'error':
      statusEl.innerHTML = '<span class="pl-status-error">✕</span>';
      break;
    case 'evicted':
      statusEl.innerHTML = '<span class="pl-status-evicted">↺</span>';
      break;
    default:
      statusEl.innerHTML = '';
  }

  // Update playing indicator
  const row = $id(`pl-row-${index}`);
  if (row) {
    if (index === ps.currentIndex) {
      row.classList.add('is-playing');
    } else {
      row.classList.remove('is-playing');
    }
  }
}

function _esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
