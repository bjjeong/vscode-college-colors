// Renders a mock VS Code window per theme so the palettes can be eyeballed,
// not just measured. Outputs SVG; convert to PNG with rsvg-convert.
//
//   node scripts/preview.mjs            -> images/previews/<slug>.svg
//   node scripts/preview.mjs --contact  -> also writes a contact-sheet.svg grid

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const W = 640;
const H = 400;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// A code sample chosen to exercise every token role the themes define.
const SAMPLE = [
  [['// tuition is measured in regret', 'comment']],
  [],
  [
    ['import', 'keywordControl'],
    [' { ', 'punctuation'],
    ['Stadium', 'type'],
    [' } ', 'punctuation'],
    ['from', 'keywordControl'],
    [' ', 'variable'],
    ["'./venues'", 'string'],
    [';', 'punctuation'],
  ],
  [],
  [
    ['export', 'keywordControl'],
    [' ', 'variable'],
    ['class', 'keyword'],
    [' ', 'variable'],
    ['Wolverine', 'type'],
    [' ', 'variable'],
    ['extends', 'keyword'],
    [' ', 'variable'],
    ['Stadium', 'type'],
    [' {', 'punctuation'],
  ],
  [
    ['  ', 'variable'],
    ['capacity', 'property'],
    [' = ', 'punctuation'],
    ['107601', 'number'],
    [';', 'punctuation'],
  ],
  [
    ['  ', 'variable'],
    ['ranked', 'property'],
    [' = ', 'punctuation'],
    ['true', 'constant'],
    [';', 'punctuation'],
  ],
  [],
  [
    ['  ', 'variable'],
    ['fightSong', 'function'],
    ['(', 'punctuation'],
    ['verse', 'variable'],
    [') {', 'punctuation'],
  ],
  [
    ['    ', 'variable'],
    ['if', 'keywordControl'],
    [' (', 'punctuation'],
    ['!', 'punctuation'],
    ['verse', 'variable'],
    [') ', 'punctuation'],
    ['throw', 'keywordControl'],
    [' ', 'variable'],
    ['new', 'keyword'],
    [' ', 'variable'],
    ['Error', 'invalid'],
    ['(', 'punctuation'],
    ["'no verse'", 'string'],
    [');', 'punctuation'],
  ],
  [
    ['    ', 'variable'],
    ['return', 'keywordControl'],
    [' `', 'string'],
    ['Hail to the ', 'string'],
    ['${', 'punctuation'],
    ['verse', 'variable'],
    ['}', 'punctuation'],
    ['`', 'string'],
    [';', 'punctuation'],
  ],
  [['  }', 'punctuation']],
  [['}', 'punctuation']],
];

function tokenColor(theme, role) {
  const find = (scope) => {
    const tc = theme.tokenColors.find((t) =>
      (Array.isArray(t.scope) ? t.scope : [t.scope]).includes(scope),
    );
    return tc?.settings?.foreground;
  };
  const map = {
    comment: 'comment',
    keyword: 'keyword',
    keywordControl: 'keyword.control',
    string: 'string',
    number: 'constant.numeric',
    constant: 'constant.language',
    function: 'entity.name.function',
    type: 'entity.name.class',
    property: 'support.type.property-name',
    punctuation: 'punctuation',
    variable: 'variable',
    invalid: 'invalid',
  };
  return find(map[role]) ?? theme.colors['editor.foreground'];
}

