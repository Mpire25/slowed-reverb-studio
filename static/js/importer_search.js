import { SERVER } from './config.js';
import { SPINNER_HTML, setDisplay } from './dom.js';

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function initImporterSearch({ searchModeEl, searchInputEl, resultsEl, onSelect }) {
  let searchTimer = null;
  let searchAbort = null;

  searchInputEl.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = searchInputEl.value.trim();
    if (!q) {
      setDisplay(resultsEl, 'none');
      resultsEl.innerHTML = '';
      return;
    }
    searchTimer = setTimeout(() => runSearch(q), 320);
  });

  searchInputEl.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      setDisplay(resultsEl, 'none');
      resultsEl.innerHTML = '';
    }
  });

  document.addEventListener('click', e => {
    if (!searchModeEl.contains(e.target)) {
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
        searchInputEl.value = '';
        searchInputEl.disabled = true;
        onSelect({
          url: `https://music.youtube.com/watch?v=${item.videoId}`,
          prefill: {
            title: item.title,
            artist: item.artist,
            thumbnail: item.thumbnail,
          },
        });
      });
      resultsEl.appendChild(el);
    }
  }
}
