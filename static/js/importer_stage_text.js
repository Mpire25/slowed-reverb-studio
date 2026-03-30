import { setText } from './dom.js';

export function createStageTextUpdater(stageEl, delayMs = 120) {
  let stageSwapTimer = null;

  function set(text) {
    clearTimeout(stageSwapTimer);
    stageEl.classList.add('updating');
    stageSwapTimer = setTimeout(() => {
      setText(stageEl, text || '');
      stageEl.classList.remove('updating');
    }, delayMs);
  }

  function clear() {
    clearTimeout(stageSwapTimer);
    stageSwapTimer = null;
    stageEl.classList.remove('updating');
  }

  return { set, clear };
}
