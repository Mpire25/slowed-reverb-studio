// @ts-check

import { setDisplay, setText } from './dom.js';

/**
 * @typedef {object} ImportViewOptions
 * @property {HTMLElement} dropZone
 * @property {HTMLElement} dividerEl
 * @property {HTMLElement} tabsEl
 * @property {HTMLElement} urlModeEl
 * @property {HTMLElement} searchModeEl
 * @property {HTMLInputElement} searchInputEl
 * @property {HTMLButtonElement} loadBtn
 * @property {HTMLInputElement} urlInput
 * @property {HTMLElement} statusEl
 * @property {() => boolean} getSearchActive
 * @property {(next: boolean) => void} setImporting
 */

/**
 * Shared view helpers for importer input/status lifecycle.
 * Kept intentionally small so callers can preserve existing flow behavior.
 * @param {ImportViewOptions} opts
 */
export function createImporterView(opts) {
  function restoreInputs() {
    opts.dropZone.classList.remove('load-hiding', 'ui-disabled');
    opts.dividerEl.classList.remove('load-hiding');
    opts.tabsEl.classList.remove('load-hiding', 'ui-disabled');
    opts.urlModeEl.classList.remove('load-hiding');
    opts.searchModeEl.classList.remove('load-hiding');

    const searchActive = opts.getSearchActive();
    setDisplay(opts.urlModeEl, searchActive ? 'none' : '');
    setDisplay(opts.searchModeEl, searchActive ? '' : 'none');

    opts.loadBtn.disabled = false;
    opts.urlInput.disabled = false;
    opts.searchInputEl.disabled = false;
    opts.setImporting(false);
    setText(opts.loadBtn, 'Load');
  }

  function hideStatus() {
    opts.statusEl.classList.remove('live', 'expanded');
    setTimeout(() => setDisplay(opts.statusEl, 'none'), 350);
  }

  return {
    restoreInputs,
    hideStatus,
  };
}