function render(theme) {
  const c = theme.colors;
  const AB = 44; // activity bar width
  const SB = 150; // sidebar width
  const TITLE = 28;
  const TAB = 30;
  const STATUS = 22;
  const editorX = AB + SB;
  const editorY = TITLE + TAB;

  const lines = SAMPLE.map((line, i) => {
    const y = editorY + 24 + i * 18;
    if (line.length === 0) return '';
    let x = editorX + 44;
    const spans = line
      .map(([text, role]) => {
        const fill = tokenColor(theme, role);
        const style = role === 'comment' ? ' font-style="italic"' : '';
        const weight =
          role === 'type' || role === 'keywordControl' ? ' font-weight="bold"' : '';
        const span = `<text x="${x}" y="${y}" fill="${fill}"${style}${weight} xml:space="preserve">${esc(
          text,
        )}</text>`;
        x += text.length * 7.22;
        return span;
      })
      .join('');
    const num = `<text x="${editorX + 30}" y="${y}" fill="${
      c['editorLineNumber.foreground']
    }" text-anchor="end">${i + 1}</text>`;
    return num + spans;
  }).join('');

  const sidebarRows = ['src', '  index.ts', '  venues.ts', 'package.json', 'README.md']
    .map((label, i) => {
      const y = TITLE + 46 + i * 20;
      const active = i === 1;
      const bg = active
        ? `<rect x="${AB}" y="${y - 13}" width="${SB}" height="20" fill="${
            c['list.activeSelectionBackground']
          }"/>`
        : '';
      const fill = active ? c['list.activeSelectionForeground'] : c['sideBar.foreground'];
      return `${bg}<text x="${AB + 12}" y="${y}" fill="${fill}">${esc(label)}</text>`;
    })
    .join('');

  const dots = [0, 1, 2]
    .map((i) => `<circle cx="${AB / 2}" cy="${TITLE + 24 + i * 30}" r="6" fill="${
      i === 0 ? c['activityBar.foreground'] : c['activityBar.inactiveForeground']
    }"/>`)
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12">
  <rect width="${W}" height="${H}" fill="${c['editor.background']}"/>

  <rect x="0" y="0" width="${W}" height="${TITLE}" fill="${c['titleBar.activeBackground']}"/>
  <text x="12" y="18" fill="${c['titleBar.activeForeground']}" font-size="11" font-weight="bold">${esc(
    theme.name,
  )}</text>

  <rect x="0" y="${TITLE}" width="${AB}" height="${H - TITLE - STATUS}" fill="${
    c['activityBar.background']
  }"/>
  ${dots}
  <circle cx="${AB / 2 + 9}" cy="${TITLE + 18}" r="6" fill="${c['activityBarBadge.background']}"/>
  <text x="${AB / 2 + 9}" y="${TITLE + 22}" fill="${
    c['activityBarBadge.foreground']
  }" font-size="9" text-anchor="middle">3</text>

  <rect x="${AB}" y="${TITLE}" width="${SB}" height="${H - TITLE - STATUS}" fill="${
    c['sideBar.background']
  }"/>
  <text x="${AB + 12}" y="${TITLE + 20}" fill="${
    c['sideBarTitle.foreground']
  }" font-size="10" font-weight="bold">EXPLORER</text>
  ${sidebarRows}

  <rect x="${editorX}" y="${TITLE}" width="${W - editorX}" height="${TAB}" fill="${
    c['editorGroupHeader.tabsBackground']
  }"/>
  <rect x="${editorX}" y="${TITLE}" width="110" height="${TAB}" fill="${
    c['tab.activeBackground']
  }"/>
  <rect x="${editorX}" y="${TITLE}" width="110" height="2" fill="${c['tab.activeBorderTop']}"/>
  <text x="${editorX + 14}" y="${TITLE + 19}" fill="${c['tab.activeForeground']}">index.ts</text>
  <text x="${editorX + 128}" y="${TITLE + 19}" fill="${c['tab.inactiveForeground']}">venues.ts</text>

  ${lines}

  <rect x="0" y="${H - STATUS}" width="${W}" height="${STATUS}" fill="${
    c['statusBar.background']
  }"/>
  <text x="12" y="${H - 7}" fill="${c['statusBar.foreground']}" font-size="10">main*</text>
  <text x="${W - 12}" y="${H - 7}" fill="${
    c['statusBar.foreground']
  }" font-size="10" text-anchor="end">TypeScript</text>
</svg>
`;
}

const { schools } = JSON.parse(readFileSync(join(root, 'palettes/schools.json'), 'utf8'));
mkdirSync(join(root, 'images/previews'), { recursive: true });

for (const school of schools) {
  const theme = JSON.parse(
    readFileSync(join(root, `themes/${school.slug}-color-theme.json`), 'utf8'),
  );
  writeFileSync(join(root, `images/previews/${school.slug}.svg`), render(theme));
}

console.log(`Rendered ${schools.length} previews to images/previews/.`);
