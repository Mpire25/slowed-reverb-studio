import { state } from './state.js';

export function buildWaveformData(buffer) {
  const ch = buffer.getChannelData(0);
  const W = 1200;
  const data = new Float32Array(W);
  const step = Math.floor(ch.length / W);
  for (let x = 0; x < W; x++) {
    let max = 0;
    const off = x * step;
    for (let j = 0; j < step; j++) {
      const v = Math.abs(ch[off + j] || 0);
      if (v > max) max = v;
    }
    data[x] = max;
  }
  return data;
}

export function drawWaveform() {
  const canvas = document.getElementById('waveform');
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth, H = canvas.offsetHeight;
  if (canvas.width !== W * dpr) { canvas.width = W * dpr; canvas.height = H * dpr; }
  const ctx2d = canvas.getContext('2d');
  ctx2d.scale(dpr, dpr);

  ctx2d.clearRect(0, 0, W, H);

  if (!state.waveformData) { ctx2d.setTransform(1,0,0,1,0,0); return; }

  const currentPosition = state.duration > 0
    ? ((!state.playing || !state.audioCtx)
      ? state.pausedAt
      : (state.loopEnabled
          ? ((state.audioCtx.currentTime - state.startTime) * state.speed) % state.duration
          : Math.min((state.audioCtx.currentTime - state.startTime) * state.speed, state.duration)))
    : 0;

  const pos = state.duration > 0 ? currentPosition / state.duration : 0;
  const playX = pos * W;

  // Draw bars
  const data = state.waveformData;
  const n = data.length;
  const barW = W / n;

  const { h1, s1, l1 } = state.themeCurrent;
  const playedGrad = ctx2d.createLinearGradient(0, 0, 0, H);
  playedGrad.addColorStop(0,   `hsla(${h1.toFixed(1)}, ${s1.toFixed(1)}%, ${l1.toFixed(1)}%, 0.08)`);
  playedGrad.addColorStop(0.5, `hsla(${h1.toFixed(1)}, ${s1.toFixed(1)}%, ${l1.toFixed(1)}%, 1)`);
  playedGrad.addColorStop(1,   `hsla(${h1.toFixed(1)}, ${s1.toFixed(1)}%, ${l1.toFixed(1)}%, 0.08)`);

  const unplayedGrad = ctx2d.createLinearGradient(0, 0, 0, H);
  unplayedGrad.addColorStop(0,   'rgba(255,255,255,0.02)');
  unplayedGrad.addColorStop(0.5, 'rgba(255,255,255,0.15)');
  unplayedGrad.addColorStop(1,   'rgba(255,255,255,0.02)');

  for (let i = 0; i < n; i++) {
    const x = i * barW;
    const h = Math.max(2, data[i] * H * 0.9);
    const y = (H - h) / 2;
    const frac = x / W;
    ctx2d.fillStyle = frac < pos ? playedGrad : unplayedGrad;
    ctx2d.fillRect(x, y, Math.max(1, barW - 0.5), h);
  }

  // Playhead
  ctx2d.fillStyle = `hsl(${state.themeCurrent.h2.toFixed(1)}, ${state.themeCurrent.s2.toFixed(1)}%, ${state.themeCurrent.l2.toFixed(1)}%)`;
  ctx2d.fillRect(playX - 1, 0, 2, H);

  ctx2d.setTransform(1,0,0,1,0,0);
}
