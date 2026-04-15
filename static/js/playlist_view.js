import { fmt, escapeHtml } from './utils.js';
import { $id } from './dom.js';

function _makeTrackRow(track, onJumpToTrack) {
  const row = document.createElement('div');
  row.className = 'pl-row';
  row.id = `pl-row-${track.index}`;
  row.dataset.index = track.index;
  const dur = track.duration_ms > 0 ? fmt(track.duration_ms / 1000) : '–';
  row.innerHTML = `
    <span class="pl-row-num">${track.index + 1}</span>
    <div class="pl-row-art">
      ${track.image_url ? `<img src="${escapeHtml(track.image_url)}" loading="lazy" alt="">` : '<span class="pl-row-art-placeholder">♪</span>'}
    </div>
    <div class="pl-row-info">
      <div class="pl-row-title">${escapeHtml(track.name)}</div>
      <div class="pl-row-artist">${escapeHtml(track.artist)}</div>
    </div>
    <span class="pl-row-dur">${dur}</span>
    <span class="pl-row-status" id="pl-status-${track.index}"></span>
  `;
  row.addEventListener('click', () => onJumpToTrack(track.index));
  return row;
}

export function createPlaylistView({ onJumpToTrack, onToggleLoop }) {
  let panelHeightObserver = null;

  function syncPanelHeightToApp() {
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

  function startPanelHeightSync() {
    stopPanelHeightSync();
    syncPanelHeightToApp();
    window.addEventListener('resize', syncPanelHeightToApp);

    if (typeof ResizeObserver !== 'undefined') {
      const app = document.querySelector('.app');
      if (app) {
        panelHeightObserver = new ResizeObserver(syncPanelHeightToApp);
        panelHeightObserver.observe(app);
      }
    }
  }

  function stopPanelHeightSync() {
    window.removeEventListener('resize', syncPanelHeightToApp);
    if (panelHeightObserver) {
      panelHeightObserver.disconnect();
      panelHeightObserver = null;
    }

    const panel = $id('playlistPanel');
    if (panel) panel.style.height = '';
  }

  function closeVizFsOverlay() {
    const overlay = $id('vizFsPlaylistOverlay');
    if (overlay) overlay.classList.remove('open');
  }

  function openVizFsOverlay() {
    const overlay = $id('vizFsPlaylistOverlay');
    if (!overlay) return;
    overlay.classList.add('open');
    const mainList = $id('playlistTrackList');
    const fsList = $id('vizFsPlaylistList');
    if (mainList && fsList) {
      fsList.innerHTML = '';
      for (const row of mainList.querySelectorAll('.pl-row')) {
        const clone = row.cloneNode(true);
        clone.removeAttribute('id');
        clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
        fsList.appendChild(clone);
      }
    }
    if (!fsList) return;
    fsList.querySelectorAll('.pl-row').forEach(row => {
      row.addEventListener('click', () => {
        closeVizFsOverlay();
        onJumpToTrack(parseInt(row.dataset.index, 10));
      });
    });
  }

  function closeMobileOverlay() {
    const overlay = $id('playlistMobileOverlay');
    if (overlay) overlay.classList.remove('open');
  }

  function openMobileOverlay() {
    const overlay = $id('playlistMobileOverlay');
    if (!overlay) return;
    overlay.classList.add('open');
    // Sync the mobile list from the main list without duplicating IDs.
    // Duplicate IDs can break global lookups used by status updates.
    const mainList = $id('playlistTrackList');
    const mobileList = $id('playlistMobileTrackList');
    if (mainList && mobileList) {
      mobileList.innerHTML = '';
      for (const row of mainList.querySelectorAll('.pl-row')) {
        const clone = row.cloneNode(true);
        clone.removeAttribute('id');
        clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
        mobileList.appendChild(clone);
      }
    }
    if (!mobileList) return;
    // Re-attach click handlers to mobile rows
    mobileList.querySelectorAll('.pl-row').forEach(row => {
      row.addEventListener('click', () => {
        closeMobileOverlay();
        onJumpToTrack(parseInt(row.dataset.index, 10));
      });
    });
  }

  function setLoopEnabled(loopEnabled) {
    const btn = $id('playlistLoopBtn');
    if (!btn) return;
    btn.classList.toggle('active', loopEnabled);
    btn.setAttribute('aria-pressed', loopEnabled ? 'true' : 'false');
    btn.title = loopEnabled ? 'Loop Playlist On' : 'Loop Playlist Off';
  }

  function setCurrentRow(prevIndex, nextIndex) {
    if (prevIndex >= 0) {
      const prevRow = $id(`pl-row-${prevIndex}`);
      if (prevRow) prevRow.classList.remove('is-playing');
    }
    const curRow = $id(`pl-row-${nextIndex}`);
    if (curRow) {
      curRow.classList.add('is-playing');
      curRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function syncMobileBar(tracks, currentIndex) {
    const barTrack = $id('playlistMobileBarTrack');
    const barCount = $id('playlistMobileBarCount');
    if (!barTrack || !barCount) return;
    const cur = tracks[currentIndex];
    if (cur) {
      barTrack.textContent = cur.name;
      barCount.textContent = `${currentIndex + 1} / ${tracks.length}`;
    }
  }

  function renderTrackList(tracks) {
    const list = $id('playlistTrackList');
    if (!list) return;
    list.innerHTML = '';
    for (const track of tracks) {
      list.appendChild(_makeTrackRow(track, onJumpToTrack));
    }
  }

  function updateRowStatus(index, track, currentIndex) {
    const statusEl = $id(`pl-status-${index}`);
    if (!statusEl) return;

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
      if (index === currentIndex) {
        row.classList.add('is-playing');
      } else {
        row.classList.remove('is-playing');
      }
    }
  }

  function openPanel(name, count, loopEnabled, sourceLinks = null) {
    const nameEl = $id('playlistSidebarName');
    const countEl = $id('playlistSidebarCount');
    const mobileNameEl = $id('playlistMobileOverlayName');
    const loopBtn = $id('playlistLoopBtn');
    const spotifyLinkEl = $id('playlistSidebarLink');
    const youtubeLinkEl = $id('playlistSidebarYouTubeLink');
    const countStr = `${count} track${count !== 1 ? 's' : ''}`;
    if (nameEl) nameEl.textContent = name;
    if (countEl) countEl.textContent = countStr;
    if (mobileNameEl) mobileNameEl.textContent = name;
    if (spotifyLinkEl) {
      const spotifyUrl = sourceLinks?.spotify || null;
      if (spotifyUrl) {
        spotifyLinkEl.href = spotifyUrl;
        spotifyLinkEl.title = 'Open on Spotify';
        spotifyLinkEl.setAttribute('aria-label', 'Open on Spotify');
        spotifyLinkEl.classList.remove('hidden');
      } else {
        spotifyLinkEl.href = '#';
        spotifyLinkEl.classList.add('hidden');
      }
    }
    if (youtubeLinkEl) {
      const youtubeUrl = sourceLinks?.youtube || null;
      if (youtubeUrl) {
        youtubeLinkEl.href = youtubeUrl;
        youtubeLinkEl.title = 'Open on YouTube';
        youtubeLinkEl.setAttribute('aria-label', 'Open on YouTube');
        youtubeLinkEl.classList.remove('hidden');
      } else {
        youtubeLinkEl.href = '#';
        youtubeLinkEl.classList.add('hidden');
      }
    }
    if (loopBtn) loopBtn.onclick = onToggleLoop;
    document.body.classList.add('playlist-open');

    // Update transport button labels to reflect prev/next role
    const startBtn = $id('startBtn');
    const endBtn = $id('endBtn');
    if (startBtn) { startBtn.title = 'Previous Track'; startBtn.setAttribute('aria-label', 'Previous Track'); }
    if (endBtn) { endBtn.title = 'Next Track'; endBtn.setAttribute('aria-label', 'Next Track'); }

    // Mobile bar/overlay wiring
    const mobileBtn = $id('playlistMobileBarBtn');
    const mobileClose = $id('playlistMobileOverlayClose');
    if (mobileBtn) mobileBtn.onclick = openMobileOverlay;
    if (mobileClose) mobileClose.onclick = closeMobileOverlay;

    // Fullscreen playlist overlay wiring
    const vizFsPlName = $id('vizFsPlName');
    if (vizFsPlName) vizFsPlName.textContent = name;
    const vizFsPlBtn = $id('vizFsPlaylistBtn');
    const vizFsPlClose = $id('vizFsPlaylistClose');
    if (vizFsPlBtn) vizFsPlBtn.onclick = () => {
      const overlay = $id('vizFsPlaylistOverlay');
      if (overlay && overlay.classList.contains('open')) closeVizFsOverlay();
      else openVizFsOverlay();
    };
    if (vizFsPlClose) vizFsPlClose.onclick = closeVizFsOverlay;

    setLoopEnabled(loopEnabled);
    startPanelHeightSync();
  }

  function closePanel() {
    stopPanelHeightSync();
    document.body.classList.remove('playlist-open');
    const loopBtn = $id('playlistLoopBtn');
    const spotifyLinkEl = $id('playlistSidebarLink');
    const youtubeLinkEl = $id('playlistSidebarYouTubeLink');
    if (loopBtn) loopBtn.onclick = null;
    if (spotifyLinkEl) { spotifyLinkEl.href = '#'; spotifyLinkEl.classList.add('hidden'); }
    if (youtubeLinkEl) { youtubeLinkEl.href = '#'; youtubeLinkEl.classList.add('hidden'); }
    const list = $id('playlistTrackList');
    if (list) list.innerHTML = '';
    const mobileList = $id('playlistMobileTrackList');
    if (mobileList) mobileList.innerHTML = '';
    const vizFsList = $id('vizFsPlaylistList');
    if (vizFsList) vizFsList.innerHTML = '';
    closeMobileOverlay();
    closeVizFsOverlay();
    const vizFsPlBtn = $id('vizFsPlaylistBtn');
    const vizFsPlClose = $id('vizFsPlaylistClose');
    if (vizFsPlBtn) vizFsPlBtn.onclick = null;
    if (vizFsPlClose) vizFsPlClose.onclick = null;

    // Restore transport button labels
    const startBtn = $id('startBtn');
    const endBtn = $id('endBtn');
    if (startBtn) { startBtn.title = 'Start'; startBtn.setAttribute('aria-label', 'Start'); }
    if (endBtn) { endBtn.title = 'End'; endBtn.setAttribute('aria-label', 'End'); }
    setLoopEnabled(false);
  }

  return {
    openPanel,
    closePanel,
    renderTrackList,
    updateRowStatus,
    setCurrentRow,
    syncMobileBar,
    setLoopEnabled,
  };
}
