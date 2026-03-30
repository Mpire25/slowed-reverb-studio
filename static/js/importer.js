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
        const ytUrl = `https://music.youtube.com/watch?v=${item.videoId}`;
        startDownload(ytUrl, { title: item.title, artist: item.artist, thumbnail: item.thumbnail });
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

// ── Stage message map ──────────────────────────────────────────
const STAGE_MESSAGES = {
  fetching_metadata: 'Finding track…',
  searching:         'Searching YouTube Music…',
  found:             null, // handled by `found` event
  downloading:       'Downloading audio…',
  converting:        'Converting to MP3…',
  embedding:         'Adding track info…',
};

// ── 4-stage bar helpers ────────────────────────────────────────
const SSE_TO_BAR_STAGE = {
  fetching_metadata: 'resolve',
  searching:         'resolve',
  found:             'resolve',
  downloading:       'download',
  converting:        'process',
  embedding:         'process',
};
const BAR_STAGES = ['resolve', 'download', 'process', 'load'];
let barStageIndex = -1;
const barStageProgress = Object.create(null);

function advanceBarToStage(stageName) {
  const idx = BAR_STAGES.indexOf(stageName);
  if (idx < 0 || idx <= barStageIndex) return;
  // Complete all earlier stages when we advance (e.g. resolve -> download).
  for (let i = Math.max(0, barStageIndex); i < idx; i++) {
    completeBarStage(BAR_STAGES[i]);
  }
  barStageIndex = idx;
  setBarStageActive(stageName);
}

function setBarStageProgress(stageName, pct) {
  const next = Math.max(0, Math.min(100, Number(pct) || 0));
  const current = barStageProgress[stageName] || 0;
  const clamped = Math.max(current, next); // Never let a stage visually move backwards.
  barStageProgress[stageName] = clamped;
  const el = $id('stageFill-' + stageName);
  if (el) el.style.width = clamped + '%';
}

function completeBarStage(stageName) {
  setBarStageProgress(stageName, 100);
  const seg = $id('stageSeg-' + stageName);
  if (seg) { seg.classList.remove('active'); seg.classList.add('done'); }
}

function setBarStageActive(stageName) {
  const seg = $id('stageSeg-' + stageName);
  if (seg) seg.classList.add('active');
}

function resetBarStages() {
  barStageIndex = -1;
  BAR_STAGES.forEach(s => {
    barStageProgress[s] = 0;
    const fill = $id('stageFill-' + s);
    const seg  = $id('stageSeg-' + s);
    if (fill) fill.style.width = '0%';
    if (seg)  seg.classList.remove('active', 'done');
  });
}

// ── Playlist detection ─────────────────────────────────────────
function isPlaylistUrl(url) {
  return (
    /spotify\.com\/(album|playlist)\//i.test(url) ||
    (/music\.youtube\.com/i.test(url) && /[?&]list=/i.test(url))
  );
}

