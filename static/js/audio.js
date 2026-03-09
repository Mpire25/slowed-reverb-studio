import { state } from './state.js';
import {
  beginBottomVisualizerFade,
  clearBottomVisualizerFade,
  updateBottomVisualizerPlaybackState,
  startAnimLoop,
} from './visualizer.js';
import { $id } from './dom.js';

function safeDisconnect(node) {
  if (!node) return;
  try { node.disconnect(); } catch (e) {}
}

export function stopActiveSource({ stopPlayback = true } = {}) {
  if (!state.source) return;
  const source = state.source;
  state.source = null;
  try { source.onended = null; } catch (e) {}
  if (stopPlayback) {
    try { source.stop(); } catch (e) {}
  }
  safeDisconnect(source);
}

export function resetAudioNodes() {
  const keys = ['convolver', 'dryGain', 'wetGain', 'masterGain', 'analyser'];
  for (const key of keys) {
    safeDisconnect(state[key]);
    state[key] = null;
  }
}

export function getCtx() {
  if (!state.audioCtx) {
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return state.audioCtx;
}

export function makeIR(ctx, decay) {
  const sampleRate = ctx.sampleRate;
  const len = Math.ceil(sampleRate * decay);
  const ir = ctx.createBuffer(2, len, sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.5 + decay * 0.1);
    }
  }
  return ir;
}

export function buildPipeline(ctx) {
  safeDisconnect(state.source);
  resetAudioNodes();

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  const dryGain = ctx.createGain();
  const wetGain = ctx.createGain();
  const convolver = ctx.createConvolver();
  const masterGain = ctx.createGain();

  dryGain.gain.value = 1 - state.reverbMix;
  wetGain.gain.value = state.reverbMix;
  convolver.buffer = makeIR(ctx, state.reverbDecay);
  masterGain.gain.value = state.muted ? 0 : state.volume;

  dryGain.connect(analyser);
  convolver.connect(wetGain);
  wetGain.connect(analyser);
  analyser.connect(masterGain);
  masterGain.connect(ctx.destination);

  state.analyser = analyser;
  state.dryGain = dryGain;
  state.wetGain = wetGain;
  state.convolver = convolver;
  state.masterGain = masterGain;
}

function createSource(ctx, offset) {
  stopActiveSource();
  const src = ctx.createBufferSource();
  src.buffer = state.audioBuffer;
  src.playbackRate.value = state.speed;
  src.loop = state.loopEnabled;
  src.connect(state.dryGain);
  src.connect(state.convolver);
  src.onended = () => {
    if (state.source !== src) return;
    if (state.playing) {
      state.playing = false;
      state.pausedAt = 0;
      state.source = null;
      beginBottomVisualizerFade();
      updatePlayBtn();
      updateBottomVisualizerPlaybackState();
    }
  };
  state.source = src;
  src.start(0, offset);
  state.startTime = ctx.currentTime - offset / state.speed;
  state.playing = true;
  updateBottomVisualizerPlaybackState();
}

export function currentPosition() {
  if (!state.playing || !state.audioCtx) return state.pausedAt;
  if (!state.duration) return 0;
  const elapsed = (state.audioCtx.currentTime - state.startTime) * state.speed;
  if (state.loopEnabled) return elapsed % state.duration;
  return Math.min(elapsed, state.duration);
}

export function play() {
  const ctx = getCtx();
  if (ctx.state === 'suspended') ctx.resume();
  clearBottomVisualizerFade();
  buildPipeline(ctx);
  createSource(ctx, state.pausedAt);
  updatePlayBtn();
  startAnimLoop();
}

export function pause() {
  if (!state.source) return;
  state.pausedAt = currentPosition();
  state.playing = false;
  beginBottomVisualizerFade();
  updatePlayBtn();
  stopActiveSource();
  updateBottomVisualizerPlaybackState();
}

export function seekTo(fraction) {
  const offset = fraction * state.duration;
  state.pausedAt = offset;
  if (state.playing) {
    const ctx = getCtx();
    buildPipeline(ctx);
    createSource(ctx, offset);
  }
}

export function applyEffects() {
  if (!state.playing || !state.dryGain) return;
  state.dryGain.gain.value = 1 - state.reverbMix;
  state.wetGain.gain.value = state.reverbMix;
}

export function applyVolume() {
  if (!state.masterGain) return;
  state.masterGain.gain.value = state.muted ? 0 : state.volume;
}

export function updateMuteBtn() {
  const btn = $id('muteBtn');
  if (!btn) return;
  const muted = state.muted || state.volume === 0;
  btn.setAttribute('aria-pressed', muted ? 'true' : 'false');
  btn.title = muted ? 'Unmute' : 'Mute';
  btn.innerHTML = muted
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor" stroke="none"/>
        <line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>
       </svg>`
    : state.volume < 0.4
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor" stroke="none"/>
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
       </svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor" stroke="none"/>
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
       </svg>`;
}

export function rebuildPlayback() {
  if (!state.audioBuffer) return;
  if (state.playing) {
    const offset = currentPosition();
    state.pausedAt = offset;
    const ctx = getCtx();
    buildPipeline(ctx);
    createSource(ctx, offset);
  }
}

export function updatePlayBtn() {
  const icon = $id('playIcon');
  if (state.playing) {
    icon.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
  } else {
    icon.innerHTML = '<polygon points="5,3 19,12 5,21"/>';
  }
}

export function updateLoopBtn() {
  const btn = $id('loopBtn');
  btn.classList.toggle('active', state.loopEnabled);
  btn.setAttribute('aria-pressed', state.loopEnabled ? 'true' : 'false');
}

export async function loadAudioBuffer(arrayBuffer) {
  const ctx = getCtx();
  if (ctx.state === 'suspended') ctx.resume();
  const buf = await ctx.decodeAudioData(arrayBuffer.slice(0));
  return buf;
}
