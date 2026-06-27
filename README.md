# v1design

The public CLI and local agent connector for [v-1.design](https://v-1.design).

```bash
npm i -g @v1design/cli
v1design connect
```

`v1design connect` installs the bundled `v1-design` skill, opens v-1.design for browser authorization, stores the local connection at `~/.v1design/credentials.json`, and configures Codex by default. Cursor and Claude setup are opt-in with `--client cursor`, `--client claude`, or `--client all`.

After that, just tell your agent in plain language — the bundled skill does the rest:

```text
Use v1design to build a habit tracker app
Use v1design to build this design: https://v-1.design/library/<slug>
```

The skill discovers (or resolves) a design, scaffolds a real runnable app, and runs
the verify→heal gate until it passes. You never type a command or flag.

## Build a runnable, verified app

One command turns a v-1.design design into a runnable Next.js (web) or Expo (mobile)
project — tokens, fonts, one route per screen — then builds, boots, and probes every
route. It does not stop at "it renders."

```bash
# idea → search → pick → scaffold → verify
v1design new "habit tracker app" --surface mobile --install

# a specific design, built as-is
v1design scaffold "https://v-1.design/library/<slug>" --surface web --install --run

# merge screens from several designs into ONE coherent system
v1design remix <refA> <refB> --system <refA> --surface web --out ./app

# the quality gate (build + boot + probe every route + auto-fix)
v1design verify ./app --heal
v1design grade  ./app                 # the WOW / visual verdict (oracle)

# hot re-skin the whole app on the running dev server
v1design vibe "darker" --in ./app
v1design vibe "teal fintech" --in ./app

# add a new screen in the app's own system
v1design compose <ref> --add "Settings,Billing"

# discovery + review
v1design compare <refA> <refB> --surface web
v1design screenshots <ref> --out ./shots
```

## Explore designs with your own recipe

`v1design explore` pulls a few library designs as inspiration **and** runs your **local
recipe** — a folder of markdown that *you* own (`recipe.md` plus your own doctrine, jury,
inspiration). The CLI ships **no design doctrine or workflow of its own**; what "explore"
does is defined entirely by your recipe. It spends no engine credits.

```bash
v1design explore "an invoicing tool for freelancers"   # pull inspiration + run your recipe
v1design recipe init                                    # scaffold a starter recipe to ./.v1design/recipe
v1design recipe path                                    # show which recipe `explore` resolves
```

Recipe discovery order (first match wins): `--recipe <dir>` → `V1DESIGN_RECIPE_DIR` →
nearest `./.v1design/recipe` → `~/.v1design/recipe`. Keep one at `~/.v1design/recipe` to make
it available in every project. Bring your own — see **[RECIPE.md](./RECIPE.md)** for the format.

## Find AI-slop in any UI

Deterministic, local, **no account and no API key** — scan a repo, file, or directory for the
tells that make AI-generated UIs all look the same (purple gradients, generic CTAs, placeholder
data, glassmorphism, em-dash cadence, and more).

```bash
v1design detect ./src            # human report, non-zero exit if hard tells are found
v1design detect ./src --json     # CI-friendly output
v1design detect --tells          # list every rule
```

## Generate a new design with the engine forge (studio)

```bash
# the v-1.design engine generates a finished design — this SPENDS CREDITS, so it needs --yes
v1design studio "a fintech dashboard" --yes
```

`v1design studio` is the hosted forge (was `v1design create`, which is now a deprecated alias).
For "generate new designs" in general, prefer `explore` (your own recipe, no credits).

You can also use the lower-level discovery + pull commands directly:

```bash
v1design library suggest "book app" --surface web --limit 5 --open
v1design library search "book app" --surface web
v1design pull "https://v-1.design/library/<slug>"
v1design designs get "https://v-1.design/studio/<id>"
v1design screens get "https://v-1.design/studio/<id>" Home
```

For a brand-new project, start with `library suggest`: it shows the top five matching Library references, opens their pages when `--open` is passed, and gives the agent a clear pause point to ask which direction resonates before pulling artifacts or writing code.

Generated references default to `~/.v1design/workspace/<design-ref>`, for example `~/.v1design/workspace/aetra-a3e7c2b1/handoff.zip`. The CLI refuses to write inside a Git worktree unless `--allow-project-write` is passed, which keeps private repos read-only unless you deliberately choose one as the target app.

Library search and suggestions are read-only discovery. Pulling artifacts, running the `studio` forge (which spends credits), or editing an app should happen only after you explicitly ask the agent to use a chosen v-1.design reference in the project.

## What This Package Contains

- `v1design`: human/script CLI.
- `v1design-agent`: local stdio connector for agent clients.
- `skills/v1-design`: the bundled agent playbook installed by `v1design connect`.

The v-1.design engine, billing, generation pipeline, and private application code are not published in this package.

## Development

```bash
npm install
npm run typecheck
npm run check:bin
npm run check:pack-install
npm pack --dry-run
```

## Publishing

Publishing runs in CI (`.github/workflows/publish.yml`) on a GitHub Release (or manual
`workflow_dispatch`). The workflow type-checks, runs the bin + packed-install smoke
tests, then `npm publish --access public --provenance`. Configure ONE auth method:

**Option A — Automation token (fastest, foolproof).**
1. npmjs.com → your avatar → Access Tokens → Generate New Token → **Granular Access
   Token** (or classic **Automation**). Scope it to publish `@v1design/cli`.
2. GitHub repo → Settings → Secrets and variables → Actions → New repository secret,
   name `NPM_TOKEN`, paste the token.

**Option B — Trusted Publishing (no stored secret).**
1. npmjs.com → the `@v1design/cli` package → Settings → **Trusted Publisher** →
   GitHub Actions, with repository `umeranjum17/v1design-cli` and workflow file
   `publish.yml`. (Leave `NPM_TOKEN` unset; the workflow uses the OIDC id-token.)

Then publish by creating a release: `gh release create vX.Y.Z` (or re-run the
workflow). Provenance is attached automatically via the `id-token: write` permission.
