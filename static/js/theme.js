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
  root.style.setProperty('--accent1-rgb', `${c1.r},${c1.g},${c1.b}`);
  root.style.setProperty('--accent2-rgb', `${c2.r},${c2.g},${c2.b}`);
}

export function animateThemeTo(nextTheme, duration = 850) {
  const target = {
    h1: ((nextTheme.h1 % 360) + 360) % 360,
    s1: clampVal(nextTheme.s1, 35, 100),
    l1: clampVal(nextTheme.l1, 20, 80),
    h2: ((nextTheme.h2 % 360) + 360) % 360,
    s2: clampVal(nextTheme.s2, 35, 100),
    l2: clampVal(nextTheme.l2, 20, 80),
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

        let totalW = 0, totalSatW = 0, totalLumW = 0;

        for (let i = 0; i < px.length; i += 4) {
          const a = px[i + 3];
          if (a < 160) continue;
          const { h, s, l } = rgbToHsl(px[i], px[i + 1], px[i + 2]);
          if (l < 0.08 || l > 0.92 || s < 0.08) continue;
          const weight = s * (0.55 + 0.45 * (1 - Math.abs(l - 0.5) * 2));
          const bi = Math.floor(h / 10) % 36;
          bins[bi].w += weight;
          bins[bi].h += h * weight;
          bins[bi].s += s * weight;
          bins[bi].l += l * weight;
          totalW += weight;
          totalSatW += s * weight;
          totalLumW += l * weight;
        }

        let first = -1;
        let firstW = 0;
        for (let i = 0; i < bins.length; i++) {
          if (bins[i].w > firstW) { firstW = bins[i].w; first = i; }
        }
        if (first < 0 || firstW < 0.2) { resolve(null); return; }

        // Compute image mood to adaptively clamp output saturation/lightness.
        // Muted/dark images shouldn't be forced into vivid mid-tone accents.
        const avgSat = totalW > 0 ? totalSatW / totalW : 0.5;
        const avgLum = totalW > 0 ? totalLumW / totalW : 0.5;
        const mutedFactor = Math.min(1, avgSat / 0.35);  // 0 = very muted, 1 = vivid
        const darkFactor  = Math.min(1, avgLum / 0.40);  // 0 = very dark,  1 = bright
        const sMin = Math.round(35 + mutedFactor * 23);  // 35–58
        const sMax = Math.round(75 + mutedFactor * 20);  // 75–95
        const lMin = Math.round(22 + darkFactor  * 12);  // 22–34
        const lMax = Math.round(52 + darkFactor  * 14);  // 52–66

        let second = -1;
        let secondW = 0;
        const firstHue = first * 10;
        for (let i = 0; i < bins.length; i++) {
          if (i === first) continue;
          const hue = i * 10;
          if (hueDistance(firstHue, hue) < 36) continue;
          if (bins[i].w > secondW) { secondW = bins[i].w; second = i; }
        }
        // Relax distance constraint for monochromatic/muted images
        if (second < 0) {
          secondW = 0;
          for (let i = 0; i < bins.length; i++) {
            if (i === first) continue;
            if (hueDistance(firstHue, i * 10) < 20) continue;
            if (bins[i].w > secondW) { secondW = bins[i].w; second = i; }
          }
        }
        // Final fallback: analogous hue (+30°) rather than jumping +120°
        if (second < 0) second = (first + 3) % 36;

        function toneFrom(idx, fallbackHue) {
          const b = bins[idx];
          if (!b || b.w < 0.2) {
            return { h: fallbackHue, s: (sMin + sMax) / 2, l: (lMin + lMax) / 2 };
          }
          return {
            h: ((b.h / b.w) % 360 + 360) % 360,
            s: clampVal((b.s / b.w) * 100, sMin, sMax),
            l: clampVal((b.l / b.w) * 100, lMin, lMax),
          };
        }

        const aTone = toneFrom(first, first * 10);
        const bTone = toneFrom(second, second * 10);
        resolve({
          h1: aTone.h, s1: aTone.s, l1: aTone.l,
          h2: bTone.h, s2: bTone.s, l2: bTone.l,
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
