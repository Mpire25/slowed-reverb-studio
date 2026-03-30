import { SERVER } from './config.js';
import { state } from './state.js';
import { loadFile } from './loader.js';
import { setOnTrackEnded, getCtx } from './audio.js';
import { fmt, toast } from './utils.js';
import { $id } from './dom.js';

const AHEAD = 5;
const BEHIND = 2;
const MAX_RETRIES = 2;

// ── Playlist state ─────────────────────────────────────────────────────────────

const ps = {
  active: false,
  loopEnabled: false,
  sourceUrl: null,
  tracks: [],         // {index, name, artist, album, duration_ms, image_url, video_id?, filePath, status, retries}
  currentIndex: -1,
  activeES: null,     // currently open EventSource
  downloadingIndex: -1,
  pendingPlayIndex: -1,  // track index waiting on a download before playing
};
let panelHeightObserver = null;

// ── Public API ─────────────────────────────────────────────────────────────────

export function isPlaylistActive() { return ps.active; }
export function getCurrentIndex() { return ps.currentIndex; }

export function initPlaylist(data, sourceUrl, { firstTrackPath = null } = {}) {
  // Close any existing playlist first (without triggering resetStudio)
  _teardown();

  ps.active = true;
  ps.loopEnabled = false;
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
  const curRow = $id(`pl-row-0`);
  if (curRow) { curRow.classList.add('is-playing'); curRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  _updateRowStatus(0);
  setOnTrackEnded(_onTrackEnded);
  _downloadNext(); // downloads tracks 1-5 in background (track 0 already ready)
  _syncMobileBar();
}

export function closePlaylist() {
  window.__playlistCloseHook = null;
  _teardown();
  _closePanelUI();
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
    track.status = 'pending';
    track.retries = 0;
    toast(`Loading "${track.name}"…`, 3000, 'info');
    _setCurrentTrack(index);
    _prioritizeAndDownload(index);
  } else {
    // pending / downloading / error
    if (track.status === 'error') {
      track.status = 'pending';
      track.retries = 0;
    }
    if (track.status !== 'downloading') {
      toast(`Loading "${track.name}"…`, 3000, 'info');
    }
    _setCurrentTrack(index);
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
      t.cachedArrayBuffer = null;
      t.cachedDecodedBuffer = null;
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
      spotify: /spotify/i.test(ps.sourceUrl) ? ps.sourceUrl : null,
      youtube: track.video_id ? `https://www.youtube.com/watch?v=${track.video_id}` : null,
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
    } else {
      // Pre-fetch and pre-decode in the background so it's instant when needed
      _prefetchTrack(idx);
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
}

// ── Internal: panel UI ─────────────────────────────────────────────────────────

function _syncPanelHeightToApp() {
  const app = document.querySelector('.app');
  const panel = $id('playlistPanel');
  if (!app || !panel) return;

  const appStyles = window.getComputedStyle(app);
  const paddingTop = parseFloat(appStyles.paddingTop) || 0;
  const paddingBottom = parseFloat(appStyles.paddingBottom) || 0;
  const appHeight = app.getBoundingClientRect().height;
  const contentHeight = Math.max(0, Math.round(appHeight - paddingTop - paddingBottom));

  panel.style.height = contentHeight > 0 ? `${contentHeight}px` : '';
}

function _startPanelHeightSync() {
  _stopPanelHeightSync();
  _syncPanelHeightToApp();
  window.addEventListener('resize', _syncPanelHeightToApp);

  if (typeof ResizeObserver !== 'undefined') {
    const app = document.querySelector('.app');
    if (app) {
      panelHeightObserver = new ResizeObserver(_syncPanelHeightToApp);
      panelHeightObserver.observe(app);
    }
  }
}

function _stopPanelHeightSync() {
  window.removeEventListener('resize', _syncPanelHeightToApp);
  if (panelHeightObserver) {
    panelHeightObserver.disconnect();
    panelHeightObserver = null;
  }

  const panel = $id('playlistPanel');
  if (panel) panel.style.height = '';
}

function _openPanel(name, count) {
  const nameEl = $id('playlistSidebarName');
  const countEl = $id('playlistSidebarCount');
  const mobileNameEl = $id('playlistMobileOverlayName');
  const loopBtn = $id('playlistLoopBtn');
  const countStr = `${count} track${count !== 1 ? 's' : ''}`;
  if (nameEl) nameEl.textContent = name;
  if (countEl) countEl.textContent = countStr;
  if (mobileNameEl) mobileNameEl.textContent = name;
  if (loopBtn) loopBtn.onclick = _togglePlaylistLoop;
  document.body.classList.add('playlist-open');

  // Update transport button labels to reflect prev/next role
  const startBtn = $id('startBtn');
  const endBtn = $id('endBtn');
  if (startBtn) { startBtn.title = 'Previous Track'; startBtn.setAttribute('aria-label', 'Previous Track'); }
  if (endBtn)   { endBtn.title = 'Next Track';     endBtn.setAttribute('aria-label', 'Next Track'); }

  // Mobile bar/overlay wiring
  const mobileBtn = $id('playlistMobileBarBtn');
  const mobileClose = $id('playlistMobileOverlayClose');
  if (mobileBtn) mobileBtn.onclick = _openMobileOverlay;
  if (mobileClose) mobileClose.onclick = _closeMobileOverlay;

  _syncPlaylistLoopButton();
  _startPanelHeightSync();
}

function _closePanelUI() {
  _stopPanelHeightSync();
  document.body.classList.remove('playlist-open');
  const loopBtn = $id('playlistLoopBtn');
  if (loopBtn) loopBtn.onclick = null;
  const list = $id('playlistTrackList');
  if (list) list.innerHTML = '';
  const mobileList = $id('playlistMobileTrackList');
  if (mobileList) mobileList.innerHTML = '';
  _closeMobileOverlay();

  // Restore transport button labels
  const startBtn = $id('startBtn');
  const endBtn = $id('endBtn');
  if (startBtn) { startBtn.title = 'Start'; startBtn.setAttribute('aria-label', 'Start'); }
  if (endBtn)   { endBtn.title = 'End';   endBtn.setAttribute('aria-label', 'End'); }
  _syncPlaylistLoopButton();
}

function _togglePlaylistLoop() {
  if (!ps.active) return;
  ps.loopEnabled = !ps.loopEnabled;
  _syncPlaylistLoopButton();
}

function _syncPlaylistLoopButton() {
  const btn = $id('playlistLoopBtn');
  if (!btn) return;
  btn.classList.toggle('active', ps.loopEnabled);
  btn.setAttribute('aria-pressed', ps.loopEnabled ? 'true' : 'false');
  btn.title = ps.loopEnabled ? 'Loop Playlist On' : 'Loop Playlist Off';
}

function _openMobileOverlay() {
  const overlay = $id('playlistMobileOverlay');
  if (!overlay) return;
  overlay.classList.add('open');
  // Sync the mobile list from the main list
  const mainList = $id('playlistTrackList');
  const mobileList = $id('playlistMobileTrackList');
  if (mainList && mobileList) mobileList.innerHTML = mainList.innerHTML;
  // Re-attach click handlers to mobile rows
  mobileList.querySelectorAll('.pl-row').forEach(row => {
    row.addEventListener('click', () => {
      _closeMobileOverlay();
      jumpToTrack(parseInt(row.dataset.index, 10));
    });
  });
}

function _closeMobileOverlay() {
  const overlay = $id('playlistMobileOverlay');
  if (overlay) overlay.classList.remove('open');
}

function _syncMobileBar() {
  const barTrack = $id('playlistMobileBarTrack');
  const barCount = $id('playlistMobileBarCount');
  if (!barTrack || !barCount) return;
  const cur = ps.tracks[ps.currentIndex];
  if (cur) {
    barTrack.textContent = cur.name;
    barCount.textContent = `${ps.currentIndex + 1} / ${ps.tracks.length}`;
  }
}

function _makeTrackRow(track) {
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
  return row;
}

function _renderTrackList() {
  const list = $id('playlistTrackList');
  if (!list) return;
  list.innerHTML = '';
  for (const track of ps.tracks) {
    list.appendChild(_makeTrackRow(track));
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
