# Agent build log: Claude Code (Opus 5.5) acting as the member's coding agent

Surface: **localhost**. The engine is origin/feature/v2 `c64441e`, running in a scratch copy in file mode with no Mongo, R2 or production keys. Its library holds one free design, `pulse-5f8a2c10`, seeded from the clone's `library/pulse` with `scripts/seed-library.mts`. The key is a local dev key minted for member `umer` with `scripts/mint-key.mts` into the scratch `.data/`. The CLI is origin/feature/v2 `3b31fa5`, with the fix from `fm/v1-pm-4` applied for transcript 02. The repo is a fresh `npm create vite@latest umer-metrics -- --template react-ts` app, a real git repo outside every project.

## Steps (in order)

1. **Pulled** the pack: dry run, then the real pull, then an identical re-pull (`01-pull-transcript.txt`). Committed the pull as `e4dec0d`.
2. **Read** `CLAUDE.md` (managed block), then `WORK-ORDER.md`, `DESIGN.md`, `design-tokens.json`, `prompts/Overview.md` and `screens/Overview.tsx`.
3. **Checked the tokens hash** as `WORK-ORDER.md` requires: `sha256sum design-tokens.json` = `8304ce58…b6e6`, which matches the expected hash, so the pack is not stale.
4. **Branch:** `git checkout -b v1-design/pulse-5f8a2c10`, as the work order requires.
5. **Found a pack conflict and resolved it.** `prompts/*.md` and `PROMPT.md` describe an older dark design: indigo `#080810`, Space Grotesk and Inter, MRR $84,320, with "Works in … Windsurf". `DESIGN.md`, `design-tokens.json`, `screens/*.tsx` and the live demo all describe the current "Warm Ledger" design: light warm canvas, a single amber accent, Schibsted Grotesk and Geist, MRR $81,347. The pack's agent rule says to match `DESIGN.md` and `screens/*.tsx` exactly and to take colours and fonts only from `design-tokens.json`, so I followed the tokens and screens and set the stale prompts aside. A member's agent that follows the work order literally ("Build the route from its prompt file") would build the wrong, dark design.
6. **Setup:** `src/tokens.ts` imports `design-tokens.json` and writes semantic and primitive tokens to CSS variables on `:root`. It maps background, secondary, card, foreground, mutedForeground, border and accent, plus primitives neutral-700, primary-600/700 and success-600. Tinted fills use `color-mix()` over those variables. The `src/` tree contains **no hex values**: `grep -rnE "#[0-9a-f]{3,8}|rgba?\(" src` matches only the leftover scaffold SVG, which was then deleted. The fonts load from Google Fonts.
7. **Route 1, Overview:** a shared `NavRail` component (pack rule 3), four KPI cards, an SVG MRR area chart built with the reference's curve maths, an 8-row activity table and a footer. The Customers and Settings nav items are present but inert until their routes are built.
8. **Route 2, Analytics:** a cohort heatmap with an amber `color-mix` ramp and the "Onboarding shipped" callout, a conversion funnel with drop rates, revenue-by-plan bars and a working range toggle.
9. **Verification:** `npm run build`, which runs `tsc -b` and `vite build`, passed on every pass.
10. **Compared** at a 1440×900 viewport, full page, with the same Playwright script for the demo (`/render/<id>/<screen>` on the local engine) and the built app (`vite` dev server).

## Fix passes (the work order allows at most 2)

| Pass | Change | Overview RMSE vs demo | Analytics RMSE vs demo | Page height (demo 1206 / 971) |
|---|---|---|---|---|
| round 1 | first build | 9.6 % | 13.0 % | 1167 / 948 |
| fix 1 | `body { line-height: 1.5 }` (the demo inherits a 1.5 preflight) | n/a | n/a | 1201 / 966 |
| fix 2 | card titles `15px/1.5` instead of `/1.3` | **2.9 %** | **6.0 %** | **1206 / 972** |

## Honest match verdict

**Layout:** the same on both screens. The grid, card sizes, chart geometry, table rows, heatmap cells, funnel and plan bars line up to the pixel, and page heights match within 1px.

**Type:** the same families (Schibsted Grotesk for display and numerals, Geist for body), sizes, weights and tracking.

**Colour:** a close match.
- The amber is a touch deeper and redder than the demo's `#D97706`. The tokens give the accent as `oklch(62.8% 0.162 52.4)`, while the reference hard-codes the hex. This follows the "tokens are law" rule.
- The two darker plan bars use token primitives primary-600/700, which have a slightly different hue from the reference's `#B45309`/`#92400E`.

**Intentional differences:**
- The member is shown as "Umer" with the avatar "U", instead of the design's "Alex Kim"/"AK".
- On Overview the demo's sidebar stops at the viewport height (900px); the built sidebar runs the full page. This is a defect in the demo, and the build does not reproduce it.
