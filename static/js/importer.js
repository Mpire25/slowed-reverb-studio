import { state } from './state.js';
import { loadFile, updateSourceImportUI } from './loader.js';
import { SERVER } from './config.js';
import { toast } from './utils.js';
import { $id, $ids, setDisplay, setText, toggleClass, SPINNER_HTML, spinnerWithText } from './dom.js';

export function initImporter() {
  const btn = $id('urlLoadBtn');
  const urlInput = $id('urlInput');

  async function checkServer() {
    const statusEl = $id('serverStatus');
    const labelEl = $id('statusLabel');
    setDisplay(statusEl, 'flex');
    try {
      const r = await fetch(`${SERVER}/ping`, { signal: AbortSignal.timeout(800) });
      if (r.ok) {
        state.serverOnline = true;
        btn.disabled = false;
        setText(labelEl, 'Bridge connected');
        statusEl.className = 'server-status online';
      }
    } catch (_) {
      setText(labelEl, 'Bridge offline');
      statusEl.className = 'server-status';
    }
    updateSourceImportUI();
    if (state.serverOnline) urlInput.focus();
  }

  checkServer();

  urlInput.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (!btn.disabled) btn.click();
  });

  btn.addEventListener('click', () => {
    const url = urlInput.value.trim();
    if (!url) return;
    startDownload(url);
  });

  // ── Tab switching ──────────────────────────────────────────────
  const { tabUrl, tabSearch, urlMode, searchMode, searchInput } =
    $ids(['tabUrl', 'tabSearch', 'urlMode', 'searchMode', 'searchInput']);

  tabUrl.addEventListener('click', () => {
    if (state.importing) return;
    tabUrl.classList.add('active');
    tabSearch.classList.remove('active');
    setDisplay(urlMode, '');
    setDisplay(searchMode, 'none');
    urlInput.focus();
  });

  tabSearch.addEventListener('click', () => {
    if (state.importing) return;
    tabSearch.classList.add('active');
    tabUrl.classList.remove('active');
    setDisplay(searchMode, '');
    setDisplay(urlMode, 'none');
    searchInput.focus();
  });

  // ── Search ─────────────────────────────────────────────────────
  const resultsEl = $id('searchResults');
  let searchTimer = null;
  let searchAbort = null;

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (!q) {
      setDisplay(resultsEl, 'none');
      resultsEl.innerHTML = '';
      return;
    }
    searchTimer = setTimeout(() => runSearch(q), 320);
  });

  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      setDisplay(resultsEl, 'none');
      resultsEl.innerHTML = '';
    }
  });

  document.addEventListener('click', e => {
    if (!searchMode.contains(e.target)) {
      setDisplay(resultsEl, 'none');
    }
  });

  async function runSearch(q) {
    if (searchAbort) searchAbort.abort();
    searchAbort = new AbortController();

    resultsEl.innerHTML = `<div class="search-result-loading">${SPINNER_HTML}</div>`;
    setDisplay(resultsEl, 'block');

    try {
      const res = await fetch(`${SERVER}/api/search?q=${encodeURIComponent(q)}`, {
        signal: searchAbort.signal,
      });
      if (!res.ok) throw new Error('Search failed');
      const items = await res.json();
      renderResults(items);
    } catch (e) {
      if (e.name === 'AbortError') return;
      resultsEl.innerHTML = '<div class="search-result-empty">No results found</div>';
    }
  }

  function renderResults(items) {
    if (!items.length) {
      resultsEl.innerHTML = '<div class="search-result-empty">No results found</div>';
      return;
    }
    resultsEl.innerHTML = '';
    for (const item of items) {
      if (!item.videoId) continue;
      const el = document.createElement('div');
      el.className = 'search-result-item';
      el.innerHTML = `
        <div class="search-result-thumb">
          ${item.thumbnail ? `<img src="${item.thumbnail}" alt="" loading="lazy">` : '🎵'}
        </div>
        <div class="search-result-info">
          <div class="search-result-title">${escHtml(item.title)}</div>
          <div class="search-result-meta">${escHtml(item.artist)}${item.duration ? ' · ' + escHtml(item.duration) : ''}</div>
        </div>
      `;
      el.addEventListener('click', () => {
        setDisplay(resultsEl, 'none');
        resultsEl.innerHTML = '';
        searchInput.value = '';
        searchInput.disabled = true;
        state.importing = true;
        const ytUrl = `https://music.youtube.com/watch?v=${item.videoId}`;
        startDownload(ytUrl);
      });
      resultsEl.appendChild(el);
    }
  }
}

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const IMPORT_UI_STATE = {
  CONNECTING: 'connecting',
  LOADING: 'loading',
  PLAYLIST_PROGRESS: 'playlist-progress',
  ERROR: 'error',
  COMPLETE: 'complete',
};

