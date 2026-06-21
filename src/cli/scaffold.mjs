// scaffold orchestrator: one design ref → a runnable project on disk.
// fetch handoff → filter screens → build (next|expo) → write → optional
// install/run → write the on-system project contract + manifest.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  fetchHandoff, assertSafeWritePath, workspaceDirFor, expandHome,
  detectPackageManager, run, openUrl,
} from "./lib/engine.mjs";
import { buildNextProject } from "./scaffold/next.mjs";
import { buildExpoProject } from "./scaffold/expo.mjs";
import { writeProjectManifest } from "./project-manifest.mjs";
import { writeProjectContract } from "./project-skill.mjs";

/** Pick usable screens for a surface, honoring --screens and dropping specimens. */
export function selectScreens(handoff, { surface, screens } = {}) {
  let list = (handoff.screens || []).filter((s) => (s.kind ?? "screen") !== "specimen" && s.code);
  if (surface) list = list.filter((s) => (s.surface || "mobile") === surface);
  if (screens) {
    const want = String(screens).split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
    list = list.filter((s) => want.includes(String(s.name).toLowerCase()));
  }
  return list;
}

/** Decide the framework from explicit flag or the screens' surface. */
function resolveFramework(flags, screens) {
  if (flags.framework === "next" || flags.framework === "expo") return flags.framework;
  const surface = flags.surface || screens[0]?.surface || "web";
  return surface === "mobile" ? "expo" : "next";
}

async function writeFiles(root, files) {
  for (const [rel, contents] of Object.entries(files)) {
    const full = join(root, rel);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, contents);
  }
}

/**
 * Build + write a project from an already-resolved handoff + screen list.
 * Shared by scaffoldFromRef and remix. Returns the result descriptor (no install).
 */
export async function materializeProject(projectDir, { handoff, screens, surface, framework, flags = {} }) {
  const built = framework === "next"
    ? buildNextProject(handoff, screens, { name: flags.name, pm: flags.pm })
    : await buildExpoProject(handoff, screens, { name: flags.name, referenceOnly: flags["reference-only"] });
  await writeFiles(projectDir, built.files);
  await writeProjectManifest(projectDir, { handoff, surface, framework, screens });
  await writeProjectContract(projectDir, { handoff, framework, routes: built.routes });
  return built;
}

/**
 * @param ref    a design ref/slug/url
 * @param flags  CLI flags ({ out, target, surface, framework, screens, name,
 *               pm, install, run, "reference-only", "no-verify", strict,
 *               "allow-project-write", json })
 * @returns      { projectDir, framework, routes, runCommand, ref }
 */
export async function scaffoldFromRef(ref, flags = {}, log = console.error) {
  const handoff = await fetchHandoff(ref); // throws LibraryAccessError on 402

  const surface = flags.surface || handoff.screens?.find((s) => s.code)?.surface || "web";
  const screens = selectScreens(handoff, { surface, screens: flags.screens });
  if (!screens.length) {
    throw new Error(
      `No ${surface} screens with code found in "${ref}". ` +
      `Try --surface ${surface === "web" ? "mobile" : "web"} or a different design.`
    );
  }

  const framework = resolveFramework({ ...flags, surface }, screens);
  const out = flags.out || flags.target || workspaceDirFor(handoff.id || ref);
  const projectDir = await assertSafeWritePath(out, flags, "scaffold output");

  log(`Scaffolding ${framework === "next" ? "Next.js" : "Expo"} app from ${handoff.appName || ref} (${screens.length} screens)…`);

  const built = await materializeProject(projectDir, { handoff, screens, surface, framework, flags });

  const result = {
    projectDir,
    framework,
    surface,
    ref: handoff.id || ref,
    routes: built.routes,
    runCommand: built.runCommand,
  };

  if (flags.install || flags.run) {
    const pm = detectPackageManager(flags.pm);
    log(`Installing dependencies with ${pm}…`);
    const code = await run(pm, ["install"], { cwd: projectDir });
    if (code !== 0) log(`Warning: ${pm} install exited ${code}. Run it manually in ${projectDir}.`);
  }

  if (flags.run) {
    const pm = detectPackageManager(flags.pm);
    log(`Starting dev server… (Ctrl-C to stop)`);
    if (framework === "next") {
      // Auto-open once the server is up (best-effort, non-blocking).
      setTimeout(() => openUrl("http://localhost:3000"), 4000);
    }
    await run(pm, ["run", framework === "next" ? "dev" : "start"], { cwd: projectDir, interactive: true });
  }

  return result;
}

/** CLI entry for `v1design scaffold <ref>`. */
export async function scaffoldCommand(ref, flags) {
  if (!ref) throw new Error('Usage: v1design scaffold <design-ref> [--surface web|mobile] [--out ./dir] [--install] [--run]');
  const result = await scaffoldFromRef(ref, flags);

  // Run the verify gate unless explicitly skipped (and not in --run, which blocks).
  if (!flags["no-verify"] && !flags.run) {
    try {
      const { verifyProject } = await import("./verify.mjs");
      const report = await verifyProject(result.projectDir, {
        ...flags,
        against: result.ref,
        surface: result.surface,
        install: !flags.install ? true : false,
      });
      result.verify = report;
    } catch (e) {
      console.error(`Verify skipped: ${e instanceof Error ? e.message : e}`);
    }
  }

  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.error("");
    console.error(`✓ ${result.framework === "next" ? "Next.js" : "Expo"} app ready at ${result.projectDir}`);
    console.error(`  Routes: ${result.routes.map((r) => r.path).join("  ")}`);
    if (result.verify) {
      const v = result.verify;
      console.error(`  Verify: ${v.pass ? "PASSED ✓" : "issues found ✗"}  (build ${v.build ? "ok" : "FAIL"}, ${(v.routes || []).filter((r) => r.ok).length}/${(v.routes || []).length} routes 200)`);
    }
    if (!flags.run) {
      console.error(`  Next: cd ${shorten(result.projectDir)} && ${result.runCommand}`);
    }
  }
  return result;
}

function shorten(p) {
  const home = process.env.HOME;
  const abs = resolve(expandHome(p));
  return home && abs.startsWith(home) ? abs.replace(home, "~") : abs;
}
