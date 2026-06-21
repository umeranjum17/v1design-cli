# Design self-check (harsh — default REJECT)

Read this before judging any UI you built or ported. Be strict: if anything is even
slightly subpar, fix it and re-check. "It renders" is not "it passes." The authoritative
WOW verdict is `v1design grade`; this checklist is what you fix BEFORE asking for it.

## Builds & runs
- Clean build; every route serves a real page (not an error overlay / blank body).
- No console errors on load or after one interaction per route.

## Full viewport (no fixed-width shell)
- The app owns the FULL browser width. No black/empty gutter on a wide screen, no
  left-aligned fixed block. The studio frames screens at a fixed artboard (e.g.
  `width: 1440`) — neutralize it: root fills 100% width, full-bleed or
  max-width-and-centered, adapts at 1920 / 1280 / 390.
- The page background is the design background, never bare black.

## Navigation connected
- Every nav item / tab / primary CTA that points at another screen ROUTES there
  (Next `<Link>`/`router.push`, expo-router `<Link>`/`router.push`). A clickable-looking
  nav that does nothing is a hard fail.

## Fonts load
- The intended display + body faces render — not a system fallback. Non-Google families
  (Clash Display, General Sans, PP Editorial New, …) get the closest available font,
  aliased to the original family name so the look is preserved. Confirm the rendered
  `font-family`, don't assume.

## Contrast & legibility (best standards)
- WCAG AA: body ≥ 4.5:1, large text ≥ 3:1 against its actual background. Add a scrim if
  text sits over imagery. No washed-out labels.
- Kill porting artifacts: default-blue links, stray `::selection`/focus highlights, wrong
  focus-ring color → restyle on-brand (selection = accent, links inherit, ring = design token).

## Tab bar / chrome
- Intentional and on-theme: real icons + labels, a SINGLE bar (never doubled), correct
  active/inactive states. No placeholder glyphs (`⏷`), no bare labels where the design had
  icons. Built once and reused.

## Content & match
- Real, domain-specific content (no lorem; empty/loading/error states where data shows).
- Mobile: native feel (SafeArea, OS status bar, ≥44pt targets, real RN primitives — never
  a screenshot as a screen).
- Screenshot each route and run `v1design grade` — fix everything it flags, loop until pass.
