import { state } from './state.js';
import { loadFile, updateSourceImportUI } from './loader.js';
import { SERVER } from './config.js';
import { toast } from './utils.js';
import { $id, $ids, setDisplay, setText, toggleClass, spinnerWithText } from './dom.js';
import { createImportProgressBar, STAGE_MESSAGES, SSE_TO_BAR_STAGE } from './importer_progress.js';
import { createStageTextUpdater } from './importer_stage_text.js';
import { initImporterSearch } from './importer_search.js';
import { createImporterView } from './importer_view.js';

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

  initImporterSearch({
    searchModeEl: searchMode,
    searchInputEl: searchInput,
    resultsEl: $id('searchResults'),
    onSelect: ({ url, prefill }) => startDownload(url, prefill),
  });
}

const progressBar = createImportProgressBar();

const IMPORT_UI_STATE = {
  CONNECTING: 'connecting',
  LOADING: 'loading',
  ERROR: 'error',
  COMPLETE: 'complete',
};

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
    importTrackList: trackListEl,
  } = $ids([
    'urlLoadBtn', 'urlInput', 'importStatus', 'importArt',
    'importTitle', 'importArtist', 'importStage',
    'importTrackList',
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
  progressBar.resetStages();
  setDisplay(trackListEl, 'block');
  trackListEl.classList.remove('visible');
  setDisplay(statusEl, 'block');
  statusEl.classList.remove('live');
  statusEl.classList.add('expanded');
  requestAnimationFrame(() => {
    statusEl.classList.add('live');
    progressBar.advanceToStage('resolve');
  });

  const view = createImporterView({
    dropZone,
    dividerEl,
    tabsEl,
    urlModeEl: urlMode,
    searchModeEl,
    searchInputEl: /** @type {HTMLInputElement} */ (document.getElementById('searchInput')),
    loadBtn: /** @type {HTMLButtonElement} */ (btn),
    urlInput: /** @type {HTMLInputElement} */ (urlInput),
    statusEl,
    getSearchActive: () => $id('tabSearch').classList.contains('active'),
    setImporting: next => { state.importing = next; },
  });

  const stageText = createStageTextUpdater(stageEl);
  const setImportStage = text => stageText.set(text);

  let firstES = null;

  try {
    const res = await fetch(`${SERVER}/api/playlist/info?url=${encodeURIComponent(url)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load playlist');

    if (!data.tracks || data.tracks.length === 0) {
      throw new Error('Playlist is empty');
    }

    const firstTrack = data.tracks[0];
    const isSpotifySource = /spotify\.com/i.test(url);

    // In playlist/album mode, title should represent the container, not track 1.
    progressBar.completeStage('resolve');
    setText(titleEl, data.name || firstTrack.name || 'Playlist');
    setText(artistEl, firstTrack.artist || '');
    if (firstTrack.image_url) {
      artEl.innerHTML = `<img src="${firstTrack.image_url}" alt="album art">`;
    }

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
        progressBar.completePriorAndActivate('process');
      } else {
        const barStage = SSE_TO_BAR_STAGE[d.stage];
        if (barStage) progressBar.advanceToStage(barStage);
      }
    });

    firstES.addEventListener('found', e => {
      const d = JSON.parse(e.data);
      setImportStage(d.fallback ? 'No exact match — searching YouTube…' : 'Found on YouTube Music');
      progressBar.advanceToStage('download');
    });

    firstES.addEventListener('progress', e => {
      const d = JSON.parse(e.data);
      const seg = SSE_TO_BAR_STAGE[d.stage] || 'download';
      progressBar.setStageProgress(seg, d.percent);
    });

    firstES.addEventListener('complete', async e => {
      firstES.close();
      firstES = null;
      const d = JSON.parse(e.data);
      progressBar.completeStage('process');
      setImportStage('Loading into studio…');
      setTimeout(() => progressBar.advanceToStage('load'), 200);

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
          if (contentLength > 0) progressBar.setStageProgress('load', Math.round((received / contentLength) * 100));
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
        progressBar.completeStage('load');
        await new Promise(resolve => setTimeout(resolve, 220));
        view.hideStatus();
      } catch (err) {
        setImportStage('✗ ' + err.message);
        toast('Error loading track: ' + err.message, 5000, 'error');
      }

      view.restoreInputs();
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
      view.restoreInputs();
      view.hideStatus();
    });

    firstES.onerror = () => {
      if (!firstES || firstES.readyState === EventSource.CLOSED) return;
      firstES.close();
      firstES = null;
      toast('Connection lost', 3000, 'error');
      view.restoreInputs();
      view.hideStatus();
    };

  } catch (err) {
    if (firstES) { firstES.close(); firstES = null; }
    toast('Error: ' + err.message, 5000, 'error');
    view.restoreInputs();
    view.hideStatus();
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
    importTrackList: trackListEl,
  } = $ids([
    'urlLoadBtn',
    'urlInput',
    'importStatus',
    'importArt',
    'importTitle',
    'importArtist',
    'importStage',
    'importTrackList',
  ]);
  progressBar.resetStages();

  const stageText = createStageTextUpdater(stageEl);
  const setImportStage = text => stageText.set(text);

  const syncImportCardState = () => {
    const showTrackMeta =
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
  const searchInputEl = /** @type {HTMLInputElement} */ (document.getElementById('searchInput'));
  const searchActive = $id('tabSearch').classList.contains('active');
  const view = createImporterView({
    dropZone,
    dividerEl,
    tabsEl,
    urlModeEl: urlMode,
    searchModeEl,
    searchInputEl,
    loadBtn: /** @type {HTMLButtonElement} */ (btn),
    urlInput: /** @type {HTMLInputElement} */ (urlInput),
    statusEl,
    getSearchActive: () => searchActive,
    setImporting: next => { state.importing = next; },
  });

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
      setDisplay(trackListEl, 'block');
      trackListEl.classList.remove('visible');
      trackListEl.innerHTML = '';
      syncImportCardState();
      return;
    }
    if (nextState === IMPORT_UI_STATE.LOADING) {
      showLoadingCardIfNeeded();
      return;
    }
    if (nextState === IMPORT_UI_STATE.COMPLETE) {
      view.restoreInputs();
      return;
    }
    if (nextState === IMPORT_UI_STATE.ERROR) {
      if (cardShown) view.hideStatus();
      view.restoreInputs();
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
    progressBar.advanceToStage('resolve');
    setTimeout(() => progressBar.completeStage('resolve'), 300);
  }
  let foundYouTubeUrl = null;
  const isSpotifySource = /spotify\.com/i.test(url);

  // Activate resolve stage immediately so the bar is visibly non-zero.
  // scheduleBarProgress ensures fast SSE responses always animate FROM 8%
  // rather than skipping straight to a later value.
  progressBar.advanceToStage('resolve');
  const barStartTime = Date.now();
  const BAR_ANIM_MIN_MS = 400;
  function scheduleBarProgress(stage, pct) {
    const wait = BAR_ANIM_MIN_MS - (Date.now() - barStartTime);
    if (wait > 0) setTimeout(() => progressBar.setStageProgress(stage, pct), wait);
    else progressBar.setStageProgress(stage, pct);
  }

  const es = new EventSource(`${SERVER}/api/download/stream?url=${encodeURIComponent(url)}`);

  es.addEventListener('stage', e => {
    const d = JSON.parse(e.data);
    const msg = (d.stage in STAGE_MESSAGES) ? STAGE_MESSAGES[d.stage] : d.message;
    if (msg !== null) setImportStage(msg);

    if (d.stage === 'fetching_metadata') {
      progressBar.advanceToStage('resolve');
      progressBar.setStageProgress('resolve', 10);
    } else if (d.stage === 'converting') {
      // Complete prior stages and activate process, but don't set a fake
      // initial value — real ffmpeg progress events will fill it from 0.
      progressBar.completePriorAndActivate('process');
    } else {
      const barStage = SSE_TO_BAR_STAGE[d.stage];
      if (barStage) progressBar.advanceToStage(barStage);
    }
  });

  es.addEventListener('metadata', e => {
    setImportUiState(IMPORT_UI_STATE.LOADING);
    const d = JSON.parse(e.data);
    completedTitle = d.name || d.title || 'track';
    setText(titleEl, completedTitle);
    if (d.total_tracks > 1) {
      es.close();
      view.restoreInputs();
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
    progressBar.advanceToStage('resolve');
    progressBar.completeStage('resolve');
  });

  es.addEventListener('progress', e => {
    const d = JSON.parse(e.data);
    const seg = SSE_TO_BAR_STAGE[d.stage] || 'download';
    progressBar.setStageProgress(seg, d.percent);
  });

  es.addEventListener('complete', async e => {
    es.close();
    const d = JSON.parse(e.data);
    const file = d.file || completedFile;
    progressBar.completeStage('process');
    setImportStage('Loading into studio…');
    setTimeout(() => {
      progressBar.advanceToStage('load');
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
          progressBar.setStageProgress('load', Math.round((received / contentLength) * 100));
        } else {
          unknownLenProgress = Math.min(92, unknownLenProgress + 6);
          progressBar.setStageProgress('load', unknownLenProgress);
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
      progressBar.completeStage('load');
      await new Promise(resolve => setTimeout(resolve, 220));
      urlInput.value = '';
      view.hideStatus();
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
