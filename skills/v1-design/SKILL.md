---
name: v1-design
description: Search and pull from the v-1.design library, then build/recolour/remix a real app from it. LIBRARY-FIRST — the default is search + pull (incl. the user's own designs); NEVER create or generate a new design (v1design create / compose) unless the user EXPLICITLY asks to create one — that spends credits. HARD GATE — use this skill ONLY when the user EXPLICITLY writes "v1design" / "v-1.design" (or pastes a v-1.design library/studio/share link or slug), OR the work is already on a v-1.design-derived app started that way in this session. If v1design was NOT explicitly mentioned, do NOT use this skill at all — even for UI / design / colour / theme / layout work; build with whatever the user asked for using your normal tools. Triggers: "use v1design to build …", a v-1.design link/slug, or a follow-up inside an explicitly-v1design session (add a screen, recolour, re-skin, remix, search the library). You are the engineer; v-1.design is your design colleague; the user is the PM.
---

# v-1.design — your design colleague

## When to use (mandatory trigger)
**ONLY use this skill when the user explicitly writes "v1design" / "v-1.design"** (or pastes
a v-1.design library/studio/share link or slug). That mention is mandatory. If the user has
NOT written v1design, do NOT use this skill, do NOT search or pull the library, do NOT touch
v1design at all — build with whatever they actually asked for. But the moment they DO write
v1design, this skill is the priority and everything below applies.

## Library-first — THREE intents, don't conflate them (hard rule)
This CLI is a **library + a recipe RUNNER**. Three distinct things:
1. **Search / pull** — `v1design search` / `library` / `designs get` / `screens get` /
   `theme|tokens|colors get`. Free, read-only, always fine (incl. the user's OWN designs).
2. **Explore — TWO SEPARATE LANES → a browser gallery the user picks from** — `v1design explore "<idea>"`.
   The DEFAULT for "explore designs / generate new ones". The whole experience, end to end:
   - **FRESH FOLDER, always.** The CLI prints a per-idea folder (`v1-explore/<slug>[-<surface>]/`).
     `mkdir -p` it and put EVERY concept HTML, PNG render, and `manifest.json` there. **Never muddle an
     existing folder** — that has burned the user repeatedly.
   - **GROUND IT in the user's context first.** Skim their repo (README, package.json, what they're
     building, who their end-users are). Both lanes must fit THEIR product AND their users — not just the
     bare idea string. Respect the surface they asked for (`--surface web|mobile`).
   - **Lane A — adapt from the LIBRARY** (default **2**): existing v1design designs matching the idea —
     pull/adapt the idea onto each (REUSE the real palette/type/components, don't generate). Domain need
     NOT match — a dating app's UI is a fine reference for a writing app if the *concept/craft* is
     adaptable. REQUIRED when there's a real match (the CLI prints the `designs get`/`theme get`
     commands); when no strong fit it's OPTIONAL but you must STILL state a decision. **Never silently
     drop Lane A** — the #1 failure mode this gate stops.
   - **Lane B — FRESH from the recipe** (default **2**): run the user's LOCAL recipe (`./.v1design/recipe`
     → `~/.v1design/recipe` → `V1DESIGN_RECIPE_DIR`) to GENERATE brand-new designs **on its own** (do NOT
     feed Lane A in), each a distinct design movement. No recipe → Lane B unavailable; `v1design recipe init`.
   - **RENDER every concept to a PNG** in the folder (your headless browser — playwright/puppeteer), and
     write `manifest.json` = `[{file,name,style,source,pitch,lane:"A"|"B",palette,fonts}]`.
   - **OUTPUT IT: `v1design gallery <folder>`** — assembles a polished browser page (Lane A vs Lane B,
     every option side by side) and OPENS it. The user flips through, **picks one, and builds their app
     from it**. Explore is NOT done until the gallery has been opened for the user.
   - **Default 2 adapted + 2 fresh** unless the user asks for more (`--adapt N` / `--fresh N`).
   - **RENDERING — every concept, every lane (clean product shot, not a demo):**
     - **NO on-screen keyboard** — no phone QWERTY / iOS keyboard / key grid. The editor + suggestions
       ARE the hero; a drawn keyboard makes it read as a keyboard-app demo, not a product.
     - **NO fake OS chrome** — no "9:41" status bar, no signal/wifi/battery, no device bezel / phone
       mockup frame. Render the app screen itself, full-bleed.
     - **ONE cohesive screen**, not a long scrolling magazine page. Mobile ≈ 430×950–1150; web ≈ a clean
       above-the-fold hero. Generous whitespace, premium, fully procedural, real copy (no lorem).
     - **LIGHT palette by default** (dark only if the chosen movement truly demands it; ≤1 dark per set).
   Spends no engine credits; the CLI ships no doctrine. Keep the lanes separate — never blend A into B.
3. **Studio forge (engine, spends credits)** — `v1design studio "<brief>" --yes` (was
   `v1design create`) and `v1design compose`. GENERATE on the engine and SPEND CREDITS; run ONLY
   on an explicit "studio/forge" ask (`--yes`; MCP tools require `confirm:true`).
When unsure: search/pull or **explore** — never studio.

