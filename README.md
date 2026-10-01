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
v1design compose <ref> --add "Settings,Billing" --yes

# discovery + review
v1design compare <refA> <refB> --surface web
v1design screenshots <ref> --out ./shots
```

## Explore designs with your own recipe

`v1design explore` pulls a few library designs as inspiration **and** runs your **local
recipe** — a folder of markdown that *you* own (`recipe.md` plus your own doctrine, jury,
inspiration). The CLI ships **no design doctrine or workflow of its own**; what "explore"
does is defined entirely by your recipe.

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

## Studio on your computer

Keep your computer online and run Studio jobs with your own subscription through
BYOKit:

```bash
v1design host                       # ChatGPT plan; sign in when needed
v1design host --lane claude         # Claude Pro/Max plan
v1design host status                # selected plan's sign-in state
v1design host --lane claude status
v1design host help                  # setup and requirements
v1design host --fake                # offline contract fixture; no provider or relay
```

Run `v1design connect` for the v-1.design account whose Studio jobs you want to run.
The host key is bound to that CLI connection. Logging out or reconnecting disables
the running host's relay requests, including sign-in codes, and prevents another
generation from starting; restart the host after connecting to the intended account.

Keep the host command running while Studio works. Ctrl+C waits for the current
job's result or failure to be acknowledged before exiting. A failed acknowledgment
stops the host with an error; it does not retry or persist the outcome for recovery.
Successful jobs submit the kit's complete generated text and any usage data,
including results longer than the engine's terminal preview.
`v1design host [--lane claude] signout` signs out only the selected
plan on this computer. Claude uses your own Claude Code login in BYOKit's isolated
home; follow the instructions printed at startup. Subscription billing applies,
with no API key for this route, and [Anthropic's terms apply](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use).
The host supports macOS/Linux; `v1design host help` reports the Node version range
required by its pinned BYOKit engine.

Pull a finished Studio run you own with `v1design pull --project <project-id>`.

You can also use the lower-level discovery + pull commands directly:

```bash
v1design library suggest "book app" --surface web --limit 5 --open
v1design library search "book app" --surface web
v1design pull "https://v-1.design/library/<slug>"
v1design designs get "https://v-1.design/share/<id>"
v1design screens get "https://v-1.design/share/<id>" Home
```

For a brand-new project, start with `library suggest`: it shows the top five matching Library references, opens their pages when `--open` is passed, and gives the agent a clear pause point to ask which direction resonates before pulling artifacts or writing code.

## Pull into your app

Inside a project (a directory with `package.json` or `.git`, or a child of it),
`v1design pull <ref>` writes the pack into the detected project root. `--into <dir>`
chooses another target and selects pack mode even outside a project. For a Studio
run, `--project <project-id>` selects pack mode and requires you to own the run.
Preview pack writes with `--dry-run`; omit it to write. Pack writes do **not** need
`--allow-project-write`.

```bash
v1design pull <slug> --into ./app --dry-run
v1design pull <slug> --into ./app
v1design pull --project <project-id> --into ./app --dry-run
```

A pack includes design guidance, tokens, screen code, prompts and `WORK-ORDER.md`.
Ask your agent to follow that work order route by route. Re-pulling replaces pack
files; agent rules merge only between the managed markers, preserving your text
outside them. Inspect the preview before updating an existing app.
Use `--agents claude,codex,cursor` to select which agent rules are written
(all three by default). Identical re-pulls skip unchanged files. A token-hash
change warns only when re-pulling the same source and design, not when switching
designs. Pack paths that resolve outside the target, including symlinks, are refused.

If a reference pack returns 404, pull searches the Library using the input as a
brief, prints matches to choose from, and exits nonzero without writing a pack.

Outside a project, plain `pull <ref>` downloads a ZIP. `--zip` or `--out <file>`
also selects ZIP mode for reference pulls; `--dry-run` does not apply to ZIP
mode. ZIPs default to `~/.v1design/workspace/<design-ref>/handoff.zip`, and writing
one into a Git worktree requires `--allow-project-write`. Scaffold output also
defaults to that workspace and requires the flag for Git-worktree writes.

Library search and suggestions are read-only discovery. Pulling artifacts,
starting generation or editing an app requires an explicit request to use
v-1.design in the chosen project. Generation commands such as `studio` and
`compose` retain their explicit `--yes` confirmation safeguard; do not run them
just to discover references.

## What This Package Contains

- `v1design`: human/script CLI.
- `v1design-agent`: local stdio connector for agent clients.
- `skills/v1-design`: the bundled agent playbook installed by `v1design connect`.

The v-1.design engine, billing, generation pipeline, and private application code are not published in this package.

## Development

```bash
npm install
npm test
npm run typecheck
npm run check:bin
npm run check:pack-install
npm pack --dry-run
```

## Publishing

Publishing runs in CI (`.github/workflows/publish.yml`) on a GitHub Release (or manual
`workflow_dispatch`). The workflow type-checks, runs the bin + packed-install smoke
tests, then `npm publish --access public --provenance`. Auth is npm Trusted Publishing
(OIDC) — no tokens or secrets. One-time owner setup (needs an npm account with
maintainer access to `@v1design/cli`):
1. npmjs.com → the `@v1design/cli` package → Settings → **Trusted Publisher** →
   GitHub Actions, with repository `umeranjum17/v1design-cli` and workflow file
   `publish.yml`.

Then publish by creating a release: `gh release create vX.Y.Z` (or re-run the
workflow). Provenance is attached automatically via the `id-token: write` permission.

## License

MIT — see [LICENSE](./LICENSE). It covers the CLI code in this repo only, not the
v-1.design brand or the library designs (downloaded designs stay under the Lifetime
license and Terms of Service).
