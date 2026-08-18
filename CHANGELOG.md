# Change Log

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
