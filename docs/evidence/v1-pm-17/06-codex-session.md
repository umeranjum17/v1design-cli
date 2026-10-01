# Recorded coding-agent session: Codex

This is a curated execution transcript from the actual Codex worker session, not a fabricated user/assistant conversation. Raw product command output is in `01-connect-authorize.txt` and `04-search-pull-files.txt`; browser snapshots and screenshots capture the real page. There is no video recording or native MCP tool reload in this session.

- The assigned task explicitly authorized choosing a real library design and writing files into a separate demo git repo.
- Codex inspected v1-pm-4 evidence, archived the engine and website feature/v2 sources into its own scratchpad, installed dependencies and seeded the safe Pulse source. No provider generation or payment was requested.
- Firstmate steer 002 authorized the existing development-mode synthetic Umer identity (`ad.uid=umer`), with production Clerk auth kept as dependency O3.
- Codex used the actual CLI `connect --client codex --allow-project-write` with an isolated HOME. Automatic xdg-open was suppressed using a scratch shim to avoid opening personal apps; the printed authorization URL was opened through chrome-devtools-axi instead. The normal engine device-session, code match, PKCE exchange and credential-save paths ran unchanged.
- Under `/tmp/fm-desktop.lock`, chrome-devtools-axi filled the CLI verification code and clicked the actual Authorize Agent button. The website displayed Connected; the CLI exited 0 after 6.698 seconds. The page, browser and BFF routes were warmed first; this is automated local flow timing, not human or hosted login timing.
- Codex ran status, searched analytics for web, selected Pulse (`pulse-5f8a2c10`), pulled it into a fresh git repo with Umer demo metadata, and re-pulled. Eighteen files were written; the repeat wrote nothing. The file inventory includes sizes and SHA-256 hashes.
- Codex also launched the real `bin/agent.mjs` connector with the demo HOME and no API key environment override. A real MCP SDK client listed 18 tools and called search against the running engine. This proves transport/credential reuse, not that a new MCP tool became available natively in the already-running Codex session.
- Codex inspected the Connected screenshot and product output before preparing this evidence guide. No CLI or UI code changed, and no production account, default branch, deployment or package publish was touched.
