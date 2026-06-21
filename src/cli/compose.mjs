// compose — generate NEW screens inside an existing design's system. For a
// design the user owns, the engine generates the screen in that exact system
// (POST /designs/:id/screens). The drift-guard: if run inside a scaffolded
// project, the target design must match the project's tokensHash.
import { apiRequest, normalizeRef } from "./lib/engine.mjs";
import { readProjectManifest } from "./project-manifest.mjs";

export async function composeCommand(ref, flags) {
  const target = ref ? normalizeRef(ref) : (await readProjectManifest(process.cwd()))?.designRef;
  if (!target) throw new Error("Usage: v1design compose <design-ref> --add \"Settings,Billing\" [--wait]");
  if (!flags.add) throw new Error('Pass --add "Screen1,Screen2" with the new screen name(s).');

  // Drift-guard: if we're inside a scaffolded project, refuse a foreign system.
  const manifest = await readProjectManifest(process.cwd());
  if (manifest?.designRef && manifest.designRef !== target) {
    throw new Error(
      `This project is on the ${manifest.designRef} system. Composing into a different design (${target}) would drift it off-system.\n` +
      `Run compose with no ref to add a screen to THIS app, or scaffold a new project for ${target}.`
    );
  }

  const names = String(flags.add).split(",").map((s) => s.trim()).filter(Boolean);
  const added = [];
  for (const name of names) {
    console.error(`Generating "${name}" in the ${target} system…`);
    const body = { name, surface: flags.surface || manifest?.surface };
    const res = await apiRequest("POST", `/designs/${encodeURIComponent(target)}/screens`, { body, refForAccess: target });
    added.push({ name, ...res });
  }

  if (flags.json) console.log(JSON.stringify({ ref: target, added }, null, 2));
  else {
    console.error(`✓ Requested ${added.length} screen(s) on ${target}.`);
    console.error(`  Pull them with: v1design designs get ${target}`);
  }
  return { ref: target, added };
}
