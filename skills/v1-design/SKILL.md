---
name: v1-design
description: Build real apps from v-1.design Studio, share, or Library links using the v1design CLI and local connector. Use when the user asks to point an agent at a v-1.design design, search the v-1.design Library for references, install/connect the v-1.design agent or CLI, pull a design handoff, implement screens from v-1.design references, continue a generated design in a codebase, or create a new design through v-1.design and then build it end to end.
---

# v-1.design

## Overview

Use v-1.design as the source of truth for app design handoffs. The goal is not to paste prompts by hand; connect once, pull the design, implement the app, verify it against the references, and report what shipped.

## Core Rules

- Do not ask the user for an API key in the normal path. Use `v1design connect`.
- Accept any v-1.design Studio URL, share URL, Library URL, project id, or Library slug as the design reference.
- Prefer v1design tool calls when they are available. Use the CLI as the fallback or for artifacts.
- Treat v-1.design TSX, design tokens, `globals.css`, and rendered reference images as design source material; adapt them into the target repo's framework instead of blindly dropping incompatible code.
- Build the real app surface: routes, shared chrome, state, data mocks/fixtures, interactions, empty/loading/error states, and responsive behavior.
- For a new web app repo, start with a Next.js App Router TypeScript project with Tailwind unless the user or existing repo requires another stack.
- For web apps, do not ship the reference frame as a fixed-width page. A 1440x900 handoff is a design reference, not the app viewport contract. The implementation must own the full browser viewport, avoid exposed body whitespace, and adapt or scale the design for wide, normal, and narrow screens.
- Visually verify against the v-1.design references before finalizing.

## Safety Boundaries

- The CLI is not a repo migration tool and must not use private product/source repos as scratch space.
- Use v-1.design Library links, Studio/share links, or `create_design` as the design source. Do not copy private source code, private docs, `.env` files, credentials, or local engine internals into the handoff or target app.
- Treat unrelated local repos as read-only. Only edit the app repo that the user explicitly identifies as the implementation target.
- For dogfood, tests, or exploratory work, create a fresh temp repo/workspace and write CLI artifacts there or under `~/.v1design/workspace/<design-ref>`.
- When running CLI commands from inside a Git worktree, avoid artifact writes there unless that repo is the intended target and the user has explicitly approved it. The CLI refuses Git-worktree writes by default unless `--allow-project-write` is passed.

## Connection Flow

1. Run the seamless setup:

```bash
npm install -g @v1design/cli
v1design connect
```

This installs the skill, opens v-1.design in the browser, lets the user click Authorize, stores the connection locally in `~/.v1design/credentials.json`, and configures Codex by default. Cursor and Claude setup are opt-in with `--client cursor`, `--client claude`, or `--client all`. Do not print, request, or hand-copy credentials.

2. If troubleshooting, check connection status:

```bash
v1design status
```

3. If only browser authorization needs to be repeated, run `v1design login`.

## Choose A Library Reference

Use this when the user gives an app idea but no exact v-1.design link.

Prefer tool calls:

```text
search_library("book app", limit=8)
get_design("<chosen-library-url-or-slug>")
```

CLI fallback:

```bash
v1design library search "book app" --limit 8
v1design designs get "<chosen-library-url-or-slug>"
```

Choose the closest reference by product category, surface, tags, and visual fit. Tell the user which design you chose only if it affects the build; otherwise proceed directly into implementation. If no Library result fits, create a new design with `create_design` / `v1design create`.
For a new web app, include `web` in the search phrase when the user's words are surface-neutral, for example `book web app`.

## Build From A Design

1. Inspect the target repo first: package manager, framework, routing, styling system, component conventions, and existing test/dev scripts.
   - If there is no target web repo yet, create a Next.js App Router TypeScript project with Tailwind in the requested new repo and build there.
2. Fetch the handoff.

Prefer tool calls:

```text
get_design("<v-1.design-url-or-id>")
get_screen_code("<v-1.design-url-or-id>", "<screen name>")
```

CLI fallback:

```bash
v1design designs get "<v-1.design-url-or-id>"
v1design pull "<v-1.design-url-or-id>"
v1design screens get "<v-1.design-url-or-id>" "<screen name>"
```

3. Read the handoff for design tokens, global CSS, screen names, surfaces, dependencies, and component contracts.
4. Pull each screen's rendered reference image and TSX. Use the image for visual truth and the TSX/tokens for implementation detail.
5. Implement in the target repo's native style:
   - Add or merge token CSS carefully.
   - Extract shared navigation/chrome once.
   - Create real routes/screens.
   - Wire expected interactions and state.
   - Install missing UI/icon/font dependencies only when needed.
6. Run the app and verification commands. Use screenshots or browser checks where the UI matters. For web, check wide desktop, normal desktop, and narrow/mobile viewport sizes; exposed body whitespace or a fixed-width shell on a wide browser is a blocking bug.
   - When the user asks to open or show the app, keep the dev/preview server running until the lead agent or user stops it.
   - If you are a subagent and cannot keep a long-running process alive, say that plainly and return the exact app path, command, host, and port for the lead agent to start.
   - Do not report a dev URL as live after stopping the server.
   - Prefer binding local demos to an explicit host/port such as `127.0.0.1:5179` or `0.0.0.0:5179`, then verify the URL with HTTP checks before asking the user to open it.
7. Fix mismatches before final response.

## Create Or Extend A Design

Use this when the user asks v-1.design to create or evolve the design first.

Tool calls:

```text
create_design("brief", target="web|mobile|both", wait=true)
add_screen("<project-id-or-url>", "Settings", wait=true)
wait_for_design("<project-id-or-url>")
```

CLI:

```bash
v1design create "brief" --target web --wait
```

After generation completes, follow the Build From A Design workflow.

## Completion Standard

Before finalizing:

- Confirm the design ref used.
- Confirm which screens/routes were implemented.
- Mention tests, typechecks, lint, and visual checks actually run.
- Mention the live app URL only if a server is still running there.
- If something could not be verified, say so plainly.