async function startPlaylistLoad(url) {
  const {
    urlLoadBtn: btn,
    urlInput,
    importStatus: statusEl,
    importArt: artEl,
    importTitle: titleEl,
    importArtist: artistEl,
    importStage: stageEl,
    importTrackProgress: trackProgEl,
    importTrackList: trackListEl,
  } = $ids([
    'urlLoadBtn', 'urlInput', 'importStatus', 'importArt',
    'importTitle', 'importArtist', 'importStage',
    'importTrackProgress', 'importTrackList',
  ]);

  const dropZone = $id('dropZone');
  const dividerEl = document.querySelector('.url-divider');
  const tabsEl = document.querySelector('.import-tabs');
  const urlMode = $id('urlMode');
  const searchModeEl = $id('searchMode');

  state.importing = true;
  dropZone.classList.add('load-hiding');
  dividerEl.classList.add('load-hiding');
  tabsEl.classList.add('load-hiding');
  urlMode.classList.add('load-hiding');
  btn.disabled = true;
  urlInput.disabled = true;
  btn.innerHTML = spinnerWithText('Loading…');

  artEl.innerHTML = '🎵';
  setText(titleEl, 'Fetching playlist…');
  setText(artistEl, '');
  setText(stageEl, '');
  resetBarStages();
  setDisplay(trackProgEl, 'block');
  setDisplay(trackListEl, 'block');
  trackProgEl.classList.remove('visible');
  trackListEl.classList.remove('visible');
  setDisplay(statusEl, 'block');
  statusEl.classList.remove('live');
  statusEl.classList.add('expanded');
  requestAnimationFrame(() => {
    statusEl.classList.add('live');
    advanceBarToStage('resolve');
  });

  function restoreInputsOnly() {
    dropZone.classList.remove('load-hiding', 'ui-disabled');
    dividerEl.classList.remove('load-hiding');
    tabsEl.classList.remove('load-hiding', 'ui-disabled');
    urlMode.classList.remove('load-hiding');
    searchModeEl.classList.remove('load-hiding');
    const searchActive = $id('tabSearch').classList.contains('active');
    setDisplay(urlMode, searchActive ? 'none' : '');
    setDisplay(searchModeEl, searchActive ? '' : 'none');
    btn.disabled = false;
    urlInput.disabled = false;
    document.getElementById('searchInput').disabled = false;
    state.importing = false;
    setText(btn, 'Load');
  }

  function hideStatus() {
    statusEl.classList.remove('live', 'expanded');
    setTimeout(() => setDisplay(statusEl, 'none'), 350);
  }

  let stageSwapTimer = null;
  const setImportStage = (text) => {
    clearTimeout(stageSwapTimer);
    stageEl.classList.add('updating');
    stageSwapTimer = setTimeout(() => {
      setText(stageEl, text || '');
      stageEl.classList.remove('updating');
    }, 120);
  };

  let firstES = null;

  try {
    const res = await fetch(`${SERVER}/api/playlist/info?url=${encodeURIComponent(url)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load playlist');

    if (!data.tracks || data.tracks.length === 0) {
      throw new Error('Playlist is empty');
    }

    const firstTrack = data.tracks[0];
    const totalTracks = data.tracks.length;
    const isSpotifySource = /spotify\.com/i.test(url);

    // In playlist/album mode, title should represent the container, not track 1.
    completeBarStage('resolve');
    setText(titleEl, data.name || firstTrack.name || 'Playlist');
    setText(artistEl, firstTrack.artist || '');
    if (firstTrack.image_url) {
      artEl.innerHTML = `<img src="${firstTrack.image_url}" alt="album art">`;
    }
    // Show "Playlist name · Track 1 of N"
    trackProgEl.textContent = `${data.name} · Track 1 of ${totalTracks}`;
    trackProgEl.classList.add('visible');

    const trackData = {
      index: 0,
      name: firstTrack.name,
      artist: firstTrack.artist || '',
      album: firstTrack.album || '',
      duration_ms: firstTrack.duration_ms || 0,
      image_url: firstTrack.image_url || null,
      video_id: firstTrack.video_id || null,
    };

    firstES = new EventSource(
      `${SERVER}/api/download/track?track_data=${encodeURIComponent(JSON.stringify(trackData))}`
    );

    firstES.addEventListener('stage', e => {
      const d = JSON.parse(e.data);
      const msg = (d.stage in STAGE_MESSAGES) ? STAGE_MESSAGES[d.stage] : d.message;
      if (msg !== null) setImportStage(msg);
      if (d.stage === 'converting') {
        const idx = BAR_STAGES.indexOf('process');
        for (let i = Math.max(0, barStageIndex); i < idx; i++) completeBarStage(BAR_STAGES[i]);
        barStageIndex = idx;
        setBarStageActive('process');
      } else {
        const barStage = SSE_TO_BAR_STAGE[d.stage];
        if (barStage) advanceBarToStage(barStage);
      }
    });

    firstES.addEventListener('found', e => {
      const d = JSON.parse(e.data);
      setImportStage(d.fallback ? 'No exact match — searching YouTube…' : 'Found on YouTube Music');
      advanceBarToStage('download');
    });

    firstES.addEventListener('progress', e => {
      const d = JSON.parse(e.data);
      const seg = SSE_TO_BAR_STAGE[d.stage] || 'download';
      setBarStageProgress(seg, d.percent);
    });

    firstES.addEventListener('complete', async e => {
      firstES.close();
      firstES = null;
      const d = JSON.parse(e.data);
      completeBarStage('process');
      setImportStage('Loading into studio…');
      setTimeout(() => advanceBarToStage('load'), 200);

      try {
        // Fetch WITHOUT consume — playlist.js manages the file lifetime
        const fileRes = await fetch(`${SERVER}/api/file?path=${encodeURIComponent(d.file)}`);
        if (!fileRes.ok) throw new Error('Could not retrieve file');
        const contentLength = parseInt(fileRes.headers.get('Content-Length') || '0', 10);
        const reader = fileRes.body.getReader();
        const chunks = [];
        let received = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.byteLength;
          if (contentLength > 0) setBarStageProgress('load', Math.round((received / contentLength) * 100));
        }
        const ab = new Uint8Array(received);
        let pos = 0;
        for (const chunk of chunks) { ab.set(chunk, pos); pos += chunk.byteLength; }

        const sourceLinks = {
          spotify: isSpotifySource ? url : null,
          youtube: isSpotifySource
            ? (firstTrack.video_id ? `https://www.youtube.com/watch?v=${firstTrack.video_id}` : null)
            : url,
        };
        await loadFile(ab.buffer, (firstTrack.name || 'track') + '.mp3', {
          autoPlay: true,
          sourceLinks,
          suppressToast: true,
        });
        completeBarStage('load');
        await new Promise(resolve => setTimeout(resolve, 220));
        hideStatus();
      } catch (err) {
        setImportStage('✗ ' + err.message);
        toast('Error loading track: ' + err.message, 5000, 'error');
      }

      restoreInputsOnly();
      urlInput.value = '';

      const { initPlaylist } = await import('./playlist.js');
      initPlaylist(data, url, { firstTrackPath: d.file });
    });

    firstES.addEventListener('error', e => {
      if (firstES) firstES.close();
      firstES = null;
      let msg = 'Download failed';
      try { msg = JSON.parse(e.data).message; } catch {}
      toast('Error: ' + msg, 5000, 'error');
      restoreInputsOnly();
      hideStatus();
    });

    firstES.onerror = () => {
      if (!firstES || firstES.readyState === EventSource.CLOSED) return;
      firstES.close();
      firstES = null;
      toast('Connection lost', 3000, 'error');
      restoreInputsOnly();
      hideStatus();
    };

  } catch (err) {
    if (firstES) { firstES.close(); firstES = null; }
    toast('Error: ' + err.message, 5000, 'error');
    restoreInputsOnly();
    hideStatus();
  }
}

