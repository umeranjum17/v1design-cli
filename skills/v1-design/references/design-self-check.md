# Design self-check (generic UI hygiene)

Read this before judging any UI you built. It is a general "does this look
intentional and consistent" checklist — common-sense design hygiene any good
designer applies. The authoritative WOW verdict comes from `v1design grade`.

Default verdict before checks pass is REJECT. Finalize only on a clean pass.

## Coherence
- One coherent palette. Colors come from the design tokens, not ad-hoc hex
  values sprinkled through the markup.
- A single focal accent, used sparingly — roughly one peak per screen. A second
  loud accent competing for attention reads as unfinished.
- Consistent type scale and spacing. Headings, body, and captions follow a clear
  hierarchy; spacing uses a consistent rhythm rather than arbitrary values.

## Real, not placeholder
- Real, domain-specific content. No "lorem ipsum", no "Title goes here".
- Where data is shown, handle the empty, loading, and error states — not just the
  happy path.
- Icon-only buttons have accessible labels; images have alt text.

## Structure
- Every distinct screen is its own real route, not a tab-state branch inside one
  file pretending to be multiple screens.
- Web: the app owns the full viewport and adapts to wide, normal, and narrow
  widths. A fixed-width shell with exposed whitespace on a wide browser is wrong.
- Mobile: native feel — safe-area respected, a shared tab bar/chrome built once,
  comfortable touch targets, scrollable where content overflows.

## It actually works
- Builds clean and runs. Every route returns a real page (not an error overlay or
  a blank body). No console errors on load.
- Fonts actually load (the intended display + body faces render, not a fallback).

## How to act on a miss
- Build/route failure → `v1design verify <dir> --heal`.
- Looks off but builds → screenshot each route, run `v1design grade <dir>`, and
  fix what it reports. Keep iterating until it passes; never finalize on a fail.
