---
name: v1-design
description: Build real apps from v-1.design Studio, share, or Library links using the v1design CLI and local connector. Use when the user asks to point an agent at a v-1.design design, install/connect the v-1.design agent or CLI, pull a design handoff, implement screens from v-1.design references, continue a generated design in a codebase, or create a new design through v-1.design and then build it end to end.
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
- Visually verify against the v-1.design references before finalizing.

## Connection Flow

1. Run the seamless setup:

```bash
npm install -g @v1design/cli
v1design connect
```

This installs the skill, opens v-1.design in the browser, lets the user click Authorize, stores the connection locally in `~/.v1design/credentials.json`, and configures supported local agent clients. Do not print, request, or hand-copy credentials.

2. If troubleshooting, check connection status:

```bash
v1design status
```

3. If only browser authorization needs to be repeated, run `v1design login`.

## Build From A Design

1. Inspect the target repo first: package manager, framework, routing, styling system, component conventions, and existing test/dev scripts.
2. Fetch the handoff.

Prefer tool calls:

```text
get_design("<v-1.design-url-or-id>")
get_screen_code("<v-1.design-url-or-id>", "<screen name>")
```

CLI fallback:

```bash
v1design designs get "<v-1.design-url-or-id>"
v1design pull "<v-1.design-url-or-id>" --out v1design-handoff.zip
v1design screens get "<v-1.design-url-or-id>" "<screen name>" --out Screen.tsx
```

3. Read the handoff for design tokens, global CSS, screen names, surfaces, dependencies, and component contracts.
4. Pull each screen's rendered reference image and TSX. Use the image for visual truth and the TSX/tokens for implementation detail.
5. Implement in the target repo's native style:
   - Add or merge token CSS carefully.
   - Extract shared navigation/chrome once.
   - Create real routes/screens.
   - Wire expected interactions and state.
   - Install missing UI/icon/font dependencies only when needed.
6. Run the app and verification commands. Use screenshots or browser checks where the UI matters.
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
- If something could not be verified, say so plainly.
