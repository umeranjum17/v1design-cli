# Changelog

## [Unreleased]

### Added
- `v1design gallery <folder>`: assembles the explore concept renders into a
  polished browser gallery (Lane A library adaptations vs Lane B fresh
  concepts) and opens it, so the user picks one concept to build from.
- Explore end-to-end flow: per-idea fresh folders (`v1-explore/<slug>/`),
  both lanes grounded in the user's repo and end-users, `--surface`,
  `--adapt N` / `--fresh N` overrides, per-concept PNG renders plus
  `manifest.json`, and relevance % on Lane A results.
- BUILD handoff: the picked concept is the binding spec for a REAL app in the
  surface stack — mobile → Expo React Native (Expo Router + NativeWind),
  web → Next.js. Lane A picks build via `v1design scaffold`, fresh picks via
  `v1design new` + authoring every screen as real `.tsx`, verified by build
  and render.

### Fixed
- Design links emitted by the CLI and MCP tools now point at
  `https://v-1.design/share/<id>` (the page that exists today). The old
  `https://v-1.design/studio/<id>` pages were removed from the web app and
  redirect to `/library`, so every emitted studio link was landing on the
  wrong page. Previously shared studio links are still accepted as input
  refs. (`v1design studio` JSON output field renamed `studioUrl` → `shareUrl`.)
- Explore concept-render rules: no on-screen keyboard, no OS chrome or device
  bezel, one cohesive screen (not a long scroll), light mode by default.