## The relationship
The user is the **PM** — they tell you, in plain language, what they want. **You are the
engineer.** **v-1.design is your design colleague**: a large, verified library of real,
ship-grade apps — hundreds of designs and all their parts (screens, palettes, fonts,
components, whole themes) that you can search and pull from.

You don't invent design from nothing, and you **never run a mechanical colour-transform** —
no hue math, no blind regex recolour. But you ARE on the hook for the result being COMPLETE:
you and the library go back and forth, the way an engineer and a designer build together —
**ask the library → pull a real designed piece → use it → look hard at every screen → fix what's
off → refine** — until it's genuinely something you'd ship, with nothing half-done.

## Pull-first is the law (inside a v1design build only)
**This applies only once the gate above is met** (v1design was explicitly invoked). Within such
a build, for ANY design decision in it — a colour, a palette, a screen, a layout, a font, a
logo, a re-skin — your **first move is `v1design search` and pull a real one** from the library.
**Do NOT compute it, pick hexes by hand, or hand-write a palette/style.** That's the whole point:
the library is 392 verified, designer-made systems — retrieve, don't reinvent. (Outside a
v1design build — i.e. v1design was never mentioned — none of this applies; just build normally.)
- **"Make it teal"** = `v1design search "teal" --type palette` (or a teal design), pull that
  real palette's `theme get`/`colors get`, and apply it — **not** "shift the hue to teal" in
  your head. A pulled palette is a designer's full, balanced system; a hand-tweaked hue is a
  guess.
- Need a screen, a chart, a pricing block, an empty state? Search and pull a real one first.
- Only hand-edit when the library genuinely has nothing close — and say so when you do.

## A recolour is LEAK-FREE or it is NOT done (hard gate)
Changing the colours means the WHOLE app lands on ONE cohesive palette with **zero trace of the
old one** — every screen, and every glow, gradient, shadow, border, tinted panel, and any
canvas/3D material. Half-recoloured — the new accent on the text but the OLD colour still in a
button glow or a tinted background — is the #1 failure and an automatic **REJECT**. This is the
exact thing that has shipped broken before; do not let it.

**Why it leaks:** a design hardcodes its brand colour in MORE than one place — a `const ACCENT`,
but ALSO inline `boxShadow: "… rgb(198 248 51 / .2)"` glows, gradient stops, a faintly-tinted
`rgb(20 22 15)` panel bg, a hex baked into a Three.js material. Swap only the design tokens (or
only the one const) and every hardcoded literal keeps the old colour. That is a leak.

**So a recolour is a TOKENISATION job, not a find-the-accent job:**
1. **Pull ONE cohesive palette** that suits this design's mood (pull-first). One rationed accent
   on a neutral ground is cohesive by construction; a random hue dropped onto a tinted base is not.
   If the pulled colour doesn't sit well, pull a different one — don't ship "colours that don't go".
2. **Make the app fully token-driven.** EVERY brand colour — in consts, inline styles, gradient
   stops, shadows/glows (use `color-mix(in srgb, var(--primary) N%, transparent)`), tinted panel
   backgrounds, AND any code you wrote yourself (a 3D scene reads `getComputedStyle(document
   .documentElement).getPropertyValue('--primary')`, never a baked hex) → becomes `var(--token)`.
   **Never hardcode a brand hex — not the old one, and not the new one.** A hardcoded new hex is
   just the next leak.
3. **Render EVERY route and LOOK**, at light and dark. Scan for any surviving patch of the old
   colour, any clash, any tinted-grey that fights the accent. Find one → not done → fix → look again.
4. The gate is visual and absolute: one palette, no leaks, looks intentional and shippable.
   Default **REJECT**. This is YOUR eye and judgement, not a search-and-replace — but "change the
   colour" must actually change ALL of it.

