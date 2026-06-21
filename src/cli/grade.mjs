// grade — the Tier-2 WOW/visual verdict. This is the gated, founder-cost oracle:
// it asks the engine to score the build against the reference + the awe rubric.
// The CLI never embeds the rubric; it only calls the oracle and relays the score.
// Until the engine endpoint is deployed, grade degrades to the deterministic gate.
import { apiRequest } from "./lib/engine.mjs";
import { readProjectManifest } from "./project-manifest.mjs";
import { verifyProject } from "./verify.mjs";

/**
 * Ask the engine oracle to grade a build. `shots` is an optional array of
 * { route, pngBase64 } the caller (an agent) captured of the running app.
 */
export async function gradeProject(dir, flags = {}, log = console.error) {
  const manifest = await readProjectManifest(dir);
  const ref = flags.against || manifest?.designRef;
  if (!ref) throw new Error("No design ref — pass --against <ref> or run inside a scaffolded project.");

  // Always run the free deterministic gate first.
  const deterministic = await verifyProject(dir, { ...flags, install: true }, log);

  let oracle = null;
  try {
    oracle = await apiRequest("POST", `/designs/${encodeURIComponent(ref)}/critique`, {
      body: { surface: flags.surface || manifest?.surface, shots: flags.shots || [] },
    });
  } catch (e) {
    const msg = String(e.message || e);
    if (/\b(404|405)\b/.test(msg)) {
      oracle = { available: false, note: "WOW oracle not yet deployed; deterministic gate only." };
    } else {
      oracle = { available: false, note: msg };
    }
  }

  return {
    ref,
    pass: deterministic.pass && (oracle?.available === false ? true : Boolean(oracle?.pass)),
    deterministic,
    oracle,
  };
}

export async function gradeCommand(dir, flags) {
  const target = dir || process.cwd();
  const report = await gradeProject(target, flags);
  if (flags.json) { console.log(JSON.stringify(report, null, 2)); return report; }
  console.error("");
  console.error(report.pass ? "✓ GRADE PASS" : "✗ GRADE: not at the bar yet");
  console.error(`  deterministic gate: ${report.deterministic.pass ? "pass" : "FAIL"}`);
  if (report.oracle?.available === false) console.error(`  WOW oracle: ${report.oracle.note}`);
  else if (report.oracle) {
    console.error(`  WOW oracle: ${report.oracle.pass ? "pass" : "below bar"}`);
    if (report.oracle.scores) console.error(`  scores: ${JSON.stringify(report.oracle.scores)}`);
    if (report.oracle.issues?.length) for (const i of report.oracle.issues) console.error(`   - ${i}`);
  }
  if (!report.pass) process.exitCode = 1;
  return report;
}
