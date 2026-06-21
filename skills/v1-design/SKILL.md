---
name: v1-design
description: Build a real, WOW-grade app from v-1.design — from a plain idea or a specific design reference — then gate the output until it is genuinely awesome. Use when the user says "use v1design to build ...", points at a v-1.design library/studio/share link or slug, asks to remix or clone v-1.design references, wants to add a screen to a v-1.design-derived app, or wants to search the v-1.design library. The skill drives discovery, scaffold, and a HARSH port-and-polish gate; the human stays in plain language.
---

# v-1.design — build it, then make it genuinely awesome

## What this skill does
You are the build-and-gate brain for v-1.design. The user's entire input is one
sentence ("use v1design to build X"). You discover or resolve a reference, scaffold
a real runnable app, then **port it to best standards and gate it hard** — it is not
done until it builds, runs, fills the viewport, the navigation actually works, fonts
load, contrast is clean, the tab bar/chrome is properly baked, and it matches the
reference. Never ask the user which command or flag to run; ask only for a genuine
taste fork.

Prefer the v1design MCP tools when available; otherwise use the CLI. Connect once with
`v1design connect` — never ask the user for an API key.

## Step 1 — read the intent: an idea, or a specific design?
- **Idea** ("a habit tracker", "a pet care app", "a landing like Linear but warmer") →
  DISCOVER hard before building. First reason about what a great version of this should
  LOOK like — domain, audience, mood, and the nearest world-class references — then spawn
  SEVERAL searches from different angles (the literal domain, adjacent domains, the
  aesthetic/mood, and the closest well-known product), broadening and narrowing keywords.
  Read the candidates, weigh them against that mental target, and DECIDE on the single
  strongest fit yourself (present a few directions only when not delegated).
  - `v1design library search "<idea>" --surface web --json` (run it a few times, varied
    queries) → then `v1design new "<idea>" --surface web|mobile` or `v1design scaffold <ref>`.
  - **No exact match? REVAMP the closest — do NOT regenerate.** If the library only has
    tangential designs, take the CLOSEST one and revamp it toward the target: scaffold it,
    then re-skin / remix / `vibe` it hard in Step 3 — `v1design remix <closest> <b>
    --system <closest> --out <dir>`, `v1design vibe "<intent toward the real domain>" --in
    <dir>`. The library is the asset; adapt what exists. Do NOT reach for `v1design create`
    to generate a brand-new design from scratch — only create-new if there is genuinely
    nothing in the neighborhood at all.
- **Specific design** (URL / slug / "the one I picked") → resolve and build AS-IS.
  - `v1design new "<url|slug>"`  or  `v1design scaffold <ref>`
- Infer surface: web → Next.js, mobile → Expo + React Native, unless the repo dictates.

## Step 2 — build
- New: `v1design scaffold <ref> --surface <web|mobile> --out <dir> --install`. For an
  idea, `v1design new` wraps search + scaffold.
- Remix: `v1design remix <a> <b> --system <a> --out <dir>`.
- The scaffold is a runnable BASELINE, not the finished app. It will have rough edges
  (a fixed-width frame, unwired nav, a fallback font, a plain tab bar). Step 3 is where
  YOU make it awesome — do not skip it and do not declare done on the raw scaffold.

## Step 3 — PORT & POLISH to best standards (the real job — be harsh)
Default verdict is **REJECT**. If ANYTHING is even slightly subpar, fix it, then
re-check. Hold every one of these — they are not optional.

**Read `references/port-polish-recipe.md` and apply it — it is the one-shot recipe.**
Every fix below lives in the CODE and is verifiable WITHOUT a browser (curl + grep +
`next build`). Do NOT assume Playwright/MCP is available — the recipe gives the
grep/curl checks that catch the same failures (fixed-width shell, 390px overflow, dead
`href="#"` nav, unloaded fonts) deterministically. A browser is for eyeballing only.

1. **Builds & runs.** `v1design verify <dir> --heal` → clean build, every route serves
   200 with a real page, no console errors.
2. **Full viewport — NO fixed-width shell.** The studio frames screens at a fixed
   artboard (e.g. `width: 1440`). Left as-is the page is capped and a black/empty gutter
   shows on wider screens. Make the app **own the full viewport**: the root fills 100%
   width, content is full-bleed or sensibly max-widthed-and-centered (never a
   left-aligned fixed block with a gutter), and it adapts at 1920 / 1280 / 390. The body
   background is the design background, never bare black.
   No-browser checks: `grep -rn "1440\|PAGE_W" components app` must be empty; add
   `html,body{ max-width:100%; overflow-x:clip }` + give every `repeat(N,1fr)` / fixed
   two-col grid a narrow-viewport collapse so 390px never scrolls sideways (recipe §1, §5).
