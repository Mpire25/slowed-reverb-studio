import { state, MIN_SPEED, MAX_SPEED } from './state.js';
import { drawWaveform } from './waveform.js';
import { fmt } from './utils.js';
import { $id, setText } from './dom.js';

export const VISUALIZER_FADE_OUT_MS = 420;
export const VISUALIZER_FADE_CURVE = 1.45;

export function isBottomVisualizerFading() {
  return !state.playing &&
    state.visualizerFadeOutUntil > performance.now() &&
    !!state.visualizerFadeBars &&
    state.visualizerFadeBars.length > 0;
}

export function clearBottomVisualizerFade() {
  state.visualizerFadeOutUntil = 0;
  state.visualizerFadeBars = null;
  state.visualizerFadeLoudness = 0;
}

export function beginBottomVisualizerFade() {
  if (!state.visualizerEnabled || !state.audioBuffer || !state.visualizerBarData || state.visualizerBarData.length === 0) {
    clearBottomVisualizerFade();
    updateBottomVisualizerPlaybackState();
    return;
  }
  state.visualizerFadeBars = new Float32Array(state.visualizerBarData);
  state.visualizerFadeLoudness = state.visualizerLoudness;
  state.visualizerFadeOutUntil = performance.now() + VISUALIZER_FADE_OUT_MS;
  updateBottomVisualizerPlaybackState();
  startAnimLoop();
}

export function updateBottomVisualizerVisibility() {
  const canvas = $id('bottomVisualizer');
  canvas.classList.toggle('off', !state.visualizerEnabled);
}

export function updateBottomVisualizerPlaybackState() {
  const canvas = $id('bottomVisualizer');
  const active = state.visualizerEnabled && !!state.audioBuffer;
  canvas.classList.toggle('active', active);
}

const VISUALIZER_TUNING = {
  smoothing: 0.52,
  ampA: 0.36,
  ampB: 0.32,
  ampC: 0.26,
  waveHeightPx: 170,
  baseOffsetA: 24,
  baseOffsetB: 37,
  baseOffsetC: 49,
  driftBase: 5,
  driftBassBoost: 16,
  driftMidBoost: 8,
};

