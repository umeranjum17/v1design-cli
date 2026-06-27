# Bring your own recipe

`v1design` is a **design-exploration runner**. When you run

```
v1design explore "a habit tracker app"
```

it does two things: **pulls** a few existing designs from the v-1.design library as inspiration,
and **runs your local "recipe"**. The CLI ships **no design doctrine and no workflow of its own** —
the taste, the rules, the steps, the inspiration are *yours*, in a recipe you own. Mine are mine;
yours are yours.

## What a recipe is

A recipe is just a folder of markdown the agent reads. The only required file is `recipe.md`:

```
.v1design/recipe/
  recipe.md          # the manifest: declares the flow(s) and points to the rest
  doctrine.md        # your design principles (palette, type, layout, motion)
  archetypes.md      # the named styles you commit to + when to use each
  jury.md            # how you score a design / the bar it must clear
  inspiration.md     # how you pull references for a brief
  workflow.md        # operational rules (batching, tooling, cleanup)
  stages.md          # the ordered stages of each flow
```

Everything except `recipe.md` is optional — reference whatever files you want from the manifest.

`recipe.md` has YAML frontmatter (`name`, `description`, `version`, `entry`) and a body that
describes the **explore** flow the agent should follow. A minimal one:

```markdown
---
name: my-recipe
description: My design-exploration recipe.
entry: explore
---

# Flow: explore
1. Pull a few references for the idea (see inspiration.md).
2. Pick a fitting style (see archetypes.md + doctrine.md).
3. Generate some concepts and judge them (see jury.md).
4. Show the results.
```

## Scaffold one

```
v1design recipe init        # writes a SAMPLE recipe to ./.v1design/recipe (a template to edit)
v1design recipe path        # shows which recipe `explore` will resolve
```

`recipe init` drops a commented **template** with placeholder content. Replace the placeholders
with your own doctrine — that template is the *format*, not anyone's real recipe.

## How `explore` finds your recipe

Discovery order (first match wins):

1. `--recipe <dir>` flag
2. `V1DESIGN_RECIPE_DIR` environment variable
3. the nearest `./.v1design/recipe/` walking up from the current directory
4. `~/.v1design/recipe/` (a good place for a recipe you want available in **every** project)

If none is found, `explore` falls back to **remote library exploration** (it still pulls
inspiration from the library) and tells you how to add a recipe.

Tip: keep your recipe in a private repo and symlink it so every project picks it up:

```
ln -s /path/to/your-private-repo/recipe ~/.v1design/recipe
```

Your recipe never leaves your machine — the CLI only *reads* it. It is never uploaded, bundled,
or published.

## explore vs studio

- **`v1design explore`** pulls a few library designs as inspiration and runs *your local
  recipe*. No account, no engine credits — and what it does is entirely up to your recipe. This
  is the default for "generate new designs".
- **`v1design studio "<brief>"`** is the v-1.design **engine forge**: it generates a finished
  design server-side and **spends credits**. Use it only when you explicitly want the hosted
  forge (it requires `--yes`).
