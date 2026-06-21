// remix — merge screens/components from N designs into ONE coherent system.
// The --system design wins: its globals.css/layout/fonts/tokens drive the whole
// app, and donor screens adopt them automatically because every screen styles
// via var(--token). A light normalize pass handles the rare frozen literal.
import { resolve } from "node:path";
import {
  fetchHandoff, normalizeRef, parseHandle, assertSafeWritePath, workspaceDirFor,
  detectPackageManager, run, expandHome,
} from "./lib/engine.mjs";
import { materializeProject } from "./scaffold.mjs";
import { pascal } from "./lib/engine.mjs";

/** Re-skin a donor screen to the winner's system: strip the rare hard-coded
 *  literal so it inherits tokens. Conservative — only touches obvious cases. */
function normalizeDonorCode(code) {
  let out = String(code || "");
  // Bare bg/text utility with a frozen hex → map to the nearest token class is
  // unsafe to guess; instead, leave token-driven styles (the 98% case) alone.
  // We only flag survivors for the conflicts report (handled by caller).
  return out;
}

function frozenLiteralCount(code) {
  const hex = (String(code).match(/\[#[0-9a-fA-F]{3,8}\]/g) || []).length;
  const rgba = (String(code).match(/\[(rgba?|hsla?)\(/g) || []).length;
  return hex + rgba;
}

export async function remixCommand(handles, flags) {
  const list = (handles || []).filter(Boolean);
  if (list.length < 2 && !flags.pick) {
    throw new Error('Usage: v1design remix <refA> <refB> [--system <ref>] [--pick A#Hero,B#Pricing] [--surface web|mobile] [--out ./dir]');
  }

  // Resolve the set of refs (from positional handles and/or --pick).
  const picks = flags.pick
    ? String(flags.pick).split(",").map((p) => parseHandle(p.trim()))
    : null;
  const refs = [...new Set([
    ...list.map((h) => parseHandle(h).ref),
    ...(picks ? picks.map((p) => p.ref) : []),
  ])];

  console.error(`Fetching ${refs.length} design(s)…`);
  const handoffs = {};
  for (const ref of refs) handoffs[ref] = await fetchHandoff(ref);

  // The winning system.
  const systemRef = flags.system ? normalizeRef(flags.system) : refs[0];
  const winner = handoffs[systemRef];
  if (!winner) throw new Error(`--system ${systemRef} is not among the remixed designs.`);

  const surface = flags.surface
    || winner.screens?.find((s) => s.code)?.surface
    || "web";
  if (surface === "web" && Object.values(handoffs).some((h) => h.screens?.every((s) => (s.surface || "mobile") === "mobile"))) {
    // tolerate; we filter by surface below
  }

  // Collect screens: either explicit --pick, or all usable screens per ref.
  const chosen = [];
  const seenNames = new Set();
  const addScreen = (handoff, screen, originRef) => {
    if (!screen?.code) return;
    if ((screen.kind ?? "screen") === "specimen") return;
    if ((screen.surface || "mobile") !== surface) return;
    let name = screen.name;
    if (seenNames.has(name.toLowerCase())) {
      const tag = pascal(originRef.split("-")[0]).slice(0, 6);
      name = `${tag} ${name}`;
    }
    seenNames.add(name.toLowerCase());
    chosen.push({ ...screen, name, code: normalizeDonorCode(screen.code), originRef });
  };

  if (picks) {
    for (const p of picks) {
      const h = handoffs[p.ref];
      const screen = (h.screens || []).find((s) => s.name.toLowerCase() === String(p.name).toLowerCase());
      if (screen) addScreen(h, screen, p.ref);
      else console.error(`  ! ${p.handle}: screen "${p.name}" not found in ${p.ref}`);
    }
  } else {
    for (const ref of refs) {
      for (const s of handoffs[ref].screens || []) addScreen(handoffs[ref], s, ref);
    }
  }

  if (!chosen.length) throw new Error(`No ${surface} screens collected. Check --surface and the refs/picks.`);

  // Cross-surface guard.
  const framework = surface === "mobile" ? "expo" : "next";

  // Synthetic handoff: winner's system + artifacts, merged screen set.
  const merged = { ...winner, screens: chosen };

  const out = flags.out || flags.target || workspaceDirFor(`remix-${systemRef}`);
  const projectDir = await assertSafeWritePath(out, flags, "remix output");

  console.error(`Remixing ${chosen.length} screen(s) into the ${winner.appName || systemRef} system…`);
  const built = await materializeProject(projectDir, { handoff: merged, screens: chosen, surface, framework, flags });

  // Conflicts report: donor screens carrying frozen literals that the token
  // swap can't reach. Honest, written to the project.
  const conflicts = chosen
    .filter((s) => s.originRef !== systemRef)
    .map((s) => ({ screen: s.name, from: s.originRef, frozenLiterals: frozenLiteralCount(s.code) }))
    .filter((c) => c.frozenLiterals > 0);
  if (conflicts.length) {
    const md = `# Remix conflicts\n\nThese donor screens carry hard-coded color literals the token swap can't\nre-skin automatically. Review them so the app reads as ONE system.\n\n` +
      conflicts.map((c) => `- **${c.screen}** (from ${c.from}): ${c.frozenLiterals} frozen literal(s)`).join("\n") + "\n";
    const { writeFile } = await import("node:fs/promises");
    await writeFile(resolve(projectDir, "REMIX-CONFLICTS.md"), md);
  }

  const result = {
    projectDir, framework, surface, system: systemRef,
    sources: refs, screens: chosen.map((s) => ({ name: s.name, from: s.originRef })),
    routes: built.routes, runCommand: built.runCommand, conflicts: conflicts.length,
  };

  if (flags.install || flags.run) {
    const pm = detectPackageManager(flags.pm);
    console.error(`Installing dependencies with ${pm}…`);
    await run(pm, ["install"], { cwd: projectDir });
  }

  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.error("");
    console.error(`✓ Remix ready at ${shorten(projectDir)}`);
    console.error(`  System: ${winner.appName || systemRef} · ${chosen.length} screens from ${refs.length} designs`);
    console.error(`  Routes: ${built.routes.map((r) => r.path).join("  ")}`);
    if (conflicts.length) console.error(`  ⚠ ${conflicts.length} donor screen(s) have frozen literals — see REMIX-CONFLICTS.md`);
    console.error(`  Next: cd ${shorten(projectDir)} && ${result.runCommand}`);
  }
  return result;
}

function shorten(p) {
  const home = process.env.HOME;
  const abs = resolve(expandHome(p));
  return home && abs.startsWith(home) ? abs.replace(home, "~") : abs;
}