export function drawBottomVisualizer(clearOnly = false) {
  const canvas = $id('bottomVisualizer');
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth;
  const H = canvas.offsetHeight;
  if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
    canvas.width = W * dpr;
    canvas.height = H * dpr;
  }

  const ctx2d = canvas.getContext('2d');
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx2d.clearRect(0, 0, W, H);

  if (clearOnly || !state.visualizerEnabled) {
    ctx2d.setTransform(1, 0, 0, 1, 0, 0);
    return;
  }

  const fading = isBottomVisualizerFading();

  const pointCount = Math.max(22, Math.floor(W / 26));
  if (!state.visualizerBarData || state.visualizerBarData.length !== pointCount) {
    state.visualizerBarData = new Float32Array(pointCount);
  }
  function getEnergyFromBars(startPct, endPct) {
    if (!state.visualizerBarData || state.visualizerBarData.length === 0) return 0;
    const start = Math.max(0, Math.floor(pointCount * startPct));
    const end = Math.max(start + 1, Math.floor(pointCount * endPct));
    let sum = 0;
    for (let i = start; i < end; i++) sum += state.visualizerBarData[i] || 0;
    return sum / (end - start);
  }

  let bass = 0;
  let lowMid = 0;
  let high = 0;
  let loudness = 0;

  if (state.playing && state.analyser) {
    const analyser = state.analyser;
    const binCount = analyser.frequencyBinCount;
    if (!state.visualizerFreqData || state.visualizerFreqData.length !== binCount) {
      state.visualizerFreqData = new Uint8Array(binCount);
    }
    if (!state.visualizerTimeData || state.visualizerTimeData.length !== analyser.fftSize) {
      state.visualizerTimeData = new Uint8Array(analyser.fftSize);
    }
    analyser.getByteFrequencyData(state.visualizerFreqData);
    analyser.getByteTimeDomainData(state.visualizerTimeData);

    let rmsSum = 0;
    for (let i = 0; i < state.visualizerTimeData.length; i += 2) {
      const sample = (state.visualizerTimeData[i] - 128) / 128;
      rmsSum += sample * sample;
    }
    const rms = Math.sqrt(rmsSum / (state.visualizerTimeData.length / 2));
    const loudnessNow = Math.min(1, rms * 4.5);
    state.visualizerLoudness = state.visualizerLoudness * 0.82 + loudnessNow * 0.18;
    loudness = state.visualizerLoudness;

    const step = Math.max(1, Math.floor(binCount / pointCount));
    for (let i = 0; i < pointCount; i++) {
      const start = i * step;
      let sum = 0;
      for (let j = 0; j < step; j++) sum += state.visualizerFreqData[start + j] || 0;
      const raw = (sum / step) / 255;
      state.visualizerBarData[i] = state.visualizerBarData[i] * VISUALIZER_TUNING.smoothing + raw * (1 - VISUALIZER_TUNING.smoothing);
    }

    function getEnergy(startPct, endPct) {
      const start = Math.max(0, Math.floor(binCount * startPct));
      const end = Math.max(start + 1, Math.floor(binCount * endPct));
      let sum = 0;
      for (let i = start; i < end; i++) sum += state.visualizerFreqData[i] || 0;
      return (sum / (end - start)) / 255;
    }
    bass = getEnergy(0.00, 0.08);
    lowMid = getEnergy(0.08, 0.22);
    high = getEnergy(0.22, 0.55);
  } else if (fading && state.visualizerFadeBars) {
    const nowMs = performance.now();
    const fadeProgress = Math.min(1, Math.max(0, 1 - ((state.visualizerFadeOutUntil - nowMs) / VISUALIZER_FADE_OUT_MS)));
    const fadeGain = Math.pow(1 - fadeProgress, VISUALIZER_FADE_CURVE);
    for (let i = 0; i < pointCount; i++) {
      const sourceIndex = Math.floor((i / pointCount) * state.visualizerFadeBars.length);
      const held = state.visualizerFadeBars[Math.min(state.visualizerFadeBars.length - 1, sourceIndex)] || 0;
      state.visualizerBarData[i] = held * fadeGain;
    }
    loudness = state.visualizerFadeLoudness * fadeGain;
    bass = getEnergyFromBars(0.00, 0.08);
    lowMid = getEnergyFromBars(0.08, 0.22);
    high = getEnergyFromBars(0.22, 0.55);
  }

  const now = Date.now() * 0.001;
  const pulse = Math.min(1, bass * 0.55 + lowMid * 0.3 + high * 0.15);
  const intensity = 0.35 + pulse * 0.45 + loudness * 0.8;
  const speedNorm = (state.speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED);
  const speedNormClamped = Math.min(1, Math.max(0, speedNorm));
  const rotationRate = 0.32 + Math.pow(speedNormClamped, 0.78) * 0.26;
  const hueDrift = now * rotationRate;
  const baseHue1 = state.themeCurrent.h1;
  const baseHue2 = state.themeCurrent.h2;
  const blendHue = (baseHue1 + baseHue2) * 0.5;
  const hueA = baseHue1 + Math.sin(hueDrift) * 18;
  const hueB = baseHue2 + Math.sin(hueDrift + 1.8) * 16;
  const hueC = blendHue + 32 + Math.sin(hueDrift + 3.1) * 12;
  const gradShift = (Math.sin(now * 0.11) * 0.5 + 0.5) * W * 0.17;

  const haze = ctx2d.createLinearGradient(gradShift, H, W - gradShift, 0);
  haze.addColorStop(0, `hsla(${hueA.toFixed(1)},88%,57%,${(0.08 + pulse * 0.16) * intensity})`);
  haze.addColorStop(0.225, `hsla(${hueC.toFixed(1)},86%,64%,${(0.06 + pulse * 0.1) * intensity})`);
  haze.addColorStop(1, `hsla(${hueB.toFixed(1)},92%,56%,0)`);
  ctx2d.fillStyle = haze;
  ctx2d.fillRect(0, 0, W, H);

  const bloomLeft = ctx2d.createRadialGradient(W * 0.18, H * 0.9, 0, W * 0.18, H * 0.9, W * 0.42);
  bloomLeft.addColorStop(0, `hsla(${hueA.toFixed(1)},90%,60%,${(0.12 + bass * 0.28) * intensity})`);
  bloomLeft.addColorStop(1, `hsla(${hueA.toFixed(1)},90%,60%,0)`);
  ctx2d.fillStyle = bloomLeft;
  ctx2d.fillRect(0, 0, W, H);

  const bloomRight = ctx2d.createRadialGradient(W * 0.84, H * 0.88, 0, W * 0.84, H * 0.88, W * 0.44);
  bloomRight.addColorStop(0, `hsla(${hueB.toFixed(1)},94%,55%,${(0.12 + high * 0.22) * intensity})`);
  bloomRight.addColorStop(1, `hsla(${hueB.toFixed(1)},94%,55%,0)`);
  ctx2d.fillStyle = bloomRight;
  ctx2d.fillRect(0, 0, W, H);

  function drawWave(yBase, ampScale, colorA, colorB, alpha, lineW, speed, freq) {
    const xShift = (Math.sin(now * (0.06 + speed * 0.02)) * 0.5 + 0.5) * W * 0.28;
    const grad = ctx2d.createLinearGradient(xShift, H, W - xShift * 0.35, 0);
    grad.addColorStop(0, colorA);
    grad.addColorStop(1, colorB);
    ctx2d.strokeStyle = grad;
    ctx2d.lineWidth = lineW;
    ctx2d.lineCap = 'round';
    ctx2d.lineJoin = 'round';
    ctx2d.globalAlpha = alpha;
    ctx2d.beginPath();
    let firstY = yBase;
    for (let i = 0; i < pointCount; i++) {
      const t = i / (pointCount - 1);
      const x = t * W;
      const amp = Math.pow(state.visualizerBarData[i], 1.2) * (VISUALIZER_TUNING.waveHeightPx * ampScale);
      const drift = Math.sin(now * speed + t * freq) *
        (VISUALIZER_TUNING.driftBase + bass * VISUALIZER_TUNING.driftBassBoost + lowMid * VISUALIZER_TUNING.driftMidBoost);
      const y = yBase - amp - drift;
      if (i === 0) {
        firstY = y;
        ctx2d.moveTo(x, y);
      }
      else {
        const prevT = (i - 1) / (pointCount - 1);
        const prevX = prevT * W;
        const cx = (prevX + x) * 0.5;
        const prevAmp = Math.pow(state.visualizerBarData[i - 1], 1.2) * (VISUALIZER_TUNING.waveHeightPx * ampScale);
        const prevDrift = Math.sin(now * speed + prevT * freq) *
          (VISUALIZER_TUNING.driftBase + bass * VISUALIZER_TUNING.driftBassBoost + lowMid * VISUALIZER_TUNING.driftMidBoost);
        const prevY = yBase - prevAmp - prevDrift;
        ctx2d.quadraticCurveTo(prevX, prevY, cx, (prevY + y) * 0.5);
      }
    }
    ctx2d.lineTo(W, firstY);
    ctx2d.stroke();
  }

  const waveSpeedMult = state.speed || 1;
  ctx2d.shadowBlur = 24;
  ctx2d.shadowColor = 'rgba(124,58,237,0.2)';
  drawWave(H - VISUALIZER_TUNING.baseOffsetA, VISUALIZER_TUNING.ampA, `hsla(${hueA.toFixed(1)},90%,60%,0.62)`, `hsla(${hueB.toFixed(1)},92%,56%,0.54)`, 0.34 + loudness * 0.9, 18, 1.2 * waveSpeedMult, 8.8);
  drawWave(H - VISUALIZER_TUNING.baseOffsetB, VISUALIZER_TUNING.ampB, `hsla(${hueC.toFixed(1)},88%,68%,0.52)`, `hsla(${hueB.toFixed(1)},94%,62%,0.48)`, 0.28 + loudness * 0.7, 14, 1.55 * waveSpeedMult, 10.2);
  ctx2d.shadowBlur = 0;
  drawWave(H - VISUALIZER_TUNING.baseOffsetC, VISUALIZER_TUNING.ampC, `hsla(${hueA.toFixed(1)},76%,80%,0.42)`, `hsla(${hueB.toFixed(1)},86%,76%,0.36)`, 0.24 + loudness * 0.5, 10, 1.8 * waveSpeedMult, 11.4);

  if (!state.playing && performance.now() >= state.visualizerFadeOutUntil) {
    clearBottomVisualizerFade();
  }

  ctx2d.globalAlpha = 1;
  ctx2d.setTransform(1,0,0,1,0,0);
}

export function updateTimeDisplay() {
  // Compute displayPosition and displayDuration directly from state to avoid
  // importing audio.js (which would create a circular dependency).
  const rawPos = (!state.playing || !state.audioCtx)
    ? state.pausedAt
    : state.loopEnabled
      ? ((state.audioCtx.currentTime - state.startTime) * state.speed) % state.duration
      : Math.min((state.audioCtx.currentTime - state.startTime) * state.speed, state.duration);
  const dispPos = state.speed ? rawPos / state.speed : 0;
  const dispDur = (state.duration && state.speed) ? state.duration / state.speed : 0;
  setText($id('timeDisplay'), `${fmt(dispPos)} / ${fmt(dispDur)}`);
}

export function startAnimLoop() {
  if (state.animFrame) cancelAnimationFrame(state.animFrame);
  function loop() {
    drawWaveform();
    drawBottomVisualizer();
    updateTimeDisplay();
    if (state.playing || isBottomVisualizerFading()) {
      state.animFrame = requestAnimationFrame(loop);
    }
  }
  state.animFrame = requestAnimationFrame(loop);
}