// ── Shared SSE download flow ───────────────────────────────────
function startDownload(url, prefill = null) {
  if (isPlaylistUrl(url)) {
    startPlaylistLoad(url);
    return;
  }

  const {
    urlLoadBtn: btn,
    urlInput,
    importStatus: statusEl,
    importArt: artEl,
    importTitle: titleEl,
    importArtist: artistEl,
    importStage: stageEl,
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
    'importTrackProgress',
    'importTrackList',
  ]);
  let stageSwapTimer = null;

  resetBarStages();

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
  let cardShown = false;

  function showLoadingCardIfNeeded() {
    if (confirmed) return;
    confirmed = true;
    dropZone.classList.remove('ui-disabled');
    tabsEl.classList.remove('ui-disabled');
    dropZone.classList.add('load-hiding');
    dividerEl.classList.add('load-hiding');
    tabsEl.classList.add('load-hiding');
    if (searchActive) searchModeEl.classList.add('load-hiding');
    else urlMode.classList.add('load-hiding');

    if (!cardShown) {
      setDisplay(statusEl, 'block');
      statusEl.classList.remove('expanded', 'live');
      requestAnimationFrame(() => statusEl.classList.add('live'));
      cardShown = true;
    }
  }

  function restoreInputs() {
    dropZone.classList.remove('load-hiding', 'ui-disabled');
    dividerEl.classList.remove('load-hiding');
    tabsEl.classList.remove('load-hiding', 'ui-disabled');
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

  // Lock all input surfaces immediately
  state.importing = true;
  dropZone.classList.add('ui-disabled');
  tabsEl.classList.add('ui-disabled');

  function setImportUiState(nextState) {
    if (nextState === IMPORT_UI_STATE.CONNECTING) {
      btn.disabled = true;
      urlInput.disabled = true;
      btn.innerHTML = spinnerWithText('Loading…');
      artEl.innerHTML = '🎵';
      setText(titleEl, 'Connecting…');
      setText(artistEl, '');
      setText(stageEl, '');
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
      if (cardShown) hideImportStatus();
      restoreInputs();
      return;
    }
  }

  setImportUiState(IMPORT_UI_STATE.CONNECTING);

  let completedFile = null;
  let completedTitle = 'track';

  if (prefill) {
    completedTitle = prefill.title || 'track';
    setText(titleEl, completedTitle);
    setText(artistEl, prefill.artist || '');
    artEl.innerHTML = prefill.thumbnail ? `<img src="${prefill.thumbnail}" alt="album art">` : '🎵';
    setDisplay(statusEl, 'block');
    statusEl.classList.remove('expanded', 'live');
    requestAnimationFrame(() => statusEl.classList.add('live'));
    cardShown = true;
    // Track already resolved via search — animate resolve bar to done
    advanceBarToStage('resolve');
    setTimeout(() => completeBarStage('resolve'), 300);
  }
  let foundYouTubeUrl = null;
  const isSpotifySource = /spotify\.com/i.test(url);

  // Activate resolve stage immediately so the bar is visibly non-zero.
  // scheduleBarProgress ensures fast SSE responses always animate FROM 8%
  // rather than skipping straight to a later value.
  advanceBarToStage('resolve');
  const barStartTime = Date.now();
  const BAR_ANIM_MIN_MS = 400;
  function scheduleBarProgress(stage, pct) {
    const wait = BAR_ANIM_MIN_MS - (Date.now() - barStartTime);
    if (wait > 0) setTimeout(() => setBarStageProgress(stage, pct), wait);
    else setBarStageProgress(stage, pct);
  }

  const es = new EventSource(`${SERVER}/api/download/stream?url=${encodeURIComponent(url)}`);

  es.addEventListener('stage', e => {
    const d = JSON.parse(e.data);
    const msg = (d.stage in STAGE_MESSAGES) ? STAGE_MESSAGES[d.stage] : d.message;
    if (msg !== null) setImportStage(msg);

    if (d.stage === 'fetching_metadata') {
      advanceBarToStage('resolve');
      setBarStageProgress('resolve', 10);
    } else if (d.stage === 'converting') {
      // Complete prior stages and activate process, but don't set a fake
      // initial value — real ffmpeg progress events will fill it from 0.
      const idx = BAR_STAGES.indexOf('process');
      for (let i = Math.max(0, barStageIndex); i < idx; i++) completeBarStage(BAR_STAGES[i]);
      barStageIndex = idx;
      setBarStageActive('process');
    } else {
      const barStage = SSE_TO_BAR_STAGE[d.stage];
      if (barStage) advanceBarToStage(barStage);
    }
  });

  es.addEventListener('metadata', e => {
    setImportUiState(IMPORT_UI_STATE.LOADING);
    const d = JSON.parse(e.data);
    completedTitle = d.name || d.title || 'track';
    setText(titleEl, completedTitle);
    if (d.total_tracks > 1) {
      es.close();
      restoreInputs();
      setDisplay(statusEl, 'none');
      toast('Multi-track response received — paste a playlist URL to use playlist mode', 5000, 'error');
      return;
    }
    setText(artistEl, d.artist || '');
    if (d.image_url) {
      artEl.innerHTML = `<img src="${d.image_url}" alt="album art">`;
    }

    if (isSpotifySource) {
      scheduleBarProgress('resolve', 40);
    } else {
      scheduleBarProgress('resolve', 100);
    }
  });

  es.addEventListener('found', e => {
    setImportUiState(IMPORT_UI_STATE.LOADING);
    const d = JSON.parse(e.data);
    foundYouTubeUrl = d.youtube_url || foundYouTubeUrl;
    setImportStage(d.fallback
      ? 'No exact match — searching YouTube…'
      : 'Found on YouTube Music');
    advanceBarToStage('resolve');
    completeBarStage('resolve');
  });

  es.addEventListener('progress', e => {
    const d = JSON.parse(e.data);
    const seg = SSE_TO_BAR_STAGE[d.stage] || 'download';
    setBarStageProgress(seg, d.percent);
  });

  /* PLAYLIST CODE — preserved for future use, currently disabled
  es.addEventListener('track_start', e => {
    const d = JSON.parse(e.data);
    setImportUiState(IMPORT_UI_STATE.PLAYLIST_PROGRESS);
    trackProgEl.textContent = `${d.artist} – ${d.title}`;
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
  */

  es.addEventListener('complete', async e => {
    es.close();
    const d = JSON.parse(e.data);
    const file = d.file || completedFile;
    completeBarStage('process');
    setImportStage('Loading into studio…');
    setTimeout(() => {
      advanceBarToStage('load');
    }, 200);
    try {
      const fileRes = await fetch(`${SERVER}/api/file?path=${encodeURIComponent(file)}&consume=1`);
      if (!fileRes.ok) throw new Error('Could not retrieve file');
      const contentLength = parseInt(fileRes.headers.get('Content-Length') || '0', 10);
      const reader = fileRes.body.getReader();
      const chunks = [];
      let received = 0;
      let unknownLenProgress = 8;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        if (contentLength > 0) {
          setBarStageProgress('load', Math.round((received / contentLength) * 100));
        } else {
          unknownLenProgress = Math.min(92, unknownLenProgress + 6);
          setBarStageProgress('load', unknownLenProgress);
        }
      }
      const ab = new Uint8Array(received);
      let pos = 0;
      for (const chunk of chunks) { ab.set(chunk, pos); pos += chunk.byteLength; }
      const sourceLinks = {
        spotify: isSpotifySource ? url : null,
        youtube: isSpotifySource ? foundYouTubeUrl : url,
      };
      await loadFile(ab.buffer, completedTitle + '.mp3', { sourceLinks });
      completeBarStage('load');
      await new Promise(resolve => setTimeout(resolve, 220));
      urlInput.value = '';
      hideImportStatus();
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
