import { state } from './state.js';
import { makeIR } from './audio.js';
import { buildID3Tag } from './id3.js';
import { getExportSuffix } from './utils.js';
import { $id, toggleClass } from './dom.js';

const EXPORT_COMPLETE_DISPLAY_MS = 2800;
const EXPORT_MESSAGE_DISPLAY_MS = 1800;

let activeExport = null;
let hideToastTimer = null;

function abortError() {
  return new DOMException('Export cancelled', 'AbortError');
}

function throwIfAborted(signal) {
  if (signal.aborted) throw abortError();
}

function waitForAbort(signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    signal.addEventListener('abort', () => reject(abortError()), { once: true });
  });
}

function snapshotExport(filename) {
  if (!state.audioBuffer) throw new Error('No track is loaded');

  return {
    audioBuffer: state.audioBuffer,
    speed: state.speed,
    reverbMix: state.reverbMix,
    reverbDecay: state.reverbDecay,
    title: state.title,
    artist: state.artist,
    artBytes: state.artBytes ? new Uint8Array(state.artBytes) : null,
    artMime: state.artMime,
    filename: filename.toLowerCase().endsWith('.mp3') ? filename : `${filename}.mp3`,
  };
}

function showExportToast(snapshot) {
  clearTimeout(hideToastTimer);
  const toastEl = $id('exportToast');
  toastEl.className = 'export-toast export-toast-running show';
  $id('exportToastFilename').textContent = snapshot.filename;
  $id('exportCancelBtn').hidden = false;
  $id('exportToastPercent').hidden = false;
  $id('exportToastProgress').hidden = false;
  setExportProgress(0, 'Preparing audio…');
}

function scheduleToastHide(delay) {
  clearTimeout(hideToastTimer);
  hideToastTimer = setTimeout(() => {
    $id('exportToast').classList.remove('show');
  }, delay);
}

function setExportProgress(percent, message) {
  const rounded = Math.max(0, Math.min(100, Math.round(percent)));
  $id('exportToastTitle').textContent = message;
  $id('exportToastPercent').textContent = `${rounded}%`;
  $id('exportToastProgressFill').style.width = `${rounded}%`;
  $id('exportToastProgress').setAttribute('aria-valuenow', String(rounded));
  $id('exportToastProgress').setAttribute('aria-valuetext', `${message} ${rounded}%`);
}

function showTerminalState(type, message) {
  const toastEl = $id('exportToast');
  toastEl.className = `export-toast export-toast-${type} show`;
  $id('exportToastTitle').textContent = message;
  $id('exportCancelBtn').hidden = true;

  if (type === 'success') {
    $id('exportToastPercent').textContent = '100%';
    $id('exportToastProgressFill').style.width = '100%';
    $id('exportToastProgress').setAttribute('aria-valuenow', '100');
    scheduleToastHide(EXPORT_COMPLETE_DISPLAY_MS);
    return;
  }

  $id('exportToastPercent').hidden = true;
  $id('exportToastProgress').hidden = true;
  scheduleToastHide(EXPORT_MESSAGE_DISPLAY_MS);
}

function encodeMp3(left, right, sampleRate, job) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./mp3_encoder_worker.js', import.meta.url));
    job.worker = worker;

    const onAbort = () => {
      worker.terminate();
      reject(abortError());
    };

    const cleanUp = () => {
      job.signal.removeEventListener('abort', onAbort);
      if (job.worker === worker) job.worker = null;
    };

    job.signal.addEventListener('abort', onAbort, { once: true });
    worker.onmessage = (event) => {
      if (event.data.type === 'progress') {
        setExportProgress(42 + (event.data.percent * 0.54), 'Encoding MP3…');
        return;
      }

      cleanUp();
      worker.terminate();
      if (event.data.type === 'complete') {
        resolve(new Uint8Array(event.data.mp3Buffer));
      } else {
        reject(new Error(event.data.message || 'MP3 encoding failed'));
      }
    };
    worker.onerror = (event) => {
      cleanUp();
      worker.terminate();
      reject(new Error(event.message || 'MP3 encoding failed'));
    };

    worker.postMessage(
      {
        leftBuffer: left.buffer,
        rightBuffer: right.buffer,
        sampleRate,
      },
      [left.buffer, right.buffer],
    );
  });
}

