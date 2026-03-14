import { state, settings, DEFAULT_THEME } from './state.js';
import { clampVal } from './utils.js';

export function hueDistance(a, b) {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

export function lerpHue(a, b, t) {
  const delta = ((b - a + 540) % 360) - 180;
  return (a + delta * t + 360) % 360;
}

export function hslToRgb(h, sPct, lPct) {
  const s = sPct / 100;
  const l = lPct / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (h % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp >= 0 && hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  switch (max) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
    case g: h = ((b - r) / d + 2); break;
    default: h = ((r - g) / d + 4); break;
  }
  return { h: h * 60, s, l };
}

function mixRgb(a, b, t) {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}

export function setThemeCss(theme) {
  const root = document.documentElement;
  root.style.setProperty('--theme1-h', theme.h1.toFixed(2));
  root.style.setProperty('--theme1-s', `${theme.s1.toFixed(2)}%`);
  root.style.setProperty('--theme1-l', `${theme.l1.toFixed(2)}%`);
  root.style.setProperty('--theme2-h', theme.h2.toFixed(2));
  root.style.setProperty('--theme2-s', `${theme.s2.toFixed(2)}%`);
  root.style.setProperty('--theme2-l', `${theme.l2.toFixed(2)}%`);
  const c1 = hslToRgb(theme.h1, theme.s1, theme.l1);
  const c2 = hslToRgb(theme.h2, theme.s2, theme.l2);
  const base = hslToRgb(theme.baseH, theme.baseS, theme.baseL);
  const bg = hslToRgb(theme.baseH, clampVal(theme.baseS * 0.85, 0, 45), clampVal(theme.baseL, 4, 26));
  const card = mixRgb(base, { r: 255, g: 255, b: 255 }, 0.2);
  const panel = mixRgb(base, { r: 255, g: 255, b: 255 }, 0.14);
  const modal = mixRgb(base, { r: 255, g: 255, b: 255 }, 0.18);
  const toast = mixRgb(base, { r: 255, g: 255, b: 255 }, 0.16);
  const search = mixRgb(base, { r: 255, g: 255, b: 255 }, 0.09);
  const surfaceHover = mixRgb(base, { r: 255, g: 255, b: 255 }, 0.26);
  const surfaceSoft = mixRgb(base, { r: 255, g: 255, b: 255 }, 0.18);
  const border = mixRgb(base, { r: 255, g: 255, b: 255 }, 0.28);
  const scrollTrack = mixRgb(base, { r: 255, g: 255, b: 255 }, 0.07);
  const scrollThumbTop = mixRgb(base, { r: 255, g: 255, b: 255 }, 0.15);
  const scrollThumbBottom = mixRgb(base, { r: 0, g: 0, b: 0 }, 0.12);
  const scrollBorder = mixRgb(base, { r: 0, g: 0, b: 0 }, 0.3);

  root.style.setProperty('--accent1-rgb', `${c1.r},${c1.g},${c1.b}`);
  root.style.setProperty('--accent2-rgb', `${c2.r},${c2.g},${c2.b}`);
  root.style.setProperty('--base-rgb', `${base.r},${base.g},${base.b}`);
  root.style.setProperty('--bg', `rgb(${bg.r}, ${bg.g}, ${bg.b})`);
  root.style.setProperty('--card', `rgba(${card.r}, ${card.g}, ${card.b}, 0.2)`);
  root.style.setProperty('--panel-bg', `rgba(${panel.r}, ${panel.g}, ${panel.b}, 0.92)`);
  root.style.setProperty('--modal-bg', `rgba(${modal.r}, ${modal.g}, ${modal.b}, 0.96)`);
  root.style.setProperty('--toast-bg', `rgba(${toast.r}, ${toast.g}, ${toast.b}, 0.95)`);
  root.style.setProperty('--search-bg', `rgba(${search.r}, ${search.g}, ${search.b}, 0.96)`);
  root.style.setProperty('--surface-hover', `rgba(${surfaceHover.r}, ${surfaceHover.g}, ${surfaceHover.b}, 0.24)`);
  root.style.setProperty('--surface-soft', `rgba(${surfaceSoft.r}, ${surfaceSoft.g}, ${surfaceSoft.b}, 0.16)`);
  root.style.setProperty('--border', `rgba(${border.r}, ${border.g}, ${border.b}, 0.3)`);
  root.style.setProperty('--scroll-track', `rgba(${scrollTrack.r}, ${scrollTrack.g}, ${scrollTrack.b}, 0.14)`);
  root.style.setProperty('--scroll-thumb', `linear-gradient(180deg, rgba(${scrollThumbTop.r}, ${scrollThumbTop.g}, ${scrollThumbTop.b}, 0.96), rgba(${scrollThumbBottom.r}, ${scrollThumbBottom.g}, ${scrollThumbBottom.b}, 0.95))`);
  root.style.setProperty('--scroll-thumb-hover', `linear-gradient(180deg, rgba(${surfaceHover.r}, ${surfaceHover.g}, ${surfaceHover.b}, 0.98), rgba(${scrollThumbBottom.r}, ${scrollThumbBottom.g}, ${scrollThumbBottom.b}, 0.96))`);
  root.style.setProperty('--scroll-border', `rgba(${scrollBorder.r}, ${scrollBorder.g}, ${scrollBorder.b}, 0.85)`);
}

export function animateThemeTo(nextTheme, duration = 850) {
  const target = {
    h1: ((nextTheme.h1 % 360) + 360) % 360,
    s1: clampVal(nextTheme.s1, 0, 100),
    l1: clampVal(nextTheme.l1, 20, 80),
    h2: ((nextTheme.h2 % 360) + 360) % 360,
    s2: clampVal(nextTheme.s2, 0, 100),
    l2: clampVal(nextTheme.l2, 20, 80),
    baseH: ((nextTheme.baseH % 360) + 360) % 360,
    baseS: clampVal(nextTheme.baseS, 0, 100),
    baseL: clampVal(nextTheme.baseL, 3, 30),
  };
  state.themeTarget = target;
  if (state.themeAnimFrame) cancelAnimationFrame(state.themeAnimFrame);
  const startTheme = { ...state.themeCurrent };
  const start = performance.now();

  function tick(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    const cur = {
      h1: lerpHue(startTheme.h1, target.h1, eased),
      s1: startTheme.s1 + (target.s1 - startTheme.s1) * eased,
      l1: startTheme.l1 + (target.l1 - startTheme.l1) * eased,
      h2: lerpHue(startTheme.h2, target.h2, eased),
      s2: startTheme.s2 + (target.s2 - startTheme.s2) * eased,
      l2: startTheme.l2 + (target.l2 - startTheme.l2) * eased,
      baseH: lerpHue(startTheme.baseH, target.baseH, eased),
      baseS: startTheme.baseS + (target.baseS - startTheme.baseS) * eased,
      baseL: startTheme.baseL + (target.baseL - startTheme.baseL) * eased,
    };
    state.themeCurrent = cur;
    setThemeCss(cur);
    if (t < 1) state.themeAnimFrame = requestAnimationFrame(tick);
  }

  state.themeAnimFrame = requestAnimationFrame(tick);
}

export async function extractThemeFromArtwork(blobUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const side = 64;
        const canvas = document.createElement('canvas');
        canvas.width = side;
        canvas.height = side;
        const c = canvas.getContext('2d', { willReadFrequently: true });
        c.drawImage(img, 0, 0, side, side);
        const px = c.getImageData(0, 0, side, side).data;
        const bins = Array.from({ length: 36 }, () => ({ w: 0, h: 0, s: 0, l: 0 }));
        let allCount = 0;
        let allSat = 0;
        let allLum = 0;
        let chromaSum = 0;
        let strongSatCount = 0;
        let hueX = 0;
        let hueY = 0;
        let hueWeightSum = 0;

        for (let i = 0; i < px.length; i += 4) {
          const a = px[i + 3];
          if (a < 160) continue;
          const r = px[i];
          const g = px[i + 1];
          const b = px[i + 2];
          const { h, s, l } = rgbToHsl(r, g, b);
          const chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;

          allCount += 1;
          allSat += s;
          allLum += l;
          chromaSum += chroma;
          if (s > 0.18) strongSatCount += 1;

          const hueWeight = Math.max(s, 0.04) * (0.5 + 0.5 * (1 - Math.abs(l - 0.5) * 2));
          hueX += Math.cos((h * Math.PI) / 180) * hueWeight;
          hueY += Math.sin((h * Math.PI) / 180) * hueWeight;
          hueWeightSum += hueWeight;

          if (l < 0.04 || l > 0.96 || s < 0.04) continue;
          const weight = (0.3 + s * 0.9) * (0.45 + 0.55 * (1 - Math.abs(l - 0.5) * 2));
          const bi = Math.floor(h / 10) % 36;
          bins[bi].w += weight;
          bins[bi].h += h * weight;
          bins[bi].s += s * weight;
          bins[bi].l += l * weight;
        }

        if (!allCount) {
          resolve(null);
          return;
        }

        const avgSatAll = allSat / allCount;
        const avgLumAll = allLum / allCount;
        const avgChroma = chromaSum / allCount;
        const strongSatRatio = strongSatCount / allCount;
        const hueVectorMag = hueWeightSum > 0 ? Math.hypot(hueX, hueY) / hueWeightSum : 0;
        const hueVector = (Math.atan2(hueY, hueX) * 180) / Math.PI;
        const baseHueFromStats = ((hueVector % 360) + 360) % 360;

        const lowColorEnergy = avgSatAll < 0.11 || avgChroma < 0.075;
        const sparseColor = strongSatRatio < 0.03;
        const unstableHue = hueVectorMag < 0.16;
        let isMonochrome = lowColorEnergy && (sparseColor || unstableHue);

        let first = -1;
        let firstW = 0;
        for (let i = 0; i < bins.length; i++) {
          if (bins[i].w > firstW) {
            firstW = bins[i].w;
            first = i;
          }
        }
        if (first < 0 || firstW < 0.14) isMonochrome = true;

        const mutedFactor = clampVal(avgSatAll / 0.5, 0, 1);
        const darkFactor = clampVal(avgLumAll / 0.55, 0, 1);
        const sMin = Math.round(26 + mutedFactor * 36);
        const sMax = Math.round(58 + mutedFactor * 38);
        const lMin = Math.round(20 + darkFactor * 13);
        const lMax = Math.round(42 + darkFactor * 22);

        function toneFrom(idx, fallbackHue) {
          const b = bins[idx];
          if (!b || b.w < 0.14) {
            return { h: fallbackHue, s: (sMin + sMax) / 2, l: (lMin + lMax) / 2 };
          }
          return {
            h: ((b.h / b.w) % 360 + 360) % 360,
            s: clampVal((b.s / b.w) * 100, sMin, sMax),
            l: clampVal((b.l / b.w) * 100, lMin, lMax),
          };
        }

        if (isMonochrome) {
          const neutralHue = hueVectorMag > 0.08 ? baseHueFromStats : DEFAULT_THEME.baseH;
          const neutralL = clampVal(46 + (avgLumAll - 0.5) * 22, 38, 62);
          resolve({
            h1: neutralHue,
            s1: 0,
            l1: neutralL,
            h2: (neutralHue + 12) % 360,
            s2: 0,
            l2: clampVal(neutralL - 12, 24, 52),
            baseH: neutralHue,
            baseS: 0,
            baseL: clampVal(6 + avgLumAll * 14, 6, 20),
          });
          return;
        }

        let second = -1;
        let secondW = 0;
        const firstHue = first * 10;
        for (let i = 0; i < bins.length; i++) {
          if (i === first) continue;
          const hue = i * 10;
          if (hueDistance(firstHue, hue) < 30) continue;
          if (bins[i].w > secondW) {
            secondW = bins[i].w;
            second = i;
          }
        }
        if (second < 0) {
          secondW = 0;
          for (let i = 0; i < bins.length; i++) {
            if (i === first) continue;
            if (hueDistance(firstHue, i * 10) < 16) continue;
            if (bins[i].w > secondW) {
              secondW = bins[i].w;
              second = i;
            }
          }
        }
        if (second < 0) second = (first + 3) % 36;

        const aTone = toneFrom(first, first * 10);
        const bTone = toneFrom(second, second * 10);
        const baseHue = hueVectorMag > 0.08 ? baseHueFromStats : aTone.h;
        resolve({
          h1: aTone.h,
          s1: aTone.s,
          l1: aTone.l,
          h2: bTone.h,
          s2: bTone.s,
          l2: bTone.l,
          baseH: baseHue,
          baseS: clampVal(avgSatAll * 52, 10, 42),
          baseL: clampVal(6 + avgLumAll * 13, 6, 22),
        });
      } catch (err) {
        console.warn('Album-art theme extraction failed', err);
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = blobUrl;
  });
}

export async function applyThemeFromCurrentTrack() {
  const reqId = ++state.themeRequestId;
  if (!settings.artThemeEnabled || !state.artBlob) {
    animateThemeTo(DEFAULT_THEME);
    return;
  }
  const extracted = await extractThemeFromArtwork(state.artBlob);
  if (reqId !== state.themeRequestId) return;
  animateThemeTo(extracted || DEFAULT_THEME);
}
