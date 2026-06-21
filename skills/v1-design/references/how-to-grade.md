# How to grade a build

Two gates. Run both before you call anything done.

## Tier 1 — deterministic (free, always run)
`v1design verify <dir> --heal`
- Builds the project, boots it, and probes every route for HTTP 200 + a real
  (non-error, non-empty) page. Runs structural checks (fonts wired, tokens present,
  real route components, native screens on mobile). With `--heal` it attempts
  bounded auto-fixes and re-runs.
- A failure here is a hard stop. Fix it (or let `--heal` fix it) and re-run.

## Tier 2 — the WOW / visual verdict (authoritative)
`v1design grade <dir>`
- This asks the v-1.design oracle to score the running build against the design's
  own reference and the quality bar. It is the authoritative verdict — not your
  own eyeballing.
- To give it the most signal: with the app running, screenshot each route
  (1440×900 for web, 402×874 for mobile, device chrome ignored) and pass those to
  the grader so it compares your build to the reference per screen.
- If `grade` reports the build is below the bar, treat its findings as the fix
  list and iterate. Do not finalize until it passes.

## The rule
Default verdict is REJECT. "It renders" is not "it passes." Keep healing and
re-grading until both tiers are green, then report exactly what passed.