export function closeModal() {
  toggleClass($id('modalOverlay'), 'open', false);
}

export function isExporting() {
  return activeExport !== null;
}

export function cancelExport() {
  if (!activeExport) return;
  activeExport.controller.abort();
  activeExport.worker?.terminate();
  activeExport.stopSource?.();
}

export async function doExport(filename) {
  if (activeExport) return false;

  let snapshot;
  try {
    snapshot = snapshotExport(filename);
  } catch (error) {
    closeModal();
    return false;
  }

  const controller = new AbortController();
  const job = {
    controller,
    signal: controller.signal,
    worker: null,
    stopSource: null,
  };
  activeExport = job;

  closeModal();
  showExportToast(snapshot);

  try {
    const outputDuration = snapshot.audioBuffer.duration / snapshot.speed;
    const sampleRate = snapshot.audioBuffer.sampleRate;
    const offlineContext = new OfflineAudioContext(
      2,
      Math.ceil(outputDuration * sampleRate),
      sampleRate,
    );

    const source = offlineContext.createBufferSource();
    source.buffer = snapshot.audioBuffer;
    source.playbackRate.value = snapshot.speed;

    const dryGain = offlineContext.createGain();
    const wetGain = offlineContext.createGain();
    const convolver = offlineContext.createConvolver();
    dryGain.gain.value = 1 - snapshot.reverbMix;
    wetGain.gain.value = snapshot.reverbMix;
    convolver.buffer = makeIR(offlineContext, snapshot.reverbDecay);

    source.connect(dryGain);
    source.connect(convolver);
    convolver.connect(wetGain);
    dryGain.connect(offlineContext.destination);
    wetGain.connect(offlineContext.destination);

    job.stopSource = () => {
      try {
        source.stop();
      } catch {
        // The source may already have naturally finished rendering.
      }
    };

    source.start(0);
    setExportProgress(8, 'Rendering effects…');
    const rendered = await Promise.race([
      offlineContext.startRendering(),
      waitForAbort(job.signal),
    ]);
    throwIfAborted(job.signal);
    job.stopSource = null;
    setExportProgress(42, 'Encoding MP3…');

    const left = rendered.getChannelData(0).slice();
    const right = rendered.numberOfChannels > 1
      ? rendered.getChannelData(1).slice()
      : left.slice();
    const mp3 = await encodeMp3(left, right, sampleRate, job);
    throwIfAborted(job.signal);

    setExportProgress(97, 'Finishing download…');
    const id3Tag = buildID3Tag(
      snapshot.title + getExportSuffix(snapshot.speed, snapshot.reverbMix),
      snapshot.artist,
      snapshot.artBytes,
      snapshot.artMime,
    );
    const final = new Uint8Array(id3Tag.length + mp3.length);
    final.set(id3Tag, 0);
    final.set(mp3, id3Tag.length);

    throwIfAborted(job.signal);
    const blobUrl = URL.createObjectURL(new Blob([final], { type: 'audio/mpeg' }));
    const downloadLink = document.createElement('a');
    downloadLink.href = blobUrl;
    downloadLink.download = snapshot.filename;
    downloadLink.click();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);

    setExportProgress(100, 'Download ready');
    showTerminalState('success', 'Download ready');
    return true;
  } catch (error) {
    if (error?.name === 'AbortError') {
      showTerminalState('cancelled', 'Download cancelled');
      return false;
    }

    console.error(error);
    showTerminalState('error', `Export failed: ${error.message}`);
    return false;
  } finally {
    if (activeExport === job) activeExport = null;
    job.worker?.terminate();
  }
}
