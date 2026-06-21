# Port & polish — the one-shot recipe (no Playwright required)

The scaffold is a fixed-artboard studio export. These are the exact, repeatable edits
that turn it into a full-viewport, connected, real app — and how to verify each WITHOUT
a browser/Playwright (curl + grep + the build only). Do ALL of them before grading.
A browser is a nice-to-have for eyeballing; it is NOT required to pass Step 3.

> Golden rule: every fix here is in the CODE. If you can't open a browser, you can still
> one-shot a passing build by applying these and checking with `curl` + `grep` + `next build`.

---

## 1. Kill the fixed-width shell (full viewport)
The studio wraps each screen in a fixed artboard. Find it and neutralize it:

```
grep -rn "width: *PAGE_W\|width: *1440\|width: *1280\|maxWidth: *1440\|w-\[1440px\]\|PAGE_W *=" components app
```
- Replace the root wrapper `width: 1440 / PAGE_W` with `width: "100%"`.
- Keep inner content readable with `maxWidth: 1200` (or the design's content width) +
  `margin: "0 auto"` on each section — never a left-aligned fixed block.
- Use fluid side padding: `padding: "0 clamp(20px, 4vw, 44px)"` instead of a fixed `44px`.
- In `globals.css`, guarantee the page bg + no sideways scroll:
  ```css
  html, body { width: 100%; max-width: 100%; overflow-x: clip; }
  body { background: var(--background); }   /* never bare black */
  ```

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
