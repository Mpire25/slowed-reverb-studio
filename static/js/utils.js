import { state, MIN_SPEED, MAX_SPEED } from './state.js';
import { $id } from './dom.js';

export function clampSpeed(speed) {
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed));
}

export function getExportSuffix(speed = state.speed, mix = state.reverbMix) {
  const EPSILON = 0.001;
  const parts = [];
  if (speed > 1 + EPSILON) parts.push('Sped Up');
  else if (speed < 1 - EPSILON) parts.push('Slowed');
  if (mix > EPSILON) parts.push('Reverb');
  return parts.length ? ` (${parts.join(' and ')})` : '';
}

export function clampVal(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export function fmt(s) {
  s = Math.max(0, s | 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function sanitize(s) {
  return s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim() || 'track';
}

export function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function toast(msg, ms = 3000, type = 'info') {
  const el = $id('toast');
  el.textContent = msg;
  el.className = `toast toast-${type} show`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), ms);
}
