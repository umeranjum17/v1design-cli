# BYOKit rule

Everything in this repo must go through BYOKit: no new direct third-party or
foundational integrations (AI/vendor SDKs, auth, pairing, payments, databases,
queues, storage, email, analytics, MCP transport, package acquisition). If
BYOKit lacks something, the capability is fixed and added in BYOKit — this
repo never goes raw. The listed bypasses remain migration debt until their
replacement kit contracts are published and adopted (keep live features working).
The Studio host already uses the pinned `@byokit/openclaw` and `@byokit/secrets`
dependencies for subscription generation, provider sign-in and sealed host keys.
This is separate from CLI connection migration: the kit-side connect
flow (link/relay/reach + openclaw pairing and sign-in state) is not live here
yet, so no BYOKit connect command is documented — never invent one.

## Remaining bypasses (migration debt, do not rewrite here)

Per the v1 BYOKit audit's ordered migration packages (package 0 is this
cleanup; packages 1–10 do the migrations once BYOKit main publishes the
contracts):

- `src/cli/auth.ts` — custom PKCE device/loopback login and plaintext
  `~/.v1design/credentials.json` (audit A9) → proposed `auth` + `credentials`
  kits; packages 1, 3.
- `src/cli/main.mjs` (`connect`, `configureCodex/Cursor`, `runClaudeSetup`,
  skill install) — direct agent-client config writes and `claude mcp add`
  invocation (audit A12) → `openclaw`/`herdr` + proposed `mcp` kit;
  packages 1, 3, 9.
- `src/mcp/` — direct MCP SDK stdio transport and notifications (audit F21) →
  proposed `@byokit/mcp`; packages 1, 9.
- `.github/workflows/publish.yml`, `src/cli/lib/engine.mjs`, scaffold install
  steps — npm registry release/install boundary (audit F22) → proposed
  `@byokit/npm`; packages 1, 9.
- `README.md` connect section and `skills/v1-design/SKILL.md` describe the
  current `v1design connect` flow (audit A14) — kept truthful until the kit
  connect flow above is live; packages 3, 4, 10.
