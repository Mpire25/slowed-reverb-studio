import { state } from './state.js';
import { loadFile, updateSourceImportUI } from './loader.js';
import { SERVER } from './config.js';
import { toast } from './utils.js';

export function initImporter() {
  const btn        = document.getElementById('urlLoadBtn');
  const urlInput   = document.getElementById('urlInput');

  async function checkServer() {
    const statusEl = document.getElementById('serverStatus');
    const labelEl = document.getElementById('statusLabel');
    statusEl.style.display = 'flex';
    try {
      const r = await fetch(`${SERVER}/ping`, { signal: AbortSignal.timeout(800) });
      if (r.ok) {
        state.serverOnline = true;
        btn.disabled = false;
        labelEl.textContent = 'Bridge connected';
        statusEl.className = 'server-status online';
      }
    } catch (_) {
      labelEl.textContent = 'Bridge offline';
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
  const tabUrl     = document.getElementById('tabUrl');
  const tabSearch  = document.getElementById('tabSearch');
  const urlMode    = document.getElementById('urlMode');
  const searchMode = document.getElementById('searchMode');
  const searchInput= document.getElementById('searchInput');

  tabUrl.addEventListener('click', () => {
    tabUrl.classList.add('active');
    tabSearch.classList.remove('active');
    urlMode.style.display = '';
    searchMode.style.display = 'none';
    urlInput.focus();
  });

  tabSearch.addEventListener('click', () => {
    tabSearch.classList.add('active');
    tabUrl.classList.remove('active');
    searchMode.style.display = '';
    urlMode.style.display = 'none';
    searchInput.focus();
  });

  // ── Search ─────────────────────────────────────────────────────
  const resultsEl = document.getElementById('searchResults');
  let searchTimer = null;
  let searchAbort = null;

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (!q) {
      resultsEl.style.display = 'none';
      resultsEl.innerHTML = '';
      return;
    }
    searchTimer = setTimeout(() => runSearch(q), 320);
  });

  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      resultsEl.style.display = 'none';
      resultsEl.innerHTML = '';
    }
  });

  document.addEventListener('click', e => {
    if (!searchMode.contains(e.target)) {
      resultsEl.style.display = 'none';
    }
  });

  async function runSearch(q) {
    if (searchAbort) searchAbort.abort();
    searchAbort = new AbortController();

    resultsEl.innerHTML = '<div class="search-result-loading"><span class="spinner"></span></div>';
    resultsEl.style.display = 'block';

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
        resultsEl.style.display = 'none';
        resultsEl.innerHTML = '';
        searchInput.value = '';
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

// ── Shared SSE download flow ───────────────────────────────────
function startDownload(url) {
  const btn        = document.getElementById('urlLoadBtn');
  const urlInput   = document.getElementById('urlInput');
  const statusEl   = document.getElementById('importStatus');
  const artEl      = document.getElementById('importArt');
  const titleEl    = document.getElementById('importTitle');
  const artistEl   = document.getElementById('importArtist');
  const stageEl    = document.getElementById('importStage');
  const barEl      = document.getElementById('importBar');
  const trackProgEl= document.getElementById('importTrackProgress');
  const trackListEl= document.getElementById('importTrackList');
  let stageSwapTimer = null;

  const setImportStage = (text) => {
    clearTimeout(stageSwapTimer);
    stageEl.classList.add('updating');
    stageSwapTimer = setTimeout(() => {
      stageEl.textContent = text || '';
      stageEl.classList.remove('updating');
    }, 120);
  };

  const syncImportCardState = () => {
    const showTrackMeta =
      trackProgEl.classList.contains('visible') ||
      trackListEl.classList.contains('visible') ||
      !!trackListEl.children.length;
    statusEl.classList.toggle('expanded', showTrackMeta);
  };

  // Hide drop zone, divider, tabs and active mode during loading
  const dropZone  = document.getElementById('dropZone');
  const dividerEl = document.querySelector('.url-divider');
  const tabsEl    = document.querySelector('.import-tabs');
  const urlMode   = document.getElementById('urlMode');
  const searchModeEl = document.getElementById('searchMode');
  const searchActive = document.getElementById('tabSearch').classList.contains('active');

  dropZone.classList.add('load-hiding');
  dividerEl.classList.add('load-hiding');
  tabsEl.classList.add('load-hiding');
  if (searchActive) searchModeEl.classList.add('load-hiding');
  else urlMode.classList.add('load-hiding');

  const restoreInputs = () => {
    dropZone.classList.remove('load-hiding');
    dividerEl.classList.remove('load-hiding');
    tabsEl.classList.remove('load-hiding');
    urlMode.classList.remove('load-hiding');
    searchModeEl.classList.remove('load-hiding');
    // Keep inactive mode hidden via display
    urlMode.style.display = searchActive ? 'none' : '';
    searchModeEl.style.display = searchActive ? '' : 'none';
    btn.disabled = false;
    urlInput.disabled = false;
    btn.textContent = 'Load';
  };

  // Disable inputs while loading
  btn.disabled = true;
  urlInput.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Loading…';
  statusEl.style.display = 'block';
  statusEl.classList.remove('expanded', 'live');
  requestAnimationFrame(() => statusEl.classList.add('live'));
  artEl.innerHTML = '🎵';
  titleEl.textContent = 'Connecting…';
  artistEl.textContent = '';
  stageEl.textContent = '';
  barEl.style.width = '0%';
  trackProgEl.style.display = 'block';
  trackListEl.style.display = 'block';
  trackProgEl.classList.remove('visible');
  trackListEl.classList.remove('visible');
  trackListEl.innerHTML = '';
  syncImportCardState();

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
    const d = JSON.parse(e.data);
    completedTitle = d.name || d.title || 'track';
    titleEl.textContent = completedTitle;
    const trackCount = d.total_tracks > 1 ? ` • ${d.total_tracks} tracks` : '';
    artistEl.textContent = (d.artist || '') + trackCount;
    if (d.image_url) {
      artEl.innerHTML = `<img src="${d.image_url}" alt="album art">`;
    }
    if (d.total_tracks > 1) {
      trackListEl.classList.add('visible');
      syncImportCardState();
    }
  });

  es.addEventListener('found', e => {
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
    trackProgEl.classList.add('visible');
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
    const item = document.getElementById(`itrack-${d.index}`);
    if (item) {
      item.className = 'import-track-item done';
      item.innerHTML = `<span class="import-track-check">✓</span>${d.artist} – ${d.title}`;
    }
    syncImportCardState();
  });

  es.addEventListener('track_error', e => {
    const d = JSON.parse(e.data);
    const item = document.getElementById(`itrack-${d.index}`);
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
      statusEl.style.display = 'none';
      statusEl.classList.remove('expanded', 'live');
    } catch (err) {
      setImportStage('✗ ' + err.message);
      toast('Error: ' + err.message, 5000);
    } finally {
      restoreInputs();
    }
  });

  es.addEventListener('error', e => {
    es.close();
    let msg = 'Download failed';
    try { msg = JSON.parse(e.data).message; } catch {}
    setImportStage('✗ ' + msg);
    toast('Error: ' + msg, 5000);
    restoreInputs();
  });

  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) return;
    es.close();
    setImportStage('✗ Connection lost');
    restoreInputs();
  };
}
