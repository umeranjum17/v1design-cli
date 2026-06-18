# v1design

The public CLI and local agent connector for [v-1.design](https://v-1.design).

```bash
npm i -g @v1design/cli
v1design connect
```

`v1design connect` installs the bundled `v1-design` skill, opens v-1.design for browser authorization, stores the local connection at `~/.v1design/credentials.json`, and configures supported local agent clients.

After that, point your agent at any Studio, share, or Library link:

```text
Use $v1-design to build this app from https://v-1.design/library/<slug>
```

You can also use the real CLI directly:

```bash
v1design pull "https://v-1.design/library/<slug>" --out handoff.zip
v1design designs get "https://v-1.design/studio/<id>"
v1design screens get "https://v-1.design/studio/<id>" Home --out Home.tsx
```

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
