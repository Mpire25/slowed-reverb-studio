export const DEFAULT_THEME = {
  h1: 262, s1: 84, l1: 58,
  h2: 190, s2: 89, l2: 43,
};

export const state = {
  audioCtx: null,
  audioBuffer: null,
  source: null,
  analyser: null,
  dryGain: null,
  wetGain: null,
  convolver: null,
  merger: null,
  startTime: 0,       // audioCtx.currentTime when playback started
  pausedAt: 0,        // seconds into track when paused
  playing: false,
  speed: 0.75,
  reverbMix: 0.40,
  reverbDecay: 3.0,
  loopEnabled: false,
  title: 'Unknown Title',
  artist: 'Unknown Artist',
  sourceSpotifyUrl: null,
  sourceYouTubeUrl: null,
  artBlob: null,      // Blob URL for album art
  artBytes: null,     // raw APIC bytes for re-embedding
  artMime: 'image/jpeg',
  duration: 0,
  waveformData: null,
  animFrame: null,
  serverOnline: false,
  visualizerEnabled: true,
  visualizerFreqData: null,
  visualizerBarData: null,
  visualizerTimeData: null,
  visualizerLoudness: 0,
  visualizerFadeOutUntil: 0,
  visualizerFadeBars: null,
  visualizerFadeLoudness: 0,
  themeCurrent: { ...DEFAULT_THEME },
  themeTarget: { ...DEFAULT_THEME },
  themeAnimFrame: null,
  themeRequestId: 0,
};

export const settings = {
  defaultSpeed: 0.75,
  defaultReverb: 40,
  defaultDecay: 3,
  loopEnabled: false,
  visualizerEnabled: true,
  artThemeEnabled: false,
};

export const SETTINGS_STORAGE_KEY = 'slowedReverbStudio.settings.v1';
export const MIN_SPEED = 0.5;
export const MAX_SPEED = 1.5;