// ── Shared SSE download flow ───────────────────────────────────
function startDownload(url) {
  const {
    urlLoadBtn: btn,
    urlInput,
    importStatus: statusEl,
    importArt: artEl,
    importTitle: titleEl,
    importArtist: artistEl,
    importStage: stageEl,
    importBar: barEl,
    importTrackProgress: trackProgEl,
    importTrackList: trackListEl,
  } = $ids([
    'urlLoadBtn',
    'urlInput',
    'importStatus',
    'importArt',
    'importTitle',
    'importArtist',
    'importStage',
    'importBar',
    'importTrackProgress',
    'importTrackList',
  ]);
  let stageSwapTimer = null;

  const setImportStage = (text) => {
    clearTimeout(stageSwapTimer);
    stageEl.classList.add('updating');
    stageSwapTimer = setTimeout(() => {
      setText(stageEl, text || '');
      stageEl.classList.remove('updating');
    }, 120);
  };

  const syncImportCardState = () => {
    const showTrackMeta =
      trackProgEl.classList.contains('visible') ||
      trackListEl.classList.contains('visible') ||
      !!trackListEl.children.length;
    toggleClass(statusEl, 'expanded', showTrackMeta);
  };

  // Hide drop zone, divider, tabs and active mode during loading
  const dropZone = $id('dropZone');
  const dividerEl = document.querySelector('.url-divider');
  const tabsEl = document.querySelector('.import-tabs');
  const urlMode = $id('urlMode');
  const searchModeEl = $id('searchMode');
  const searchActive = $id('tabSearch').classList.contains('active');

  let confirmed = false;

  function showLoadingCardIfNeeded() {
    if (confirmed) return;
    confirmed = true;
    dropZone.classList.add('load-hiding');
    dividerEl.classList.add('load-hiding');
    tabsEl.classList.add('load-hiding');
    if (searchActive) searchModeEl.classList.add('load-hiding');
    else urlMode.classList.add('load-hiding');
    setDisplay(statusEl, 'block');
    statusEl.classList.remove('expanded', 'live');
    requestAnimationFrame(() => statusEl.classList.add('live'));
  }

  function restoreInputs() {
    dropZone.classList.remove('load-hiding');
    dividerEl.classList.remove('load-hiding');
    tabsEl.classList.remove('load-hiding');
    urlMode.classList.remove('load-hiding');
    searchModeEl.classList.remove('load-hiding');
    setDisplay(urlMode, searchActive ? 'none' : '');
    setDisplay(searchModeEl, searchActive ? '' : 'none');
    btn.disabled = false;
    urlInput.disabled = false;
    document.getElementById('searchInput').disabled = false;
    state.importing = false;
    setText(btn, 'Load');
  }

  function hideImportStatus() {
    statusEl.classList.remove('live', 'expanded');
    setTimeout(() => { setDisplay(statusEl, 'none'); }, 350);
  }

  function setImportUiState(nextState) {
    if (nextState === IMPORT_UI_STATE.CONNECTING) {
      btn.disabled = true;
      urlInput.disabled = true;
      btn.innerHTML = spinnerWithText('Loading…');
      artEl.innerHTML = '🎵';
      setText(titleEl, 'Connecting…');
      setText(artistEl, '');
      setText(stageEl, '');
      barEl.style.width = '0%';
      setDisplay(trackProgEl, 'block');
      setDisplay(trackListEl, 'block');
      trackProgEl.classList.remove('visible');
      trackListEl.classList.remove('visible');
      trackListEl.innerHTML = '';
      syncImportCardState();
      return;
    }
    if (nextState === IMPORT_UI_STATE.LOADING) {
      showLoadingCardIfNeeded();
      return;
    }
    if (nextState === IMPORT_UI_STATE.PLAYLIST_PROGRESS) {
      toggleClass(trackProgEl, 'visible', true);
      toggleClass(trackListEl, 'visible', true);
      syncImportCardState();
      return;
    }
    if (nextState === IMPORT_UI_STATE.COMPLETE) {
      restoreInputs();
      return;
    }
    if (nextState === IMPORT_UI_STATE.ERROR) {
      if (confirmed) hideImportStatus();
      restoreInputs();
      return;
    }
  }

  setImportUiState(IMPORT_UI_STATE.CONNECTING);

  let completedFile = null;
  let completedTitle = 'track';
  let foundYouTubeUrl = null;
  const isSpotifySource = /spotify\.com/i.test(url);

  const es = new EventSource(`${SERVER}/api/download/stream?url=${encodeURIComponent(url)}`);

  es.addEventListener('stage', e => {
    const d = JSON.parse(e.data);
    setImportStage(d.message);
  });

  es.addEventListener('metadata', e => {
    setImportUiState(IMPORT_UI_STATE.LOADING);
    const d = JSON.parse(e.data);
    completedTitle = d.name || d.title || 'track';
    setText(titleEl, completedTitle);
    const trackCount = d.total_tracks > 1 ? ` • ${d.total_tracks} tracks` : '';
    setText(artistEl, (d.artist || '') + trackCount);
    if (d.image_url) {
      artEl.innerHTML = `<img src="${d.image_url}" alt="album art">`;
    }
    if (d.total_tracks > 1) {
      trackListEl.classList.add('visible');
      syncImportCardState();
    }
  });

  es.addEventListener('found', e => {
    setImportUiState(IMPORT_UI_STATE.LOADING);
    const d = JSON.parse(e.data);
    foundYouTubeUrl = d.youtube_url || foundYouTubeUrl;
    setImportStage(d.fallback
      ? 'No exact match — searching YouTube…'
      : 'Found on YouTube Music');
  });

  es.addEventListener('progress', e => {
    const d = JSON.parse(e.data);
    barEl.style.width = d.percent + '%';
  });

  es.addEventListener('track_start', e => {
    const d = JSON.parse(e.data);
    setImportUiState(IMPORT_UI_STATE.PLAYLIST_PROGRESS);
    trackProgEl.textContent = `${d.artist} – ${d.title}`;
    barEl.style.width = '0%';
    const item = document.createElement('div');
    item.className = 'import-track-item active';
    item.id = `itrack-${d.index}`;
    item.innerHTML = `<span class="import-track-num">${d.index + 1}</span>${d.artist} – ${d.title}`;
    trackListEl.appendChild(item);
    item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    syncImportCardState();
  });

  es.addEventListener('track_complete', e => {
    const d = JSON.parse(e.data);
    completedFile = d.file;
    const item = $id(`itrack-${d.index}`);
    if (item) {
      item.className = 'import-track-item done';
      item.innerHTML = `<span class="import-track-check">✓</span>${d.artist} – ${d.title}`;
    }
    syncImportCardState();
  });

  es.addEventListener('track_error', e => {
    const d = JSON.parse(e.data);
    const item = $id(`itrack-${d.index}`);
    if (item) {
      item.className = 'import-track-item done';
      item.innerHTML = `<span class="import-track-err">✗</span>${d.title}`;
    }
    syncImportCardState();
  });

  es.addEventListener('complete', async e => {
    es.close();
    const d = JSON.parse(e.data);
    const file = d.file || completedFile;
    setImportStage('✓ Done — loading into studio…');
    barEl.style.width = '100%';
    try {
      const fileRes = await fetch(`${SERVER}/api/file?path=${encodeURIComponent(file)}&consume=1`);
      if (!fileRes.ok) throw new Error('Could not retrieve file');
      const ab = await fileRes.arrayBuffer();
      const sourceLinks = {
        spotify: isSpotifySource ? url : null,
        youtube: isSpotifySource ? foundYouTubeUrl : url,
      };
      await loadFile(ab, completedTitle + '.mp3', { sourceLinks });
      urlInput.value = '';
      setDisplay(statusEl, 'none');
      statusEl.classList.remove('expanded', 'live');
    } catch (err) {
      setImportStage('✗ ' + err.message);
      toast('Error: ' + err.message, 5000, 'error');
    } finally {
      setImportUiState(IMPORT_UI_STATE.COMPLETE);
    }
  });

  es.addEventListener('error', e => {
    es.close();
    let msg = 'Download failed';
    try { msg = JSON.parse(e.data).message; } catch {}
    toast('Error: ' + msg, 5000, 'error');
    setImportUiState(IMPORT_UI_STATE.ERROR);
  });

  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) return;
    es.close();
    toast('Connection lost', 3000, 'error');
    setImportUiState(IMPORT_UI_STATE.ERROR);
  };
}
