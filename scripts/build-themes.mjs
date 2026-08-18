// Generates one VS Code color theme per school in palettes/schools.json,
// then rewrites contributes.themes in package.json to match.
//
//   node scripts/build-themes.mjs
//
// The lightness/chroma targets below were measured off the hand-tuned Michigan
// Wolverines theme (see scripts/validate-themes.mjs for the checks that keep
// every generated variant as legible as that original).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  hexToOklch,
  oklchToHex,
  contrastRatio,
  ensureContrast,
  separateHue,
  hueDistance,
  deltaE,
} from './color.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// The editor surface is deliberately near-identical across schools: it is what
// you stare at all day, so it stays a dark, barely-tinted neutral. The brand
// colour lives in the chrome (activity bar, status bar, tabs) and the accent.
const EDITOR_BG_L = 0.30;
const EDITOR_BG_C_CAP = 0.055;

// Chrome tracks the school's actual brand colour, but clamped into a band that
// still reads as a dark theme. UCLA blue and Clemson regalia come down; black
// (Iowa, Georgia) comes up off pure #000.
const CHROME_L_MIN = 0.17;
const CHROME_L_MAX = 0.35;

const MIN_CONTRAST = { token: 4.5, comment: 3.5, ui: 3.0 };

// Canonical syntax hues, in OKLCH degrees, measured from the Michigan theme.
// `fixed: true` means the role keeps the brand hue instead of a colour-wheel slot.
const ROLES = {
  comment: { h: null, L: 0.62, C: 0.05, fixed: true, min: MIN_CONTRAST.comment },
  punctuation: { h: null, L: 0.71, C: 0.05, fixed: true, min: MIN_CONTRAST.token },
  variable: { h: null, L: 0.96, C: 0.008, fixed: true, min: MIN_CONTRAST.token },
  property: { h: 38, L: 0.82, C: 0.106 },
  keywordControl: { h: 42, L: 0.77, C: 0.145 },
  string: { h: 145, L: 0.83, C: 0.097 },
  type: { h: 183, L: 0.80, C: 0.119 },
  attribute: { h: 196, L: 0.83, C: 0.084 },
  number: { h: 223, L: 0.79, C: 0.083 },
  function: { h: 252, L: 0.75, C: 0.130 },
  constant: { h: 311, L: 0.74, C: 0.135 },
};

const ACCENT_HUE_GUARD = 28; // degrees a role must stay clear of the brand accent
const NEIGHBOUR_HUE = 25; // below this, two roles must differ in lightness instead
const NEIGHBOUR_L_GAP = 0.06;

// Minimum perceptual gap between any two syntax colours. Calibrated against the
// hand-tuned Michigan theme, whose tightest distinct pair measures 0.0528 —
// so this floor is "at least as separated as a theme a human already approved".
const MIN_DELTA_E = 0.055;

// Repair order, most protected first. The brand accent never moves; comments and
// punctuation move first, since they only need to read as muted.
const REPAIR_ORDER = [
  'accent',
  'invalid',
  'string',
  'function',
  'type',
  'number',
  'constant',
  'property',
  'keywordControl',
  'attribute',
  'variable',
  'punctuation',
  'comment',
];

