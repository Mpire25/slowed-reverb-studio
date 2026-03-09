import { state, settings, SETTINGS_STORAGE_KEY } from './state.js';
import { clampSpeed } from './utils.js';
import { setThemeCss } from './theme.js';
import { $id } from './dom.js';
import {
  syncSpeedControls,
  syncReverbControls,
  syncDecayControls,
  syncLoopButtonTitle,
} from './controls.js';
import {
  updateBottomVisualizerVisibility,
  updateBottomVisualizerPlaybackState,
  drawBottomVisualizer,
} from './visualizer.js';
import { updateLoopBtn } from './audio.js';

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;
    if (Number.isFinite(parsed.defaultSpeed)) settings.defaultSpeed = clampSpeed(parsed.defaultSpeed);
    if (Number.isFinite(parsed.defaultReverb)) settings.defaultReverb = parsed.defaultReverb;
    if (Number.isFinite(parsed.defaultDecay)) settings.defaultDecay = parsed.defaultDecay;
    if (typeof parsed.loopEnabled === 'boolean') settings.loopEnabled = parsed.loopEnabled;
    if (typeof parsed.visualizerEnabled === 'boolean') settings.visualizerEnabled = parsed.visualizerEnabled;
    if (typeof parsed.artThemeEnabled === 'boolean') settings.artThemeEnabled = parsed.artThemeEnabled;
  } catch (err) {
    console.warn('Failed to load settings from localStorage', err);
  }
}

export function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn('Failed to save settings to localStorage', err);
  }
}

export function syncSettingsUI() {
  $id('defaultSpeed').value = settings.defaultSpeed;
  $id('defaultReverb').value = settings.defaultReverb;
  $id('defaultDecay').value = settings.defaultDecay;
  $id('bottomVisualizerToggle').checked = settings.visualizerEnabled;
  $id('artThemeToggle').checked = settings.artThemeEnabled;

  settings.defaultSpeed = clampSpeed(settings.defaultSpeed);
  state.speed = settings.defaultSpeed;
  state.reverbMix = settings.defaultReverb / 100;
  state.reverbDecay = settings.defaultDecay;
  state.loopEnabled = settings.loopEnabled;
  state.visualizerEnabled = settings.visualizerEnabled;
  setThemeCss(state.themeCurrent);

  syncSpeedControls(state.speed);
  syncReverbControls(state.reverbMix);
  syncDecayControls(state.reverbDecay);
  updateLoopBtn();
  syncLoopButtonTitle(state.loopEnabled);
  updateBottomVisualizerVisibility();
  updateBottomVisualizerPlaybackState();
  drawBottomVisualizer(!state.playing);
}
