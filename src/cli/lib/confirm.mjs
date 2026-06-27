// Hard gate for GENERATIVE commands (create / compose) — the ones that spend
// credits by generating new work on the user's v-1.design account. The CLI is
// library-first: search + pull (incl. your own designs) are always free and never
// gated. Creating is the ONLY thing that must be explicitly asked for.
//
// An agent driving the CLI runs non-interactively (no TTY): there we REFUSE unless
// the caller passed --yes, so a design can never be created by accident. A human at
// a terminal gets a y/N prompt.
import readline from "node:readline";

export async function requireCreateConfirmation(action, flags = {}) {
  if (flags.yes || flags.confirm || process.env.V1DESIGN_ALLOW_CREATE === "1") return true;

  const msg =
    `✋ "${action}" GENERATES a new design in v-1.design and spends credits.\n` +
    `   The CLI is library-first: search + pull (incl. your own designs) need no confirmation.\n` +
    `   Only create when the user has EXPLICITLY asked to create/generate a new design.`;

  if (!process.stdin.isTTY) {
    // Non-interactive (agent / CI): never create on intent. Require an explicit --yes.
    throw new Error(`${msg}\n   Refusing to create without confirmation. Re-run with --yes ONLY if the user explicitly asked to create.`);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const ans = await new Promise((res) =>
    rl.question(`${msg}\n   Proceed and create now? [y/N] `, (a) => res(String(a || "").trim().toLowerCase()))
  );
  rl.close();
  if (ans !== "y" && ans !== "yes") throw new Error("Cancelled — no design created.");
  return true;
}
