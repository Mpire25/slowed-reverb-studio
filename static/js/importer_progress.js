import { $id } from './dom.js';

export const STAGE_MESSAGES = {
  fetching_metadata: 'Finding track…',
  searching: 'Searching YouTube Music…',
  found: null, // handled by `found` event
  downloading: 'Downloading audio…',
  converting: 'Converting to MP3…',
  embedding: 'Adding track info…',
};

export const SSE_TO_BAR_STAGE = {
  fetching_metadata: 'resolve',
  searching: 'resolve',
  found: 'resolve',
  downloading: 'download',
  converting: 'process',
  embedding: 'process',
};

const BAR_STAGES = ['resolve', 'download', 'process', 'load'];

export function createImportProgressBar() {
  let barStageIndex = -1;
  const barStageProgress = Object.create(null);

  function setStageProgress(stageName, pct) {
    const next = Math.max(0, Math.min(100, Number(pct) || 0));
    const current = barStageProgress[stageName] || 0;
    const clamped = Math.max(current, next); // Never let a stage visually move backwards.
    barStageProgress[stageName] = clamped;
    const el = $id('stageFill-' + stageName);
    if (el) el.style.width = clamped + '%';
  }

  function completeStage(stageName) {
    setStageProgress(stageName, 100);
    const seg = $id('stageSeg-' + stageName);
    if (seg) {
      seg.classList.remove('active');
      seg.classList.add('done');
    }
  }

  function setStageActive(stageName) {
    const seg = $id('stageSeg-' + stageName);
    if (seg) seg.classList.add('active');
  }

  function advanceToStage(stageName) {
    const idx = BAR_STAGES.indexOf(stageName);
    if (idx < 0 || idx <= barStageIndex) return;
    // Complete all earlier stages when we advance (e.g. resolve -> download).
    for (let i = Math.max(0, barStageIndex); i < idx; i++) {
      completeStage(BAR_STAGES[i]);
    }
    barStageIndex = idx;
    setStageActive(stageName);
  }

  function completePriorAndActivate(stageName) {
    const idx = BAR_STAGES.indexOf(stageName);
    if (idx < 0) return;
    for (let i = Math.max(0, barStageIndex); i < idx; i++) {
      completeStage(BAR_STAGES[i]);
    }
    barStageIndex = idx;
    setStageActive(stageName);
  }

  function resetStages() {
    barStageIndex = -1;
    BAR_STAGES.forEach(s => {
      barStageProgress[s] = 0;
      const fill = $id('stageFill-' + s);
      const seg = $id('stageSeg-' + s);
      if (fill) fill.style.width = '0%';
      if (seg) seg.classList.remove('active', 'done');
    });
  }

  return {
    setStageProgress,
    completeStage,
    setStageActive,
    advanceToStage,
    completePriorAndActivate,
    resetStages,
  };
}