3. **Navigation actually works — pages CONNECTED.** Every nav item, tab, and primary
   button that points at another screen must really route to that screen's page
   (Next.js `<Link>` / `router.push`, or expo-router `<Link>` / `router.push`). A nav
   that looks clickable but does nothing is a hard fail. Wire the in-screen nav labels
   to the real routes you scaffolded. Build the nav/footer chrome ONCE in a shared
   component and reuse it; do not copy the bar into every screen.
   No-browser check: `grep -rn "href=\"#\"" app components` must be EMPTY, and every nav
   label must have a matching `app/<route>/page.tsx` (recipe §2).
4. **Fonts actually load.** The design's display + body faces must render — not a system
   fallback that changes the look. If a family is not a real Google/Expo font (e.g. a
   Fontshare face like "Clash Display", "General Sans", "PP Editorial New"), substitute
   the closest available font and alias it to the original family name so the design
   still reads right. Verify the rendered `font-family` is the intended (or aliased) face,
   not a default.
5. **Contrast & legibility — best standards.** Text meets WCAG AA against its background
   (≥4.5:1 body, ≥3:1 large). No washed-out labels, no text lost over imagery (add a
   scrim/overlay if needed). Kill porting artifacts: stray default-blue links/`::selection`
   highlights, focus rings in the wrong color — restyle them on-brand (selection uses the
   accent, links inherit color, focus ring uses the design's ring token).
6. **Tab bar / chrome baked properly.** The bottom tab bar (mobile) or top nav (web) must
   look intentional and match the design — real, on-theme icons + labels, a single bar
   (never doubled), correct active/inactive states. No placeholder glyphs (`⏷`), no bare
   labels where the design had icons. Build the chrome ONCE and reuse it across routes.
7. **Native feel (mobile).** SafeArea respected, OS draws the status bar, comfortable
   touch targets, scrollable where content overflows. Real RN primitives, never a
   screenshot image as a screen.
8. **Real content, matches the reference.** No lorem. Then screenshot each route of the
   running app and run `v1design grade <dir>` — the authoritative WOW verdict. Feed it
   the screenshots; fix everything it flags. Loop `verify --heal` + `grade` until BOTH
   pass. The verdict is the gate's, not yours.

Read `references/design-self-check.md` before judging. Finalize ONLY on a clean pass.

## Extend an existing project — add a screen ON-SYSTEM (do not disturb)
When the user has an existing v1design-derived app and wants a NEW screen:
1. Read the project's system first: `.v1design/project.json` (designRef, surface,
   tokensHash, screens) + `theme.lock.ts` + the existing `globals.css`/`theme.ts`,
   `app/_layout.tsx`/layout, the tab bar/nav, and one existing screen for the patterns.
2. Get the new screen on the SAME system:
   - Owned design: `v1design compose <ref> --add "<Name>"` (engine generates it IN the
     design's system), then pull it.
   - Otherwise: build the new screen reusing the EXISTING tokens, fonts, components, and
     chrome — match the established patterns exactly.
3. Add it as a real route (a new file under `app/`), and **wire it into the existing nav
   / tab bar** so it's reachable. Reuse the shared chrome; do not fork it.
4. **Do not change the existing design system or other screens** — same tokensHash, same
   globals/theme, same fonts, same chrome. `v1design compose` refuses a foreign system;
   honor that. Only ADD; never re-skin what's already there.
5. Gate just the new screen with Step 3, then confirm nothing else changed (scoped diff).

## Plain language → action (never surface a flag)
- "looks off / not full width / nav doesn't work" → fix per Step 3, `verify --heal`, `grade`
- "make it darker / teal" → `v1design vibe "<intent>" --in <dir>`
- "add a settings screen" → the Extend flow above (`compose` + wire it in, on-system)
- "another direction / build this one instead" → re-discover or `v1design remix …`

## Boundaries
- Never copy private repos, source, `.env`, credentials, or engine internals into the app.
- Treat unrelated repos as read-only; only edit the app the user named. Scaffold writes
  default to `~/.v1design/workspace/<ref>`; the CLI refuses Git-worktree writes unless
  `--allow-project-write`. Connect via `v1design connect`; never hand-copy credentials.

## Completion standard
- State the design ref(s) and the screens/routes built.
- Confirm the gate PASSED on ALL of Step 3 (builds+runs, full-viewport, nav connected,
  fonts loaded, contrast clean, tab bar baked, matches the reference via verify/grade).
- Live URL only if a server is still running. If anything could not be verified, say so.
