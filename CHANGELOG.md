# Change Log

## [1.3.0]

Added Bucknell Bison and Franklin & Marshall Diplomats — 53 schools,
106 themes total.

## [1.2.1]

Variables declared with `const` (the grammar's `variable.other.constant`,
reinforced by semantic highlighting's `variable.readonly`) no longer share
the keyword accent. They now take the constant-family colour, so in
`const codeLength = ...` the keyword and the name it declares read as two
different things — matching the convention of mainstream themes.

## [1.2.0]

Added 22 schools — 51 schools, 102 themes total — chosen for athletic
prominence, academic standing, and enrollment size:

Arizona, Arizona State, Brown, California (Berkeley), Caltech, Chicago,
Cornell, Dartmouth, Duke, Georgia Tech, Illinois, Johns Hopkins, Kansas,
Kentucky, Miami, Minnesota, North Carolina, Princeton, Purdue, Stanford,
UCF, Yale.

With Yale, Princeton, Cornell, Brown, and Dartmouth joining Harvard, Penn,
and Columbia, all eight Ivy League schools are now included. Every new
school ships both a dark and a light variant and passes the same validation
gate as the rest.

## [1.1.0]

Added a light variant for every school — 29 new themes, 58 total, picked as
**College Colors: _School_ Light**.

The light variants keep the school's branded chrome (activity bar, status bar,
title bar, tab rail) and flip the working surfaces to a near-white tinted
neutral. The ink — keywords, cursor, accents in the editor — comes from the
school's dark brand color when it has a chromatic one (navy for Michigan,
purple for LSU), otherwise from the bright accent darkened until it clears its
contrast floor. All variants pass the same validation gate as the dark themes:
WCAG contrast floors, perceptual separation between token colors, and the
error-never-reads-as-keyword guarantee.

## [1.0.0]

Initial release — 29 school themes generated from official brand palettes.

Alabama, Auburn, Clemson, Columbia, Florida, Florida State, Georgia, Harvard,
Iowa, LSU, Michigan, Michigan State, MIT, Nebraska, Northwestern, Notre Dame,
NYU, Ohio State, Oklahoma, Oregon, Penn, Penn State, Tennessee, Texas,
Texas A&M, UCLA, USC, Washington, Wisconsin.

Every theme is generated in OKLCH from a school's brand colors and validated
before packaging: WCAG contrast floors on all tokens and chrome, a perceptual
separation floor between token colors, and a guarantee that the error color
never reads as a keyword.
