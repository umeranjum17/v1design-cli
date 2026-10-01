# v1-pm-4 (J2): a real library design pulled into a real repo and built by an agent

**Surface: localhost.** The engine is origin/feature/v2 `c64441e`, running in a scratch copy in file mode with no production data or keys. The CLI is origin/feature/v2 plus this branch. No production URL was used.

- **Design:** `pulse-5f8a2c10` ("Pulse", free tier, 5 web screens), seeded from `library/pulse` into the engine's local file library.
- **Repo:** a fresh `npm create vite@latest -- --template react-ts` app (`umer-metrics`), a git repo outside every project. The demo member is Umer.
- **Agent:** Claude Code (Opus 5.5), following the pulled pack's `CLAUDE.md`, `WORK-ORDER.md`, `DESIGN.md` and `design-tokens.json`.

## Files

| File | What it shows |
|---|---|
| `01-pull-transcript.txt` | The `pull --dry-run`, the real pull, then an identical re-pull, all on the **unfixed** feature/v2 CLI. |
| `02-repull-after-fix-transcript.txt` | The same repo after the agent's commits, with this branch's CLI: `Would write 0 of 18`, then `Already up to date`, and a clean `git status`. |
| `04-agent-build-log.md` | Each step, the pack conflict found, the 2 fix passes with RMSE figures, and the match verdict. |
| `sbs-overview-final.png`, `sbs-analytics-final.png` | The demo (the engine's `/render`) beside the built app at 1440 px, full page. |

The full set, including round-1 side-by-sides, separate demo and built PNGs, and the built app's commit diff, is in `firstmate/data/v1-pm-4/evidence/`.

## Result

- **Pull:** the plan, the writes between markers and the idempotent re-pull all work in a real repo.
- **Overview and Analytics:** they match the demo in layout, type and colour after 2 fix passes. Pixel RMSE is 2.9 % and 6.0 %, and page heights are within 1 px.
- **Remaining colour difference:** the amber is a touch deeper, because the tokens are oklch while the reference hard-codes hex.

## CLI fix in this PR

The no-op re-pull printed `Wrote 0 files into <dir>:` with nothing under it, followed by "Next: ask your agent…". The dry run of an already-pulled repo claimed `Would write 18 files` while every row said `unchanged`. The fixes:

- `pull` now prints `Already up to date: all N files in <dir> match <ref> — nothing written.`
- `--dry-run` now prints `Would write X of N files`.

Both are covered in `test/pull.test.mjs`.

## Follow-ups, not fixed here (engine and library)

1. **Stale per-route prompts (high).** `prompts/*.md` and `PROMPT.md` for Pulse describe the retired dark indigo design (Space Grotesk, MRR $84,320). The tokens, `DESIGN.md`, `screens/*.tsx` and the demo describe the light "Warm Ledger" design (MRR $81,347). `WORK-ORDER.md` tells the agent to "build the route from its prompt file", so an agent that follows it literally builds the wrong design.
2. **False Windsurf claim.** The pack prompts still say "Works in … Windsurf" (the scorecard's Windsurf finding).
3. **Hard-coded hex in the reference screens.** The reference `screens/*.tsx` hard-code hex, which the pack's own rule "Never hard-code hex" forbids, and the seed linter warns on all 5 screens. `screens/Analytics.tsx` also ships leftover maths scratch comments.
4. **Missing Revenue prompt.** `screens/Revenue.tsx` ships without a `prompts/Revenue.md`, and Revenue is missing from the work-order routes.
5. **`/render` takes ids only.** `GET /render/:id/:screen` resolves ids only, so the slug the member pulls with (`pulse-5f8a2c10`) returns 404 there.
6. **Library sources not tracked on feature/v2.** Library design sources are untracked on engine feature/v2, so a local engine needs `library/<slug>` copied in and then `scripts/seed-library.mts`.
7. **Demo sidebar height.** In the demo of Overview, the sidebar ends at the viewport height on long pages.