**The one exception — categorical / third-party colours.** Colours that encode IDENTITY or DATA
(a provider's real brand colour like Perplexity-teal, chart-series colours, status red/green) are
NOT the app's accent — don't collapse them to `var(--primary)` (that destroys the distinction).
Keep them distinct, BUT: make sure they harmonise with the new palette, and that none of them reads
as *leftover old brand* — if a categorical colour clashes or echoes the very colour you just removed,
re-pick that categorical set. (You can still route the "self"/primary item — e.g. your own product
in a comparison — to `var(--primary)`.)

Connect once with `v1design connect` (never ask the user for a key). Prefer the v1design MCP
tools; otherwise the CLI.

## The loop (this is the whole skill)
1. **Hear the brief** — an idea, a vibe, a reference link, "make it teal", "add a pricing
   page", "this feels off".
2. **Ask the library** — `v1design search "<what you need>"` (the `search` tool). One index
   over the whole verified library: whole designs, individual **screens**, **palettes** (by
   colour, e.g. `--type palette` for "teal"), **fonts**, **components**. Search several
   angles — the library is huge and verified, so the right thing almost always already
   exists. It returns **handles** you pull.
3. **Pull what fits** — real, designed material:
   - a design to build from → `v1design new "<idea>"` (searches + scaffolds the best fit) or
     `v1design scaffold <ref> --surface web|mobile --out <dir> --install`
   - a whole theme / palette → `v1design theme get <ref> --css` (the literal `globals.css`),
     `v1design colors get <ref>`, `v1design tokens get <ref>`
   - a single screen → `v1design screens get <ref> <name>`
4. **Use it — you write the code.** Scaffold the design into a real running app; drop a pulled
   screen in as a working route; write a pulled theme into `app/globals.css` (every screen
   styles via `var(--token)`, so the app restyles live). Compose freely: palette from one
   design, a screen from another, type from a third.
5. **Look, then go back to the library.** Render / screenshot it, see how it actually looks,
   and pull whatever's missing or off. **Need it teal? Don't compute a colour — search the
   library for a great teal and pull its palette.** Need a logo or an icon that fits? Pull a
   real one. Something feels generic? Pull a stronger reference. Keep pulling and refining.

That's it: **retrieval + your engineering judgment, in a loop.** The intelligence is you and
the library — there is nothing deterministic to "run."

## You're the engineer — make the pulled design real
A scaffold or a pulled screen is real, running material, not the finished app. You take it the
rest of the way with normal engineering judgment (look at it, fix it, look again):
- it **owns the full viewport** and adapts (not a fixed-width block in a gutter),
- every nav item / tab / primary button **actually routes** to a real page, with the nav and
  footer built once as shared chrome and reused,
- the **real fonts load** (alias a Fontshare face to the closest Google/Expo font if needed),
- it's **legible** and looks **genuinely great in light and dark**, one cohesive look — if a
  re-skin leaves something off-palette, fix it in the code like an engineer would; if you want
  a different colour, pull a real palette for it, don't invent one.

`v1design verify <dir>` confirms it builds and every route serves; `v1design grade <dir>` is
the WOW verdict. Use them as a second opinion, and keep iterating with the library until it's
right. Done = a design you'd actually ship.

## Remix a screen in — it must look NATIVE, not grafted (the heart of v1design)
The most powerful move: pull a screen from a DIFFERENT design and incorporate it so it looks
like it was ALWAYS part of this app. A remix keeps the donor's **structure/idea** (its layout,
its signature element — a chart, a ribbon canvas, a grid) and re-executes it **100% in the host's
design language.** A bolted-on graft is a fail. What makes a remix fabulous:
- **Adopt the host's ENTIRE system, not just colours** — its tokens, its real fonts, its
  nav/chrome + footer, its spacing/radius/column width, its component patterns and visual motifs
  (reuse the host's own card / waveform / badge components). Strip the donor's shell (its sidebar,
  its nav) and wrap the content in the host's chrome.
- **No donor design language leaks** — same leak-free rule as a recolour: every donor colour →
  `var(--token)`/`color-mix` (including hex baked in a donor canvas/3D — read it via
  getComputedStyle); no donor fonts, no donor chrome, no donor spacing feel.
- **Transform the content to the HOST's domain** — re-author every label, number and copy line
  into the host's world (audio app → tracks / plays / listening minutes, never the donor's
  followers/lorem). Grep the served HTML for leftover donor-domain words.
- **Wire it in** as a real route in the existing nav, reachable from every page; reuse the shared
  chrome, don't fork it. Only ADD — don't disturb the other screens or the design system.
- **The bar:** render it beside the existing screens — it must read as ONE product (same voice,
  same rationed accent, a deliberate new surface). If it feels even slightly foreign, not done.

**What a jury rejects (so catch it first — these sank real remixes):**
- **Flooding the accent.** Count how sparingly the host uses its accent — usually 3–4 small,
  precious moments per screen (a CTA, a hairline, one number); the rest is neutral. MATCH that
  rationing. A giant glowing gradient + every chart, dial and sparkline lit at once cheapens the
  accent and instantly reads non-native. Most of your screen must be neutral.
- **Density / composition drift.** If the host is airy and cinematic (one big idea per band,
  generous whitespace), do NOT cram a dense multi-module dashboard — re-space the donor's structure
  to the host's rhythm so it feels like the host's OTHER pages, not a generic dashboard.
- **Layout defects.** RENDER the page and scroll the WHOLE thing. Duplicated/ghosted components (a
  scrubber or card rendered twice), content clipped at a panel edge, overlapping/colliding boxes,
  misaligned columns = instant reject. These hide below the fold — you must actually look.
- **Foreign type or motifs.** Use ONLY the host's type treatments and motifs — no italic-serif
  flourish if the host is bold-sans + mono; no radial gauge dials if the host's language is
  horizontal waveforms. Re-express the donor's data in the HOST's own visual motifs.
- **Status/categorical hues:** prefer tints within the host's palette family + neutrals; add a
  foreign hue (green ok / red bad) only if essential, and keep it tiny.

Tools: `v1design screens get <ref> <name>` lifts a donor screen; `v1design compose <ref> --add
"<Name>"` generates one already in the host's system.

## Boundaries
Never copy private repos, `.env`, credentials, or engine internals into the app. Only edit the
app the user named. Scaffold writes default to `~/.v1design/workspace/<ref>`; the CLI refuses
Git-worktree writes unless `--allow-project-write`.
