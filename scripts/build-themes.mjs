// Generates VS Code color themes — one dark and one light per school in
// palettes/schools.json — then rewrites contributes.themes in package.json.
//
//   node scripts/build-themes.mjs
//
// The dark lightness/chroma targets below were measured off the hand-tuned
// Michigan Wolverines theme; the light targets mirror them across the mid-tone
// so the same hue slots read as ink on a near-white page. See
// scripts/validate-themes.mjs for the checks that hold every generated variant
// to the same legibility bar as that original.

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
// you stare at all day, so it stays a barely-tinted neutral — dark charcoal in
// the dark variants, just off white in the light ones. The brand colour lives
// in the chrome (activity bar, status bar, tabs) and the accent.
const EDITOR_BG_L = 0.30;
const EDITOR_BG_C_CAP = 0.055;
const LIGHT_EDITOR_BG_L = 0.965;
const LIGHT_EDITOR_BG_C_CAP = 0.015;

// Chrome tracks the school's actual brand colour, but clamped into a band that
// still reads as a dark strip. UCLA blue and Clemson regalia come down; black
// (Iowa, Georgia) comes up off pure #000. The light variants keep this same
// branded chrome — it is what makes a theme recognizably Michigan — and only
// the working surfaces (editor, sidebar, panels) flip to light.
const CHROME_L_MIN = 0.17;
const CHROME_L_MAX = 0.35;

const MIN_CONTRAST = { token: 4.5, comment: 3.5, ui: 3.0 };

// Canonical syntax hues, in OKLCH degrees. The dark table is measured from the
// Michigan theme; the light table keeps the same hue slots with lightness
// dropped below the mid-tone so each role reads as ink rather than pastel.
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

const ROLES_LIGHT = {
  comment: { h: null, L: 0.55, C: 0.04, fixed: true, min: MIN_CONTRAST.comment },
  punctuation: { h: null, L: 0.44, C: 0.04, fixed: true, min: MIN_CONTRAST.token },
  variable: { h: null, L: 0.25, C: 0.008, fixed: true, min: MIN_CONTRAST.token },
  property: { h: 38, L: 0.48, C: 0.100 },
  keywordControl: { h: 42, L: 0.42, C: 0.135 },
  string: { h: 145, L: 0.46, C: 0.100 },
  type: { h: 183, L: 0.44, C: 0.090 },
  attribute: { h: 196, L: 0.475, C: 0.080 },
  number: { h: 223, L: 0.43, C: 0.090 },
  function: { h: 252, L: 0.40, C: 0.125 },
  constant: { h: 311, L: 0.45, C: 0.135 },
};

const ACCENT_HUE_GUARD = 28; // degrees a role must stay clear of the brand accent
const NEIGHBOUR_HUE = 25; // below this, two roles must differ in lightness instead
const NEIGHBOUR_L_GAP = 0.06;

// Minimum perceptual gap between any two syntax colours. Calibrated against the
// hand-tuned Michigan theme, whose tightest distinct pair measures 0.0528 —
// so this floor is "at least as separated as a theme a human already approved".
const MIN_DELTA_E = 0.055;

