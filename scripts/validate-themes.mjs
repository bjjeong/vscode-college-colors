// Checks every generated theme for the properties the generator is supposed to
// guarantee. Exits non-zero on any failure, so `npm test` gates the package.
//
//   node scripts/validate-themes.mjs [--verbose]
//
// Checks, per theme:
//   1. Every syntax token clears its WCAG contrast floor on the editor background.
//   2. No two syntax roles are visually confusable (close in both hue and lightness).
//   3. Foreground/background pairs in the chrome are legible.
//   4. Text on the accent (buttons, badges) is legible.
//   5. The error colour is distinguishable from the keyword colour.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contrastRatio, deltaE } from './color.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const verbose = process.argv.includes('--verbose');

const FLOORS = { token: 4.5, comment: 3.5, ui: 3.0, onAccent: 4.5 };

// Perceptual floor between two syntax colours, in OKLab deltaE. Measured off the
// hand-tuned Michigan Wolverines theme, whose closest distinct pair
// (entity.name.class vs entity.other.attribute-name) sits at 0.0528. Holding the
// generated themes to that number means "no worse separated than the original".
const MIN_DELTA_E = 0.052;

const scopeKey = (tc) => (Array.isArray(tc.scope) ? tc.scope[0] : tc.scope);

let failures = 0;
const fail = (theme, msg) => {
  failures += 1;
  console.error(`  ✗ [${theme}] ${msg}`);
};

const files = readdirSync(join(root, 'themes')).filter((f) => f.endsWith('.json')).sort();
if (files.length === 0) {
  console.error('No themes found — run `npm run build` first.');
  process.exit(1);
}

for (const file of files) {
  const theme = JSON.parse(readFileSync(join(root, 'themes', file), 'utf8'));
  const name = theme.name;
  const bg = theme.colors['editor.background'];
  const results = [];

  // 1. Token contrast on the editor background.
  for (const tc of theme.tokenColors) {
    const fg = tc.settings.foreground;
    if (!fg) continue;
    const key = scopeKey(tc);
    const floor = key === 'comment' ? FLOORS.comment : FLOORS.token;
    const ratio = contrastRatio(fg, bg);
    results.push({ key, fg, ratio, floor });
    if (ratio < floor) {
      fail(name, `${key} ${fg} contrast ${ratio.toFixed(2)} < ${floor} on ${bg}`);
    }
  }

  // 2. Mutually distinguishable syntax roles.
  const swatches = theme.tokenColors
    .filter((tc) => tc.settings.foreground)
    .map((tc) => ({ key: scopeKey(tc), hex: tc.settings.foreground }));

  let tightest = { d: Infinity };
  for (let i = 0; i < swatches.length; i += 1) {
    for (let j = i + 1; j < swatches.length; j += 1) {
      const a = swatches[i];
      const b = swatches[j];
      // Identical values are deliberate aliases — tags reuse the function
      // colour, constants and headings reuse the accent.
      if (a.hex === b.hex) continue;
      const d = deltaE(a.hex, b.hex);
      if (d < tightest.d) tightest = { d, a, b };
      if (d < MIN_DELTA_E) {
        fail(name, `${a.key} ${a.hex} and ${b.key} ${b.hex} differ by only ΔE ${d.toFixed(4)}`);
      }
    }
  }

  // 3. Chrome legibility.
  const chromeChecks = [
    ['activityBar.foreground', 'activityBar.background', FLOORS.ui],
    ['activityBar.inactiveForeground', 'activityBar.background', FLOORS.ui],
    ['statusBar.foreground', 'statusBar.background', FLOORS.token],
    ['sideBar.foreground', 'sideBar.background', FLOORS.token],
    ['tab.activeForeground', 'tab.activeBackground', FLOORS.ui],
    ['tab.inactiveForeground', 'tab.inactiveBackground', FLOORS.ui],
    ['editorLineNumber.foreground', 'editor.background', FLOORS.ui],
    ['terminal.foreground', 'terminal.background', FLOORS.token],
  ];
  for (const [fgKey, bgKey, floor] of chromeChecks) {
    const fg = theme.colors[fgKey];
    const bgc = theme.colors[bgKey];
    if (!fg || !bgc) continue;
    const ratio = contrastRatio(fg, bgc);
    if (ratio < floor) {
      fail(name, `${fgKey} ${fg} on ${bgKey} ${bgc} = ${ratio.toFixed(2)} < ${floor}`);
    }
  }

  // 4. Text sitting on the accent.
  for (const [fgKey, bgKey] of [
    ['button.foreground', 'button.background'],
    ['badge.foreground', 'badge.background'],
    ['activityBarBadge.foreground', 'activityBarBadge.background'],
  ]) {
    const ratio = contrastRatio(theme.colors[fgKey], theme.colors[bgKey]);
    if (ratio < FLOORS.onAccent) {
      fail(name, `${fgKey} on ${bgKey} = ${ratio.toFixed(2)} < ${FLOORS.onAccent}`);
    }
  }

  // 5. Errors must be clearly separable from keywords, since on a red-brand
  //    school both want to be red.
  const keyword = theme.tokenColors.find((tc) => scopeKey(tc) === 'keyword')?.settings.foreground;
  const invalidTc = theme.tokenColors.find((tc) => scopeKey(tc) === 'invalid');
  if (keyword && invalidTc) {
    const d = deltaE(keyword, invalidTc.settings.foreground);
    const underlined = (invalidTc.settings.fontStyle ?? '').includes('underline');
    if (d < 0.08 && !underlined) {
      fail(
        name,
        `invalid ${invalidTc.settings.foreground} vs keyword ${keyword} is ΔE ${d.toFixed(
          4,
        )} with no underline fallback`,
      );
    }
  }

  if (verbose) {
    const worst = results.sort((a, b) => a.ratio - b.ratio)[0];
    console.log(
      `  ${name.padEnd(28)} bg ${bg}  min contrast ${worst.ratio.toFixed(2)} (${worst.key})` +
        `  min ΔE ${tightest.d.toFixed(4)}`,
    );
  }
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed across ${files.length} themes.`);
  process.exit(1);
}
console.log(`All checks passed for ${files.length} themes.`);
