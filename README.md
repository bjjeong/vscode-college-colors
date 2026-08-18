# College Colors

Dark VS Code themes in the colors of 29 well-known universities — one extension, one theme per school.

![College Colors preview](https://raw.githubusercontent.com/bjjeong/vscode-college-colors/main/images/hero.png)

Each school's **official brand palette** drives the editor chrome — activity bar, status bar, title bar, tabs — while the syntax colors are generated to stay readable against it. Every theme is checked against WCAG contrast floors and a perceptual-separation floor before it ships, so no two token types end up looking alike.

## Installation

1. Open VS Code.
2. Open the **Extensions** panel (`Cmd+Shift+X` / `Ctrl+Shift+X`).
3. Search for **"College Colors"** and click **Install**.
4. Command Palette (`Cmd/Ctrl+Shift+P`) → **Preferences: Color Theme** → pick your school.

Or from the command line:

```bash
code --install-extension bjjeong.college-colors
```

## Schools included

Every theme is listed in the picker as **College Colors: _School_**.

| | | |
| --- | --- | --- |
| [Alabama Crimson Tide](images/previews/alabama.png) | [Auburn Tigers](images/previews/auburn.png) | [Clemson Tigers](images/previews/clemson.png) |
| [Columbia Lions](images/previews/columbia.png) | [Florida Gators](images/previews/florida.png) | [Florida State Seminoles](images/previews/florida-state.png) |
| [Georgia Bulldogs](images/previews/georgia.png) | [Harvard Crimson](images/previews/harvard.png) | [Iowa Hawkeyes](images/previews/iowa.png) |
| [LSU Tigers](images/previews/lsu.png) | [Michigan Wolverines](images/previews/michigan.png) | [Michigan State Spartans](images/previews/michigan-state.png) |
| [MIT Engineers](images/previews/mit.png) | [Nebraska Cornhuskers](images/previews/nebraska.png) | [Northwestern Wildcats](images/previews/northwestern.png) |
| [Notre Dame Fighting Irish](images/previews/notre-dame.png) | [NYU Violets](images/previews/nyu.png) | [Ohio State Buckeyes](images/previews/ohio-state.png) |
| [Oklahoma Sooners](images/previews/oklahoma.png) | [Oregon Ducks](images/previews/oregon.png) | [Penn Quakers](images/previews/penn.png) |
| [Penn State Nittany Lions](images/previews/penn-state.png) | [Tennessee Volunteers](images/previews/tennessee.png) | [Texas A&M Aggies](images/previews/texas-am.png) |
| [Texas Longhorns](images/previews/texas.png) | [UCLA Bruins](images/previews/ucla.png) | [USC Trojans](images/previews/usc.png) |
| [Washington Huskies](images/previews/washington.png) | [Wisconsin Badgers](images/previews/wisconsin.png) | |

Don't see your school? [Open an issue](https://github.com/bjjeong/vscode-college-colors/issues) — adding one is a ten-line change.

## How the themes are built

The themes aren't maintained by hand. Each school is a small palette entry:

```json
{
  "slug": "michigan",
  "label": "Michigan Wolverines",
  "dark": "#00274C",
  "accent": "#FFCB05",
  "source": "brand.umich.edu — Michigan Blue / Maize"
}
```

`npm run build` expands that into a full theme and rewrites `contributes.themes`. The generator works in [OKLCH](https://bottosson.github.io/posts/oklab/) so it can move lightness and chroma independently without the hue drift you get from HSL, and it applies a few rules:

- **The chrome keeps the school's exact official hex.** That's what makes a theme recognizably Michigan or Alabama.
- **The editor background stays a dark, barely-tinted neutral** across all schools. It's the surface you stare at all day; the brand color belongs in the chrome, not behind your code.
- **Syntax colors may deviate from the brand palette to stay readable.** Alabama crimson and Penn red are too dark to read as keywords on a dark background, so they get lifted until they clear their contrast floor.
- **Every token clears a WCAG contrast floor** against the editor background — 4.5:1 for code, 3.5:1 for comments.
- **No two token colors are perceptually confusable.** The floor is ΔE 0.052 in OKLab, calibrated against the tightest pair in a hand-tuned theme.
- **Errors never read as keywords.** Normally red — but on a red-brand school that would collide, so the error color swings to magenta and gains an underline as a color-independent signal.

`npm test` builds and then validates all 29. It exits non-zero if any theme fails, so a bad palette can't be packaged.

### Adding a school

1. Append an entry to `palettes/schools.json`.
2. `npm test`
3. `node scripts/preview.mjs` to render a mock editor window for eyeballing.

If the accent is too dark, too close to the comment color, or collides with the error color, the validator will say so by name.

## Contributing

Issues and pull requests welcome at
[github.com/bjjeong/vscode-college-colors](https://github.com/bjjeong/vscode-college-colors).

## Trademark note

This extension is an independent, unaffiliated project. It is not endorsed by, sponsored by, or associated with any of the universities named. School names are used descriptively, to identify which color palette a theme reproduces. No institutional logos or marks are included — the extension icon is an abstract palette. Colors themselves are not protectable subject matter.

## License

[MIT](LICENSE)
