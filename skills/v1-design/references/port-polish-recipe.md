# Port & polish — the one-shot recipe (no Playwright required)

The scaffold is a fixed-artboard studio export. These are the exact, repeatable edits
that turn it into a full-viewport, connected, real app — and how to verify each WITHOUT
a browser/Playwright (curl + grep + the build only). Do ALL of them before grading.
A browser is a nice-to-have for eyeballing; it is NOT required to pass Step 3.

> Golden rule: every fix here is in the CODE. If you can't open a browser, you can still
> one-shot a passing build by applying these and checking with `curl` + `grep` + `next build`.

---

## 1. Kill the fixed-width shell (full viewport) — AND actually fill the width
The studio wraps each screen in a fixed artboard. Find it and neutralize it:

```
grep -rn "width: *PAGE_W\|width: *1440\|width: *1280\|maxWidth: *1440\|w-\[1440px\]\|PAGE_W *=" components app
```
- Replace the root wrapper `width: 1440 / PAGE_W` with `width: "100%"`.
- **A centered ~1130px column on flat white at 1920 is STILL A FAIL.** Removing the fixed
  width but leaving a narrow column floating in dead whitespace is the #1 thing the jury
  rejects. The page must look DESIGNED for a wide screen, not a stretched 1280:
  - Section **backgrounds go full-bleed** (edge to edge); only the inner *text/content*
    is constrained — use a generous content width (`maxWidth: clamp(1100px, 86vw, 1480px)`),
    centered, with fluid padding `padding: "0 clamp(24px, 5vw, 72px)"`.
  - Give the page **structure that fills the void**: alternating section bands, at least
    one full-bleed **dark "structural peak"** section for depth, a genuinely large-scale
    hero (display ~4× body), imagery/cards that reach toward the edges. Flat near-white
    edge-to-edge with a skinny centered column = reject.
- In `globals.css`, guarantee the page bg + no sideways scroll:
  ```css
  html, body { width: 100%; max-width: 100%; overflow-x: clip; }
  body { background: var(--background); }   /* never bare black */
  ```
- VERIFY (no browser): no `width: 1440` left; each top-level `<section>` background spans
  the viewport (no `maxWidth` on the section element itself — only on an inner content div).

VERIFY (no browser):
- `grep -rn "1440\|PAGE_W" components app` → returns nothing (or only comments).
- The 390px overflow trap is multi-column grids and decorative circles. Search them out:
  `grep -rn "gridTemplateColumns\|position: *\"absolute\"\|borderRadius: *\"50%\"" components`
  Every multi-col grid needs a narrow-viewport collapse (see §5). Every decorative
  absolutely-positioned blob must sit inside a parent with `overflow: hidden`/`clip`.

## 2. Connect the navigation (pages CONNECTED)
The scaffold's nav is dead `<a href="#">`. Wire every item to a real route.
- Build the nav + footer ONCE in a shared `components/SiteChrome.tsx`; import it on every
  page. Do not copy-paste the bar into each screen (the scaffold does — de-dupe it).
- Web: `import Link from "next/link"` and replace each `<a href="#">Label</a>` with
  `<Link href="/real-route">Label</Link>`. Active state from `usePathname()`.
- Mobile: expo-router `<Link href="/route">` / `router.push`, tab bar in `app/(tabs)/_layout.tsx`.
- Make a route file under `app/` for EVERY nav target. A nav label with no matching route
  is a hard fail.

VERIFY (no browser):
- `grep -rn "href=\"#\"\|href='#'" app components` → returns NOTHING.
- `grep -rn "<Link\|router.push" app components` → present on every screen's nav.
- Every label in the nav has a matching `app/<route>/page.tsx`.

## 3. Load the fonts for real
- Identify the families: `grep -rn "font-display\|font-sans\|fontFamily" app/globals.css`.
- Wire them through the framework, not a bare CDN `<link>` alone:
  - Web (Next): `next/font/google` in `app/layout.tsx`, expose as CSS vars
    (`variable: "--font-display"`), and set `--font-display: var(--font-display), <fallback>`
    in `globals.css`. Put the `${font.variable}` classes on `<html>`.
  - Non-Google display faces (Clash Display, General Sans, PP Editorial New, Satoshi…):
    pick the closest Google face (e.g. Clash→Space Grotesk, General Sans→Plus Jakarta Sans,
    PP Editorial→Fraunces/Playfair) and alias it to the original `--font-*` variable name so
    every `fontFamily: "var(--font-display)"` still resolves.
  - Mobile: `expo-font` `useFonts`, gate render until loaded.
- NOTE: `v1design verify` greps the layout for a Google Fonts `<link>`. If you use
  `next/font` (preferred), ALSO add a redundant
  `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=...">` in `<head>`
  so the deterministic check passes. They coexist; next/font is what actually applies.

