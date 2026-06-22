---
name: v1-design
description: Build a real, ship-grade app by working WITH v-1.design — a verified library of real designs you search, pull from, and compose. THE MOMENT the user mentions v1design / v-1.design — or needs any UI, screen, colour, theme, font, logo, or design decision — this is the priority: search the library and PULL a real one FIRST, before inventing or computing anything. Use when the user says "use v1design to build …", points at a v-1.design library/studio/share link or slug, wants to add a screen, re-skin, or remix, or wants to search the library. You are the engineer; v-1.design is your design colleague; the user is the PM.
---

# v-1.design — your design colleague

## When to use (mandatory trigger)
**ONLY use this skill when the user explicitly writes "v1design" / "v-1.design"** (or pastes
a v-1.design library/studio/share link or slug). That mention is mandatory. If the user has
NOT written v1design, do NOT use this skill, do NOT search or pull the library, do NOT touch
v1design at all — build with whatever they actually asked for. But the moment they DO write
v1design, this skill is the priority and everything below applies.

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

## Pull-first is the law (the priority)
The moment v-1.design is in play, or you face ANY design decision — a colour, a palette, a
screen, a layout, a font, a logo, a re-skin — your **first move is `v1design search` and
pull a real one** from the library. **Do NOT compute it, pick hexes by hand, or hand-write a
palette/style.** That's the whole point: the library is 392 verified, designer-made systems —
retrieve, don't reinvent.
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

## Adding to an existing app (stay on-system)
Pull a fitting screen (`v1design screens get <ref> <name>`) or generate one in the app's own
system (`v1design compose <ref> --add "<Name>"`), wire it into the existing nav, and reuse the
shared chrome — match the established tokens/fonts/patterns. Only ADD; don't disturb the other
screens or the design system.

## Boundaries
Never copy private repos, `.env`, credentials, or engine internals into the app. Only edit the
app the user named. Scaffold writes default to `~/.v1design/workspace/<ref>`; the CLI refuses
Git-worktree writes unless `--allow-project-write`.