// Nudge the lower-priority colour of any too-close pair along the lightness axis
// until it separates, re-checking its contrast floor at every step. Hue and
// chroma are preserved, so a school's palette stays on-theme while becoming
// readable — which is the trade the brand guidelines are allowed to lose.
function repairCollisions(colors, floors, bg) {
  for (let pass = 0; pass < 8; pass += 1) {
    let changed = false;

    for (let i = 0; i < REPAIR_ORDER.length; i += 1) {
      for (let j = i + 1; j < REPAIR_ORDER.length; j += 1) {
        const keep = REPAIR_ORDER[i];
        const move = REPAIR_ORDER[j];
        if (!colors[keep] || !colors[move]) continue;
        // Identical values are deliberate aliases (tags reuse the function colour).
        if (colors[keep] === colors[move]) continue;
        if (deltaE(colors[keep], colors[move]) >= MIN_DELTA_E) continue;

        const anchor = hexToOklch(colors[keep]);
        const floor = floors[move] ?? MIN_CONTRAST.token;
        const start = hexToOklch(colors[move]);
        let best = colors[move];
        let bestGap = deltaE(colors[keep], best);

        for (const dir of start.L >= anchor.L ? [1, -1] : [-1, 1]) {
          let candidate = null;
          for (let step = 1; step <= 40; step += 1) {
            const L = Math.min(0.97, Math.max(0.40, start.L + dir * 0.01 * step));
            const hex = ensureContrast(
              oklchToHex({ L, C: start.C, h: start.h }),
              bg,
              floor,
            );
            const gap = deltaE(colors[keep], hex);
            if (gap > bestGap) {
              bestGap = gap;
              best = hex;
            }
            if (gap >= MIN_DELTA_E) {
              candidate = hex;
              break;
            }
          }
          if (candidate) {
            best = candidate;
            break;
          }
        }

        if (best !== colors[move]) {
          colors[move] = best;
          changed = true;
        }
      }
    }

    if (!changed) return;
  }
}

function deriveChrome(school) {
  const accent = hexToOklch(school.accent);
  const brandDark = school.dark ? hexToOklch(school.dark) : null;

  // A neutral brand colour — black for Iowa, smokey grey for Tennessee — has no
  // hue to borrow. Take the accent's hue for the faint tint, but keep chroma
  // near zero so the chrome stays genuinely black/grey and the accent supplies
  // all the colour. Borrowing the accent's full chroma turned Iowa olive.
  const darkIsNeutral = brandDark !== null && brandDark.C <= 0.02;
  const hue = brandDark && !darkIsNeutral ? brandDark.h : accent.h;
  const chroma = darkIsNeutral
    ? 0.012
    : brandDark
      ? brandDark.C
      : Math.min(accent.C, 0.09);

  const chromeL = brandDark
    ? Math.min(CHROME_L_MAX, Math.max(CHROME_L_MIN, brandDark.L))
    : 0.24;

  const at = (L, cMul = 1, cCap = Infinity) =>
    oklchToHex({ L, C: Math.min(chroma * cMul, cCap), h: hue });

  return {
    hue,
    chroma,
    chromeL,
    editorBg: oklchToHex({ L: EDITOR_BG_L, C: Math.min(chroma, EDITOR_BG_C_CAP), h: hue }),
    chromeBg: at(chromeL),
    border: at(chromeL - 0.055, 0.9),
    deep: at(chromeL - 0.085, 0.85),
    active: at(chromeL + 0.075, 1.2),
    hover: at(chromeL + 0.04, 1.1),
    sidebarBg: at(0.235, 0.8),
    widgetBg: at(chromeL - 0.055, 0.9),
    indentGuide: at(0.42, 0.9),
    whitespace: at(0.38, 0.85),
    editorFg: oklchToHex({ L: 0.96, C: 0.008, h: hue }),
    sidebarFg: oklchToHex({ L: 0.91, C: 0.022, h: hue }),
    lineNumber: oklchToHex({ L: 0.63, C: 0.05, h: hue }),
  };
}

