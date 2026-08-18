// Color math for the theme generator.
//
// Everything perceptual happens in OKLCH (Björn Ottosson's OKLab in polar form),
// because it lets us move lightness and chroma independently without the hue
// drift you get from HSL. Contrast is checked in WCAG's sRGB relative luminance,
// since that is what accessibility tooling and reviewers actually measure.

const clamp = (n, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));

export function hexToRgb(hex) {
  const h = hex.replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return {
    r: parseInt(full.slice(0, 2), 16) / 255,
    g: parseInt(full.slice(2, 4), 16) / 255,
    b: parseInt(full.slice(4, 6), 16) / 255,
  };
}

export function rgbToHex({ r, g, b }) {
  const to8 = (c) => Math.round(clamp(c) * 255).toString(16).padStart(2, '0');
  return `#${to8(r)}${to8(g)}${to8(b)}`.toUpperCase();
}

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function rgbToOklab({ r, g, b }) {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function oklabToRgb({ L, a, b }) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return {
    r: linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

export function hexToOklch(hex) {
  const { L, a, b } = rgbToOklab(hexToRgb(hex));
  const C = Math.sqrt(a * a + b * b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { L, C, h };
}

const inGamut = ({ r, g, b }) =>
  r >= -1e-4 && r <= 1 + 1e-4 && g >= -1e-4 && g <= 1 + 1e-4 && b >= -1e-4 && b <= 1 + 1e-4;

// Convert OKLCH back to a hex that actually exists in sRGB. If the requested
// chroma is outside the gamut we bisect it down rather than letting the channels
// clip, which would shift the hue.
export function oklchToHex({ L, C, h }) {
  const rad = (h * Math.PI) / 180;
  const at = (c) => oklabToRgb({ L, a: Math.cos(rad) * c, b: Math.sin(rad) * c });

  if (inGamut(at(C))) return rgbToHex(at(C));

  let lo = 0;
  let hi = C;
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2;
    if (inGamut(at(mid))) lo = mid;
    else hi = mid;
  }
  return rgbToHex(at(lo));
}

export function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

export function contrastRatio(fg, bg) {
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

// Raise lightness (hue and chroma held) until the color clears `target` contrast
// against `bg`. Used to keep every syntax token legible no matter how dark a
// school's brand color is — Alabama crimson and Penn red both need this.
export function ensureContrast(hex, bg, target) {
  if (contrastRatio(hex, bg) >= target) return hex;

  const { L, C, h } = hexToOklch(hex);
  let best = hex;
  for (let step = L; step <= 1.0001; step += 0.01) {
    const candidate = oklchToHex({ L: step, C, h });
    best = candidate;
    if (contrastRatio(candidate, bg) >= target) return candidate;
  }
  // Fully desaturating is the last resort; a white-ish token beats an illegible one.
  for (let c = C; c >= 0; c -= 0.01) {
    const candidate = oklchToHex({ L: 0.99, C: c, h });
    if (contrastRatio(candidate, bg) >= target) return candidate;
  }
  return best;
}

export const adjust = (hex, { L, C, h } = {}) => {
  const base = hexToOklch(hex);
  return oklchToHex({
    L: L === undefined ? base.L : typeof L === 'function' ? L(base.L) : L,
    C: C === undefined ? base.C : typeof C === 'function' ? C(base.C) : C,
    h: h === undefined ? base.h : typeof h === 'function' ? h(base.h) : h,
  });
};

export const hueDistance = (a, b) => {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
};

// Push `hue` at least `min` degrees away from `avoid`, moving in whichever
// direction is closer so the result stays near the intended color family.
export function separateHue(hue, avoid, min) {
  if (hueDistance(hue, avoid) >= min) return hue;
  const up = (avoid + min) % 360;
  const down = (avoid - min + 360) % 360;
  return hueDistance(hue, up) <= hueDistance(hue, down) ? up : down;
}

export const withAlpha = (hex, alpha) => `${hex}${alpha}`;

// Perceptual distance in OKLab. Unlike comparing hue and lightness separately,
// this correctly reports that a vivid blue and a grey-blue at the same hue and
// lightness are easy to tell apart, because chroma is part of the geometry.
export function deltaE(a, b) {
  const x = rgbToOklab(hexToRgb(a));
  const y = rgbToOklab(hexToRgb(b));
  return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b);
}
