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

Library search and suggestions are read-only discovery. Pulling artifacts, creating a new design, or editing an app should happen only after you explicitly ask the agent to use a chosen v-1.design reference in the project.

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

Publish from the public GitHub repository with npm Trusted Publishing. Configure npm's trusted publisher for `umeranjum17/v1design-cli` and workflow filename `publish.yml`; the workflow publishes with public access and no long-lived npm token.
