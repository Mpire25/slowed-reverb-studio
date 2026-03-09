import { $id, setText } from './dom.js';

export function syncSpeedControls(speed) {
  const slider = $id('speedSlider');
  const label = $id('speedVal');
  if (slider) slider.value = Math.round(speed * 100);
  setText(label, `${speed.toFixed(2)}×`);
}

export function syncReverbControls(mix) {
  const slider = $id('reverbSlider');
  const pct = Math.round(mix * 100);
  const label = $id('reverbVal');
  if (slider) slider.value = pct;
  setText(label, `${pct}%`);
}

export function syncDecayControls(decay) {
  const slider = $id('decaySlider');
  const label = $id('decayVal');
  if (slider) slider.value = Math.round(decay * 10);
  setText(label, `${decay.toFixed(1)}s`);
}

export function syncLoopButtonTitle(loopEnabled) {
  const btn = $id('loopBtn');
  if (!btn) return;
  btn.title = loopEnabled ? 'Loop On' : 'Loop Off';
}