// Resolve each syntax role to a concrete hex: rotate off the brand accent,
// pull apart same-hue neighbours using lightness, force the WCAG floor, then
// repair whatever still collides.
function deriveSyntax(chrome, accentHex) {
  const accentHue = hexToOklch(accentHex).h;
  const resolved = {};

  for (const [name, spec] of Object.entries(ROLES)) {
    // Even the brand-hue roles rotate off the accent. Michigan State's green
    // accent sits right on its green brand hue, which would otherwise leave
    // comments and keywords the same colour.
    const start = spec.fixed ? chrome.hue : spec.h;
    resolved[name] = {
      ...spec,
      h: separateHue(start, accentHue, ACCENT_HUE_GUARD),
      L: spec.L,
      C: spec.C,
    };
  }

  // Two roles in the same hue neighbourhood separate in lightness. Push the
  // darker one down and the lighter one up — moving both the same way would
  // close the gap rather than open it.
  const chromatic = Object.entries(resolved).filter(([, s]) => !s.fixed);
  chromatic.sort((a, b) => a[1].h - b[1].h);
  for (let i = 1; i < chromatic.length; i += 1) {
    const [, prev] = chromatic[i - 1];
    const [, cur] = chromatic[i];
    if (hueDistance(prev.h, cur.h) < NEIGHBOUR_HUE) {
      const gap = NEIGHBOUR_L_GAP - Math.abs(prev.L - cur.L);
      if (gap > 0) {
        cur.L = cur.L >= prev.L ? Math.min(0.95, cur.L + gap) : Math.max(0.45, cur.L - gap);
      }
    }
  }

  const floors = {};
  const out = {};
  for (const [name, spec] of Object.entries(resolved)) {
    floors[name] = spec.min ?? MIN_CONTRAST.token;
    out[name] = ensureContrast(
      oklchToHex({ L: spec.L, C: spec.C, h: spec.h }),
      chrome.editorBg,
      floors[name],
    );
  }

  // Errors must never read as ordinary syntax. Red normally, but on a red-brand
  // school that would collide with the keyword colour, so swing to magenta and
  // underline it as a second, colour-independent signal.
  const redClash = hueDistance(accentHue, 25) < 45;
  floors.invalid = MIN_CONTRAST.token;
  out.invalid = ensureContrast(
    oklchToHex(redClash ? { L: 0.60, C: 0.22, h: 348 } : { L: 0.66, C: 0.21, h: 25 }),
    chrome.editorBg,
    floors.invalid,
  );

  // The accent takes part in the repair as an immovable anchor: everything else
  // gives way to it, so the school's colour survives untouched.
  out.accent = accentHex;
  floors.accent = MIN_CONTRAST.token;
  repairCollisions(out, floors, chrome.editorBg);
  delete out.accent;

  out.invalidStyle = redClash ? 'bold underline' : 'bold';
  return out;
}