// Per-variant tuning the shared derivation code branches on. `repair` and
// `neighbour` are the lightness bands tokens may be pushed through when they
// collide; `invalid` is the error colour, with the magenta swing used when the
// brand accent is itself red; `selectionAlpha` is [active, inactive] — light
// backgrounds need less pigment for the same visible weight.
const VARIANTS = {
  dark: {
    roles: ROLES,
    repair: { lMin: 0.40, lMax: 0.97 },
    neighbour: { lMin: 0.45, lMax: 0.95 },
    invalid: { plain: { L: 0.66, C: 0.21, h: 25 }, clash: { L: 0.60, C: 0.22, h: 348 } },
    selectionAlpha: ['60', '35'],
  },
  light: {
    roles: ROLES_LIGHT,
    repair: { lMin: 0.18, lMax: 0.62 },
    neighbour: { lMin: 0.25, lMax: 0.60 },
    invalid: { plain: { L: 0.50, C: 0.20, h: 25 }, clash: { L: 0.45, C: 0.20, h: 348 } },
    selectionAlpha: ['40', '26'],
  },
};

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
function repairCollisions(colors, floors, bg, { lMin, lMax }) {
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

        // A landing spot must clear every higher-priority colour, not just the
        // one currently colliding — otherwise a crowded hue pocket (the teal
        // band on navy-accent schools) makes each pairwise fix undo the last.
        const guards = REPAIR_ORDER.slice(0, j).filter(
          (name) => name !== move && colors[name] && colors[name] !== colors[move],
        );
        const clearsGuards = (hex) =>
          guards.every((name) => deltaE(colors[name], hex) >= MIN_DELTA_E);

        for (const dir of start.L >= anchor.L ? [1, -1] : [-1, 1]) {
          let candidate = null;
          for (let step = 1; step <= 40; step += 1) {
            const L = Math.min(lMax, Math.max(lMin, start.L + dir * 0.01 * step));
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
            if (gap >= MIN_DELTA_E && clearsGuards(hex)) {
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

function deriveChrome(school, variant) {
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

  // The branded strips — activity bar, title bar, status bar, tab rail — are
  // shared by both variants; a light theme keeps its school colours there.
  const brand = {
    hue,
    chroma,
    chromeL,
    chromeBg: at(chromeL),
    border: at(chromeL - 0.055, 0.9),
    deep: at(chromeL - 0.085, 0.85),
    active: at(chromeL + 0.075, 1.2),
    hover: at(chromeL + 0.04, 1.1),
  };

  if (variant === 'light') {
    const lightAt = (L, cCap = LIGHT_EDITOR_BG_C_CAP) =>
      oklchToHex({ L, C: Math.min(chroma, cCap), h: hue });
    const editorBg = lightAt(LIGHT_EDITOR_BG_L);
    return {
      ...brand,
      editorBg,
      sidebarBg: lightAt(0.945),
      widgetBg: lightAt(0.975, 0.012),
      // The active tab joins the light editor instead of the dark tab rail, so
      // the open file reads as a tab "cut out" of the branded chrome.
      tabActiveBg: editorBg,
      listActiveBg: lightAt(0.885, 0.03),
      listHoverBg: lightAt(0.915, 0.025),
      listInactiveBg: lightAt(0.90, 0.025),
      lineHighlight: lightAt(0.925, 0.02),
      scroll: lightAt(0.78, 0.02),
      indentGuide: lightAt(0.85, 0.02),
      whitespace: lightAt(0.885, 0.02),
      editorFg: oklchToHex({ L: 0.22, C: 0.008, h: hue }),
      sidebarFg: oklchToHex({ L: 0.30, C: 0.02, h: hue }),
      lineNumber: ensureContrast(
        oklchToHex({ L: 0.55, C: 0.04, h: hue }),
        editorBg,
        MIN_CONTRAST.ui,
      ),
    };
  }

  return {
    ...brand,
    editorBg: oklchToHex({ L: EDITOR_BG_L, C: Math.min(chroma, EDITOR_BG_C_CAP), h: hue }),
    sidebarBg: at(0.235, 0.8),
    widgetBg: at(chromeL - 0.055, 0.9),
    tabActiveBg: brand.active,
    listActiveBg: brand.active,
    listHoverBg: brand.hover,
    listInactiveBg: brand.border,
    lineHighlight: brand.active,
    scroll: brand.active,
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
function deriveSyntax(chrome, accentHex, variant) {
  const { roles, neighbour, invalid, repair } = VARIANTS[variant];
  const accentHue = hexToOklch(accentHex).h;
  const resolved = {};

  for (const [name, spec] of Object.entries(roles)) {
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
        cur.L =
          cur.L >= prev.L
            ? Math.min(neighbour.lMax, cur.L + gap)
            : Math.max(neighbour.lMin, cur.L - gap);
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
    oklchToHex(redClash ? invalid.clash : invalid.plain),
    chrome.editorBg,
    floors.invalid,
  );

  // The accent takes part in the repair as an immovable anchor: everything else
  // gives way to it, so the school's colour survives untouched.
  out.accent = accentHex;
  floors.accent = MIN_CONTRAST.token;
  repairCollisions(out, floors, chrome.editorBg, repair);
  delete out.accent;

  out.invalidStyle = redClash ? 'bold underline' : 'bold';
  return out;
}

function buildTheme(school, variant) {
  const isLight = variant === 'light';
  const chrome = deriveChrome(school, variant);

  // Dark: the brand accent has to survive on the dark editor — Alabama crimson
  // and Penn red are far too dark as shipped, so they get lifted here.
  // Light: the ink comes from the school's dark brand colour when it has a
  // chromatic one (navy for Michigan, purple for LSU) — the bright accent stays
  // in the chrome — otherwise the accent is darkened until it reads on the page.
  const brandDark = school.dark ? hexToOklch(school.dark) : null;
  const inkSeed = isLight && brandDark && brandDark.C > 0.02 ? school.dark : school.accent;
  const accent = ensureContrast(inkSeed, chrome.editorBg, MIN_CONTRAST.token);

  // The accent lands on several different surfaces, each with its own tightest
  // fit, so each gets its own adjusted variant. Chrome-side accents start from
  // the untouched brand accent in the light variants, since the chrome strips
  // stay dark and brand-bright there.
  const accentOnChrome = ensureContrast(
    isLight ? school.accent : accent,
    chrome.chromeBg,
    MIN_CONTRAST.ui,
  );
  const accentOnTab = ensureContrast(accent, chrome.tabActiveBg, MIN_CONTRAST.ui);
  const accentOnList = ensureContrast(accent, chrome.listActiveBg, MIN_CONTRAST.ui);
  const accentOnSidebar = ensureContrast(accent, chrome.sidebarBg, MIN_CONTRAST.ui);

  // Badges and the debugging/remote status-bar fills sit against the branded
  // chrome, so in the light variants they keep the bright brand accent; buttons
  // live on the light working surfaces and use the ink accent instead. Text on
  // top of either prefers the school's actual brand colour — maize buttons
  // should carry Michigan Blue, not a near-black approximation of it — and only
  // falls back to whichever neutral reads when the brand colour cannot carry
  // body-text contrast against the fill.
  const badgeBg = isLight ? accentOnChrome : accent;
  const onFill = (bg) => {
    if (contrastRatio(chrome.chromeBg, bg) >= MIN_CONTRAST.token) return chrome.chromeBg;
    const candidates = isLight ? [chrome.deep, '#FFFFFF', '#000000'] : [chrome.deep, '#FFFFFF'];
    return candidates.reduce((a, b) => (contrastRatio(a, bg) >= contrastRatio(b, bg) ? a : b));
  };
  const onBadge = onFill(badgeBg);
  const onAccent = onFill(accent);

  const accentOklch = hexToOklch(accent);
  const accentHover = oklchToHex({ ...accentOklch, L: accentOklch.L - 0.07 });
  const muted = ensureContrast(
    oklchToHex({ L: 0.68, C: 0.055, h: chrome.hue }),
    chrome.chromeBg,
    MIN_CONTRAST.ui,
  );

  const s = deriveSyntax(chrome, accent, variant);
  const [selectionA, selectionB] = VARIANTS[variant].selectionAlpha;

  // ANSI colours must actually match their names. Reusing syntax roles here was
  // wrong: `property` is a salmon at hue 38, so ansiYellow came out salmon and
  // any program printing yellow looked orange. These are pinned to canonical
  // hues and only tinted by the school's chroma, not its hue.
  // Where a school's accent already sits in an ANSI hue family, let it take that
  // slot: Michigan maize genuinely is the yellow, and a generated substitute
  // would only look duller next to it. The light variants drop each slot below
  // the mid-tone so it reads as ink on the light terminal, and swap the
  // black/white slots for light-appropriate greys.
  const accentHueForAnsi = hexToOklch(accent).h;
  const ansiAt = (h, L = 0.80) => {
    if (hueDistance(accentHueForAnsi, h) <= 25) return accent;
    return ensureContrast(
      oklchToHex({ L: isLight ? L - 0.36 : L, C: 0.14, h }),
      chrome.sidebarBg,
      MIN_CONTRAST.token,
    );
  };
  const ansi = {
    'terminal.ansiBlack': chrome.deep,
    'terminal.ansiRed': ansiAt(25),
    'terminal.ansiGreen': ansiAt(145),
    'terminal.ansiYellow': ansiAt(95),
    'terminal.ansiBlue': ansiAt(250),
    'terminal.ansiMagenta': ansiAt(330),
    'terminal.ansiCyan': ansiAt(195),
    'terminal.ansiWhite': isLight ? chrome.lineNumber : chrome.sidebarFg,
    'terminal.ansiBrightBlack': isLight
      ? oklchToHex({ L: 0.45, C: 0.02, h: chrome.hue })
      : chrome.indentGuide,
    'terminal.ansiBrightRed': ansiAt(25, 0.85),
    'terminal.ansiBrightGreen': ansiAt(145, 0.88),
    'terminal.ansiBrightYellow': ansiAt(95, 0.9),
    'terminal.ansiBrightBlue': ansiAt(250, 0.83),
    'terminal.ansiBrightMagenta': ansiAt(330, 0.85),
    'terminal.ansiBrightCyan': ansiAt(195, 0.9),
    'terminal.ansiBrightWhite': chrome.editorFg,
  };

  return {
    name: `${school.label}${isLight ? ' Light' : ''}`,
    type: variant,
    colors: {
      'activityBar.background': chrome.chromeBg,
      'activityBar.foreground': accentOnChrome,
      'activityBar.inactiveForeground': muted,
      'activityBar.border': chrome.border,
      'activityBarBadge.background': badgeBg,
      'activityBarBadge.foreground': onBadge,

      'titleBar.activeBackground': chrome.chromeBg,
      'titleBar.activeForeground': accentOnChrome,
      'titleBar.inactiveBackground': chrome.border,
      'titleBar.inactiveForeground': muted,

      'statusBar.background': chrome.chromeBg,
      'statusBar.foreground': '#FFFFFF',
      'statusBar.border': chrome.border,
      'statusBar.debuggingBackground': badgeBg,
      'statusBar.debuggingForeground': onBadge,
      'statusBar.noFolderBackground': chrome.chromeBg,
      'statusBarItem.remoteBackground': badgeBg,
      'statusBarItem.remoteForeground': onBadge,
      'statusBarItem.hoverBackground': chrome.active,

      'sideBar.background': chrome.sidebarBg,
      'sideBar.foreground': chrome.sidebarFg,
      'sideBar.border': chrome.border,
      'sideBarTitle.foreground': accentOnSidebar,
      'sideBarSectionHeader.background': chrome.chromeBg,
      'sideBarSectionHeader.foreground': accentOnChrome,

      'tab.activeBackground': chrome.tabActiveBg,
      'tab.activeForeground': accentOnTab,
      'tab.activeBorderTop': accentOnTab,
      'tab.inactiveBackground': chrome.border,
      'tab.inactiveForeground': muted,
      'tab.border': chrome.deep,
      'editorGroupHeader.tabsBackground': chrome.deep,

      'editor.background': chrome.editorBg,
      'editor.foreground': chrome.editorFg,
      'editorLineNumber.foreground': chrome.lineNumber,
      'editorLineNumber.activeForeground': accent,
      'editorCursor.foreground': accent,
      'editor.selectionBackground': `${accent}${selectionA}`,
      'editor.inactiveSelectionBackground': `${accent}${selectionB}`,
      'editor.lineHighlightBackground': `${chrome.lineHighlight}80`,
      'editorIndentGuide.background': chrome.indentGuide,
      'editorIndentGuide.activeBackground': accent,
      'editorWhitespace.foreground': chrome.whitespace,

      'editorWidget.background': chrome.widgetBg,
      'editorSuggestWidget.background': chrome.widgetBg,
      'editorSuggestWidget.selectedBackground': chrome.listActiveBg,
      'editorSuggestWidget.highlightForeground': accentOnList,

      'panel.background': chrome.sidebarBg,
      'panel.border': chrome.border,
      'panelTitle.activeBorder': accentOnSidebar,
      'panelTitle.activeForeground': accentOnSidebar,
      'panelTitle.inactiveForeground': isLight ? chrome.lineNumber : muted,

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

      'badge.background': badgeBg,
      'badge.foreground': onBadge,

      'list.activeSelectionBackground': chrome.listActiveBg,
      'list.activeSelectionForeground': accentOnList,
      'list.inactiveSelectionBackground': chrome.listInactiveBg,
      'list.hoverBackground': chrome.listHoverBg,
      'list.highlightForeground': accentOnList,

      'scrollbarSlider.background': `${chrome.scroll}80`,
      'scrollbarSlider.hoverBackground': `${chrome.scroll}B0`,
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
      // Const-declared variables — which is most variables in modern JS/TS,
      // via the grammar's variable.other.constant and the semantic-token
      // mapping for variable.readonly — take the constant family, not the
      // accent, so `const` (keyword) and the name it declares never read as
      // the same colour.
      { scope: ['variable.other.constant'], settings: { foreground: s.constant } },
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

const contributions = schools.flatMap((school) =>
  ['dark', 'light'].map((variant) => {
    const isLight = variant === 'light';
    const theme = buildTheme(school, variant);
    const file = `themes/${school.slug}${isLight ? '-light' : ''}-color-theme.json`;
    writeFileSync(join(root, file), `${JSON.stringify(theme, null, 2)}\n`);
    return {
      label: `College Colors: ${school.label}${isLight ? ' Light' : ''}`,
      uiTheme: isLight ? 'vs' : 'vs-dark',
      path: `./${file}`,
    };
  }),
);

const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.contributes = { ...pkg.contributes, themes: contributions };
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

console.log(`Generated ${contributions.length} themes and updated contributes.themes.`);
