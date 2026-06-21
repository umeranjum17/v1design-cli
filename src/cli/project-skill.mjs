// Write a project-local design contract (AGENTS.md) + agent pointers so any
// coding agent that opens this repo stays on-system. The contract is derived
// from THIS app's own design — it carries no v-1.design methodology.
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

function accentSummary(designSystem) {
  const ds = designSystem || {};
  const light = ds.semantic?.light || {};
  return {
    accent: light.accent || ds.seedHex || "(see globals.css --accent)",
    fontDisplay: ds.typography?.fontDisplay || "(see globals.css)",
    fontBody: ds.typography?.fontBody || "(see globals.css)",
    vibe: ds.vibe || ds.name || "",
  };
}

function contract(handoff, framework, routes) {
  const a = accentSummary(handoff.designSystem);
  const routeList = (routes || []).map((r) => `- \`${r.path}\` — ${r.name}`).join("\n");
  const tokenHome = framework === "expo" ? "`global.css` + `theme.ts`" : "`app/globals.css`";
  return `# Design contract — ${handoff.appName || handoff.id}

This app was built from v-1.design design \`${handoff.id}\` (${a.vibe}). Keep every
change ON-SYSTEM. This file is the contract; the v-1.design skill enforces it.

## The design system (do not drift)
- Tokens live in ${tokenHome}. Style **only** via the design tokens
  (\`var(--token)\` / the theme), never hard-coded hex. New UI must reuse these tokens.
- Display font: **${a.fontDisplay}** · Body font: **${a.fontBody}**.
- One focal accent (\`${a.accent}\`) — use it sparingly, one peak per screen. Do not
  introduce a second saturated accent.

## Laws for any edit
- Real routes only — every screen is its own route, never tab-state in one file.
- ${framework === "expo" ? "Native RN primitives (View/Text/Pressable), expo-router, the shared chrome." : "Full viewport, responsive (1920 / 1280 / 390), no fixed-width shell."}
- Real content, no lorem. Empty/loading/error states where data is shown.
- After any UI change, run \`v1design verify --heal\` (and \`v1design grade\`) and do
  not finalize until it PASSES. Default verdict is REJECT.

## Routes
${routeList}

## Extend this app
- Add a screen in the SAME system: \`v1design compose ${handoff.id} --add "<Name>"\`.
- Re-skin the whole app live: \`v1design vibe "<darker | teal | ...>"\`.
`;
}

export async function writeProjectContract(projectDir, { handoff, framework, routes }) {
  await writeFile(join(projectDir, "AGENTS.md"), contract(handoff, framework, routes));

  // Cursor rule pointer — append, don't clobber.
  try {
    const rulesDir = join(projectDir, ".cursor", "rules");
    await mkdir(rulesDir, { recursive: true });
    await writeFile(
      join(rulesDir, "v1design.mdc"),
      `---\nalwaysApply: true\n---\nThis project follows the v-1.design contract in AGENTS.md.\nKeep every UI change on-system (tokens only, real routes) and run \`v1design verify --heal\` before finalizing.\n`
    );
  } catch {}

  // CLAUDE.md pointer — only create if absent (never overwrite a user's file).
  const claudePath = join(projectDir, "CLAUDE.md");
  if (!existsSync(claudePath)) {
    await writeFile(claudePath, `# Project guidance\n\nSee \`AGENTS.md\` for the v-1.design system contract. Keep every UI change on-system and run \`v1design verify --heal\` before finalizing.\n`);
  } else {
    const cur = await readFile(claudePath, "utf8").catch(() => "");
    if (!cur.includes("AGENTS.md")) {
      await writeFile(claudePath, cur.trimEnd() + `\n\n## Design system\nSee \`AGENTS.md\` for the v-1.design contract; keep UI on-system and run \`v1design verify --heal\`.\n`);
    }
  }
}