VERIFY (no browser): `v1design verify <dir>` prints `✓ fonts wired`.

## 4. Contrast & artifacts (WCAG AA, on-brand)
Add to `globals.css` (these are the porting artifacts that always leak):
```css
::selection { background: color-mix(in oklch, var(--primary) 26%, transparent); color: var(--foreground); }
a { color: inherit; }                       /* kill default-blue links */
a:focus-visible, button:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
```
- No washed-out labels; if text sits over a photo, add a scrim
  (`linear-gradient(...rgb(0 0 0 /.55)... )`).
- Light text needs a dark ground and vice-versa; if you introduce a dark "structural peak"
  band, recolor its inner cards/labels for contrast — don't leave `var(--muted-foreground)`
  on a navy background.

## 5. Bake the chrome + responsiveness once
- ONE nav bar, ONE footer, reused. Real icons + labels, correct active/inactive states.
- Give every fixed multi-column grid a collapse, e.g. in `globals.css`:
  ```css
  @media (max-width: 1000px){ .auto-grid{ grid-template-columns:repeat(2,1fr)!important } }
  @media (max-width: 900px){ .hero-grid,.band-grid,.book-grid{ grid-template-columns:1fr!important } }
  @media (max-width: 760px){ .footer-grid{ grid-template-columns:1fr 1fr!important } }
  @media (max-width: 560px){ .auto-grid,.footer-grid{ grid-template-columns:1fr!important } }
  ```
  Add the class to each grid that is otherwise `repeat(N,1fr)` / a fixed two-col split.
- On narrow widths, collapse nav text to icons (`.navlabel{display:none}` under a query).

## 6. Real content
Replace every dental/placeholder string with the target domain's real content (names,
prices, dates, copy). No lorem, no leftover reference-domain words
(`grep -rin "lorem\|<the old domain word>" app components`).

## 7. Premium ceiling — AUTO-REJECTS the jury WILL catch (self-grade harshly)
"Builds + full-width + nav wired" is the FLOOR, not done. A harsh jury rejects anything
that is merely competent. Before declaring done, hunt down and fix every one of these —
they are the exact failure modes that get rejected:

- **Centered narrow column on flat white at 1920** → the desktop doesn't own its viewport.
  Fix per §1 (full-bleed sections, structural bands, one dark peak, big hero).
- **Display/hero headline with crushed leading at desktop** → `clamp()` font-size with a
  default `line-height` makes lines collide on wide screens. PIN line-height on every
  display heading (e.g. `lineHeight: 1.02`) and re-check at 1920 — the #1 element must look
  intentional, not like a CSS bug. (It often looks fine at 390 but broken at 1920.)
- **Garbled / repetitive copy** → no broken clauses, no key word repeated 3× in two
  sentences ("vet… vet… vet"). Write clean, distinctive, proofread product copy.
- **Faked imagery** → never a "before/after" that is the SAME image mirrored. Use distinct
  images, or drop the gimmick. A discerning eye catches it instantly and it kills credibility.
- **Washed-out eyebrows/captions/labels** → tracked-out light-grey micro-caps below AA.
  Bump muted greys toward `--foreground` until body ≥ 4.5:1, large ≥ 3:1.
- **Mobile CTA clipped / nav crammed** → below ~640px a CTA pill must not run off the edge;
  collapse the nav to a hamburger (or hide labels intentionally), never crammed unlabeled icons.
- **Flat, depth-less ground** → a single near-white everywhere with one blue accent reused on
  every heading is "stock AI editorial." Add depth: one dark structural section, layered cards
  with real shadow/elevation, a rationed accent with calm valleys, a wide type ramp.
- **A one-trick gimmick carrying the whole page** → the design needs more than a single widget.

Self-grade against `design-self-check.md` AND imagine a harsh founder/jury looking at the
1920, 1280, and 390 renders. If any of the above is present, it is NOT done — fix and re-check.

---

## The loop (deterministic, browser-optional)
1. `next build` (web) / `npx expo export --platform web` (mobile) → must compile.
2. `v1design verify <dir> --heal` → build ok + every route 200 + fonts/tokens/components ✓.
3. The grep gates in §1–§3 above all clean.
4. If a browser IS available, eyeball at 1920 / 1280 / 390 and confirm no sideways scroll
   (`document.documentElement.scrollWidth <= innerWidth`). If not, the §1/§5 grid-collapse +
   `overflow-x: clip` edits are what prevent the 390 overflow — apply them by construction.
5. `v1design grade <dir>` is the visual oracle; treat its notes as a craft fix-list
   (blow up the hero, commit ONE saturated accent, give the page one dark structural peak,
   widen the type ramp). Apply the ones that hold for your screens.

Finalize ONLY when the build is green, every route 200, the grep gates are clean, and the
chrome/fonts/contrast edits above are all in. "It renders" is not "it passes."
```
