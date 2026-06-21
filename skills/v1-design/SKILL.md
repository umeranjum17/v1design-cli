---
name: v1-design
description: Build a real, WOW-grade app from v-1.design — from a plain idea or a specific design reference — then gate the output until it passes. Use when the user says "use v1design to build ...", points at a v-1.design library/studio/share link or slug, asks to remix or clone v-1.design references, wants to add a screen to a v-1.design-derived app, or wants to search the v-1.design library. The skill drives discovery, scaffold, and a verify→heal quality gate; the human stays in plain language.
---

# v-1.design — build it, then gate it until it's right

## What this skill does
You are the build-and-gate brain for v-1.design. The user's entire input is one
sentence ("use v1design to build X"). You take it from there: discover or resolve
a reference, scaffold a real runnable app, then GATE the output — it is not done
until it builds, runs, and looks coherent and consistent, confirmed by
`v1design verify` (and `v1design grade`). Never ask the user which command or flag
to run; ask only when a genuine taste fork exists.

Prefer the v1design MCP tools when available; otherwise use the CLI (same behavior).
Connect once with `v1design connect` — never ask the user for an API key.

## When to act vs wait
- Trigger on: "use v1design to build/clone/remix …", a v-1.design link/slug,
  "add a screen to this v1design app", or an explicit request to use v-1.design.
- Read-only discovery (search/preview) is fine anytime. Do not scaffold, write
  files, or edit the repo until the user has asked you to build/use one.

## Step 1 — read the intent: an idea, or a specific design?
- **Idea** ("a habit tracker", "a landing like Linear but warmer") → you DISCOVER.
  Search the library agentically: issue several queries across entity types
  (whole designs, individual screens, logos, components), broaden/narrow keywords,
  dedupe, and pick the strongest matches. Present a few directions and let the user
  pick (pick yourself only if they delegate). Remix on request.
  - CLI: `v1design new "<idea>" --surface web|mobile`  (interactive when a TTY)
  - or: `v1design library search "<idea>" --surface web --json` then choose.
- **Specific design** (URL / slug / "the one I picked") → resolve the ref and build
  it AS-IS: skip discovery and remix, build faithfully against that design's own
  reference.
  - CLI: `v1design new "<url|slug>"`  or  `v1design scaffold <ref>`
- Infer the surface from the ask: web → Next.js, mobile → Expo + React Native,
  unless an existing repo dictates otherwise.

## Step 2 — build
- New project: `v1design scaffold <ref> --surface <web|mobile> --out <dir> --install`
  produces a real runnable app (real routes, the design's tokens, fonts, shared
  chrome). For an idea, `v1design new` wraps search + scaffold.
- Remix two or more: `v1design remix <refA> <refB> --system <refA> --out <dir>` —
  merges screens from several designs into ONE coherent system (the `--system`
  design's tokens win; others re-skin to match).
- Existing repo: keep its stack; pull screens with `v1design screens get <ref> "<name>"`
  and add the smallest clean routes/components that fit.
- The v-1.design design (tokens, globals.css, screen code, rendered reference) is
  the source of truth. Adapt it into the target framework. Never ship a fixed-width
  mockup as a page.

## Step 3 — GATE the output (the core job — never skip)
Whatever you produced from a v-1.design remix / clone / scaffold is NOT done until
it passes. Read `references/design-self-check.md` before judging any UI.
1. It builds and runs. `v1design verify <dir> --heal` builds, boots, and probes
   every route for HTTP 200 + non-error HTML, auto-fixing what it can.
2. It looks coherent and consistent — one palette, a single focal accent, consistent
   type and spacing, real content (no lorem), responsive on web / native feel on
   mobile, every screen a real route (not a fixed artboard).
3. It matches the reference. For the visual/WOW verdict, screenshot each route of
   the running app and run `v1design grade <dir>` (the authoritative oracle). Let
   `verify --heal` loop until it PASSES. The verdict is the gate's, not yours — if it
   is not there yet, keep healing; never declare done on a fail.

Default verdict before the gate passes is REJECT. Finalize only on a clean pass.

## Plain language → action (never surface a flag to the user)
- "looks off / not quite right" → `v1design verify <dir> --heal`
- "make it darker / more teal / calmer" → `v1design vibe "<intent>" --in <dir>`
- "add billing / a settings screen" → `v1design compose <ref> --add "<Name>"` (stays on the app's own system)
- "try another direction / build this one instead" → re-discover or `v1design remix …`

## Boundaries
- Never copy private repos, source, `.env`, credentials, or local engine internals
  into the app or the handoff.
- Treat unrelated repos as read-only; only edit the app repo the user named.
- Scaffold writes default to `~/.v1design/workspace/<ref>`; the CLI refuses to write
  inside a Git worktree unless `--allow-project-write` is passed.
- Do not print or hand-copy credentials; connect via `v1design connect`.

## Completion standard
- State the design ref(s) used and the screens / routes built.
- Confirm the gate PASSED (builds + runs, coherent, matches the reference via
  verify/grade) — plainly.
- Give a live URL only if a server is still running there.
- If something could not be verified, say so plainly.