function buildTheme(school) {
  const chrome = deriveChrome(school);

  // The brand accent has to survive on the editor background. Alabama crimson
  // and Penn red are far too dark as shipped, so they get lifted here.
  const accent = ensureContrast(school.accent, chrome.editorBg, MIN_CONTRAST.token);

  // The accent lands on several different surfaces, and the lighter ones (active
  // tab, selected list row) are the tightest. Each gets its own lifted variant
  // rather than assuming the editor-background version is good enough.
  const accentOnChrome = ensureContrast(accent, chrome.chromeBg, MIN_CONTRAST.ui);
  const accentOnActive = ensureContrast(accent, chrome.active, MIN_CONTRAST.ui);
  const accentOnSidebar = ensureContrast(accent, chrome.sidebarBg, MIN_CONTRAST.ui);

  // Text sitting on top of the accent (buttons, badges). Prefer the school's
  // actual brand colour — maize buttons should carry Michigan Blue, not a
  // near-black approximation of it — and only fall back when it cannot carry
  // body-text contrast against the accent.
  const onAccent =
    contrastRatio(chrome.chromeBg, accent) >= MIN_CONTRAST.token
      ? chrome.chromeBg
      : contrastRatio(chrome.deep, accent) >= contrastRatio('#FFFFFF', accent)
        ? chrome.deep
        : '#FFFFFF';

  const accentOklch = hexToOklch(accent);
  const accentHover = oklchToHex({ ...accentOklch, L: accentOklch.L - 0.07 });
  const muted = ensureContrast(
    oklchToHex({ L: 0.68, C: 0.055, h: chrome.hue }),
    chrome.chromeBg,
    MIN_CONTRAST.ui,
  );

  const s = deriveSyntax(chrome, accent);

  // ANSI colours must actually match their names. Reusing syntax roles here was
  // wrong: `property` is a salmon at hue 38, so ansiYellow came out salmon and
  // any program printing yellow looked orange. These are pinned to canonical
  // hues and only tinted by the school's chroma, not its hue.
  // Where a school's accent already sits in an ANSI hue family, let it take that
  // slot: Michigan maize genuinely is the yellow, and a generated substitute
  // would only look duller next to it.
  const accentHueForAnsi = hexToOklch(accent).h;
  const ansiAt = (h, L = 0.80) => {
    if (hueDistance(accentHueForAnsi, h) <= 25) return accent;
    return ensureContrast(oklchToHex({ L, C: 0.14, h }), chrome.sidebarBg, MIN_CONTRAST.token);
  };
  const ansi = {
    'terminal.ansiBlack': chrome.deep,
    'terminal.ansiRed': ansiAt(25),
    'terminal.ansiGreen': ansiAt(145),
    'terminal.ansiYellow': ansiAt(95),
    'terminal.ansiBlue': ansiAt(250),
    'terminal.ansiMagenta': ansiAt(330),
    'terminal.ansiCyan': ansiAt(195),
    'terminal.ansiWhite': chrome.sidebarFg,
    'terminal.ansiBrightBlack': chrome.indentGuide,
    'terminal.ansiBrightRed': ansiAt(25, 0.85),
    'terminal.ansiBrightGreen': ansiAt(145, 0.88),
    'terminal.ansiBrightYellow': ansiAt(95, 0.9),
    'terminal.ansiBrightBlue': ansiAt(250, 0.83),
    'terminal.ansiBrightMagenta': ansiAt(330, 0.85),
    'terminal.ansiBrightCyan': ansiAt(195, 0.9),
    'terminal.ansiBrightWhite': chrome.editorFg,
  };

  return {
    name: school.label,
    type: 'dark',
    colors: {
      'activityBar.background': chrome.chromeBg,
      'activityBar.foreground': accentOnChrome,
      'activityBar.inactiveForeground': muted,
      'activityBar.border': chrome.border,
      'activityBarBadge.background': accent,
      'activityBarBadge.foreground': onAccent,

      'titleBar.activeBackground': chrome.chromeBg,
      'titleBar.activeForeground': accentOnChrome,
      'titleBar.inactiveBackground': chrome.border,
      'titleBar.inactiveForeground': muted,

      'statusBar.background': chrome.chromeBg,
      'statusBar.foreground': '#FFFFFF',
      'statusBar.border': chrome.border,
      'statusBar.debuggingBackground': accent,
      'statusBar.debuggingForeground': onAccent,
      'statusBar.noFolderBackground': chrome.chromeBg,
      'statusBarItem.remoteBackground': accent,
      'statusBarItem.remoteForeground': onAccent,
      'statusBarItem.hoverBackground': chrome.active,

      'sideBar.background': chrome.sidebarBg,
      'sideBar.foreground': chrome.sidebarFg,
      'sideBar.border': chrome.border,
      'sideBarTitle.foreground': accentOnSidebar,
      'sideBarSectionHeader.background': chrome.chromeBg,
      'sideBarSectionHeader.foreground': accentOnChrome,

      'tab.activeBackground': chrome.active,
      'tab.activeForeground': accentOnActive,
      'tab.activeBorderTop': accentOnActive,
      'tab.inactiveBackground': chrome.border,
      'tab.inactiveForeground': muted,
      'tab.border': chrome.deep,
      'editorGroupHeader.tabsBackground': chrome.deep,

      'editor.background': chrome.editorBg,
      'editor.foreground': chrome.editorFg,
      'editorLineNumber.foreground': chrome.lineNumber,
      'editorLineNumber.activeForeground': accent,
      'editorCursor.foreground': accent,
      'editor.selectionBackground': `${accent}60`,
      'editor.inactiveSelectionBackground': `${accent}35`,
      'editor.lineHighlightBackground': `${chrome.active}80`,
      'editorIndentGuide.background': chrome.indentGuide,
      'editorIndentGuide.activeBackground': accent,
      'editorWhitespace.foreground': chrome.whitespace,

      'editorWidget.background': chrome.widgetBg,
      'editorSuggestWidget.background': chrome.widgetBg,
      'editorSuggestWidget.selectedBackground': chrome.active,
      'editorSuggestWidget.highlightForeground': accentOnActive,

      'panel.background': chrome.sidebarBg,
      'panel.border': chrome.border,
      'panelTitle.activeBorder': accentOnSidebar,
      'panelTitle.activeForeground': accentOnSidebar,
      'panelTitle.inactiveForeground': muted,

      'terminal.background': chrome.sidebarBg,
      'terminal.foreground': chrome.sidebarFg,
      ...ansi,

      'input.background': chrome.widgetBg,
      'input.foreground': chrome.sidebarFg,
      'input.border': chrome.active,
      'inputOption.activeBorder': accent,
      focusBorder: accent,

      'button.background': accent,
      'button.foreground': onAccent,
      'button.hoverBackground': accentHover,

      'badge.background': accent,
      'badge.foreground': onAccent,

      'list.activeSelectionBackground': chrome.active,
      'list.activeSelectionForeground': accentOnActive,
      'list.inactiveSelectionBackground': chrome.border,
      'list.hoverBackground': chrome.hover,
      'list.highlightForeground': accentOnActive,

      'scrollbarSlider.background': `${chrome.active}80`,
      'scrollbarSlider.hoverBackground': `${chrome.active}B0`,
      'scrollbarSlider.activeBackground': `${accent}A0`,

      'minimap.background': chrome.editorBg,
      'minimapSlider.background': `${accent}30`,

      'gitDecoration.modifiedResourceForeground': accent,
      'gitDecoration.addedResourceForeground': s.string,
      'gitDecoration.deletedResourceForeground': s.invalid,
    },
    tokenColors: [
      {
        scope: ['comment', 'punctuation.definition.comment'],
        settings: { foreground: s.comment, fontStyle: 'italic' },
      },
      { scope: ['keyword', 'storage.type', 'storage.modifier'], settings: { foreground: accent } },
      {
        scope: ['keyword.control'],
        settings: { foreground: s.keywordControl, fontStyle: 'bold' },
      },
      { scope: ['string', 'string.quoted'], settings: { foreground: s.string } },
      { scope: ['constant.numeric'], settings: { foreground: s.number } },
      { scope: ['constant.language', 'constant.character'], settings: { foreground: s.constant } },
      { scope: ['entity.name.function', 'support.function'], settings: { foreground: s.function } },
      {
        scope: ['entity.name.class', 'entity.name.type', 'support.class'],
        settings: { foreground: s.type, fontStyle: 'bold' },
      },
      { scope: ['entity.name.tag'], settings: { foreground: s.function } },
      { scope: ['entity.other.attribute-name'], settings: { foreground: s.attribute } },
      { scope: ['variable', 'variable.parameter'], settings: { foreground: s.variable } },
      { scope: ['variable.other.constant'], settings: { foreground: accent } },
      { scope: ['punctuation', 'meta.brace'], settings: { foreground: s.punctuation } },
      {
        scope: ['support.type.property-name', 'meta.object-literal.key'],
        settings: { foreground: s.property },
      },
      { scope: ['invalid'], settings: { foreground: s.invalid, fontStyle: s.invalidStyle } },
      { scope: ['markup.bold'], settings: { fontStyle: 'bold', foreground: accent } },
      { scope: ['markup.italic'], settings: { fontStyle: 'italic' } },
      { scope: ['markup.heading'], settings: { foreground: accent, fontStyle: 'bold' } },
    ],
  };
}

const { schools } = JSON.parse(readFileSync(join(root, 'palettes/schools.json'), 'utf8'));

mkdirSync(join(root, 'themes'), { recursive: true });

const contributions = schools.map((school) => {
  const theme = buildTheme(school);
  const file = `themes/${school.slug}-color-theme.json`;
  writeFileSync(join(root, file), `${JSON.stringify(theme, null, 2)}\n`);
  return { label: `College Colors: ${school.label}`, uiTheme: 'vs-dark', path: `./${file}` };
});

const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.contributes = { ...pkg.contributes, themes: contributions };
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

console.log(`Generated ${contributions.length} themes and updated contributes.themes.`);
