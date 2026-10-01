# Coding-agent connect and pull evidence

**Localhost, development mode, synthetic Umer.** Codex drove the existing CLI and real local website/engine: connect → type verification code → authorize → Connected → search Pulse → pull 18 files into a separate git repo. No production authentication, provider generation, payment, deployment or package publication was exercised.

The warmed, automated flow completed in **6.698 seconds**, measured from launching `connect` to CLI exit 0. Authorization click started at 5.177 seconds. Browser launch, dependency installation, page/BFF compilation and a real human's typing time are excluded. This demonstrates the local flow within 30 seconds; it makes no hosted or cold-start timing claim.

## Inspect the evidence

- [Connect transcript](01-connect-authorize.txt), [timing](timing.json): actual CLI output and monotonic elapsed time. Session and PKCE URL parameters are redacted; credentials are never printed.
- [Before authorization](02-authorize-before.png), [Connected](03-authorize-connected.png): real chrome-devtools-axi screenshots; matching `.txt` files preserve browser snapshots.
- [Search and pull transcript](04-search-pull-files.txt): real engine result, 18 file writes, unchanged repeat pull, and git status.
- [Written-file inventory](files-written.json): relative paths, byte counts and SHA-256 hashes, including screens, design tokens and agent rules.
- [Connector response](05-mcp-connector.json): actual `bin/agent.mjs` stdio transport search, using the credentials saved in the isolated demo HOME; 18 tools advertised. This is an SDK transport probe driven by Codex, not a native tool reload in the running Codex session.
- [Coding-agent session](06-codex-session.md): curated execution transcript with provenance and limitations, not invented conversational turns. There is no video.
- [Seed output](seed.txt): deterministic local library setup, including source-quality warnings.

Candidate provenance: CLI `98fc78914ce62c2889be91edac3e109e85e5d77a`; engine `c64441ee810066aeb9157968d80dcda3f7aab9fb`; website `404a2e3cc781850ae4d9da03293103ab05a11551`, all feature/v2. Engine port 18917; website port 18918. Engine persistence is scratch `.data/`, with no Mongo/R2/provider configuration. Search's JSON says `backend: mongo-text`; that label is engine output, not proof Mongo was running.

## Reproduce safely

Run from the CLI checkout with Node 22+, Python 3, git and chrome-devtools-axi available. Use authorized source repositories and available local ports. The scripts assume fresh `scratchpad/` and `data/v1-pm-17/evidence/` directories. They never use the person's normal HOME for CLI credentials/configuration.

1. Create `scratchpad/engine` and `scratchpad/web`. Extract `git archive <engine-commit>` and `git archive <website-commit>` from the authorized repositories into those directories. This uses source snapshots, not extra git worktrees. Copy only the safe `library/pulse` design source into the engine snapshot: it is untracked and therefore missing from its archive. Do not copy `.env`, `.data`, credentials or account state.
2. Run `npm ci --ignore-scripts` in each snapshot, and `npm ci --ignore-scripts` in the CLI checkout if needed. Create `scratchpad/demo-home`, `scratchpad/bin`, `scratchpad/repos/umer-demo`, and `data/v1-pm-17/evidence`. Add an executable scratch `xdg-open` shim containing `#!/bin/sh` and `exit 0`; this suppresses automatic personal-app launch while chrome-devtools-axi opens the actual printed URL.
3. Copy `reproduce/seed.py`, `serve.py` and `record.py` into `scratchpad/`. Run `python scratchpad/seed.py`. It seeds the actual Pulse source with `--force-list` for this test catalog; this does not claim its Build proof gate passed. No generation call is made.
4. Run `python scratchpad/serve.py` in a dedicated authorized shell. It supplies an ephemeral synthetic BFF service token to both processes, uses a clean environment and starts the real engine plus Next development website. Do not set production Clerk keys or a production database. Stop this launcher after the demo to terminate its children.
5. Initialize the demo repo: `git -C scratchpad/repos/umer-demo init -b main`, then make an empty commit with synthetic Umer demo metadata. Keep its git history separate from the CLI repository.
6. Prewarm the isolated browser with `CHROME_DEVTOOLS_AXI_SESSION=v1-pm-17 chrome-devtools-axi newpage http://127.0.0.1:18918/authorize`. Use that session's `eval` command to run `() => { localStorage.setItem("ad.uid", "umer"); return "synthetic Umer"; }`. This sets only the existing development identity fixture on the demo origin. Prewarm the BFF POST routes `/api/agent/device-session` and `/api/agent/authorizations` with JSON `{ "uid": "umer" }`; expect 400 for missing required fields, not authorization success.
7. Run `python scratchpad/record.py`. It holds `/tmp/fm-desktop.lock` across the auth sequence, runs the real `connect --client codex --allow-project-write`, opens its actual URL via chrome-devtools-axi, fills the printed code and clicks the page button. It then runs status, search, pull and repeat pull inside the demo repo. Inspect the evidence and its timing instead of assuming the historical result reproduces.
8. Confirm the saved Connected screenshot and `cliExitCode: 0`; inspect all 18 files and their hashes. The isolated `.codex/config.toml` should register `v1design-agent`. To use that configuration in a new native agent session, expose the checkout's CLI bins on the demo PATH; configuration alone does not prove activation.

## Launch dependencies and limits

**O3:** hosted/production authorization remains unqualified. Production `resolveIdentity()` requires verified Clerk identity; the synthetic uid fallback exists only outside production. No UI or identity code was patched. A test Clerk/hosted account path needs separate authorized qualification.

[BYOKIT.md](../../../BYOKIT.md) records the current CLI's existing auth/config/MCP bypasses (A9/A12/F21) and the not-yet-live kit-native connect migration. This evidence uses those unchanged product paths. It adds no production integration and does not claim BYOKit auth migration or provider sign-in was demonstrated. No provider call was required for this free library search/pull.

Pulse was explicitly listed for this synthetic catalog with `--force-list`; its seed warnings are retained. Prior v1-pm-4 evidence documents pack/reference inconsistencies. This task establishes successful retrieval and file writes, not design-quality certification or a finished built app. Claude Code and Cursor were not independently run.
