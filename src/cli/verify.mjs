// The verify gate — Tier-1, deterministic, zero model cost, runs in the user's
// own environment. Builds the project, boots it, probes every route for HTTP 200
// + non-error HTML, and runs structural checks. With --heal it attempts bounded
// auto-fixes and re-runs. The Tier-2 visual/WOW verdict is the gated engine
// oracle (see grade.mjs) which the agent invokes with a screenshot.
import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { readProjectManifest } from "./project-manifest.mjs";
import { detectPackageManager, run } from "./lib/engine.mjs";

const PROBE_PORT = Number(process.env.V1DESIGN_VERIFY_PORT || 3187);

function pass(name) { return { name, ok: true }; }
function fail(name, detail) { return { name, ok: false, detail }; }

async function listRouteDirs(projectDir) {
  // Discover Next routes by scanning app/** for page.tsx.
  const appDir = join(projectDir, "app");
  const routes = new Set(["/"]);
  if (!existsSync(appDir)) return [...routes];
  async function walk(dir, base) {
    let entries = [];
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (e.name.startsWith("(") || e.name.startsWith("_")) { await walk(join(dir, e.name), base); continue; }
        const seg = `${base}/${e.name}`;
        if (existsSync(join(dir, e.name, "page.tsx"))) routes.add(seg);
        await walk(join(dir, e.name), seg);
      }
    }
  }
  await walk(appDir, "");
  return [...routes];
}

function waitForServer(logFile, port) {
  return new Promise((resolve) => {
    const start = Date.now();
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) });
        if (res.status > 0) { clearInterval(timer); resolve(true); }
      } catch {}
      if (Date.now() - start > 90000) { clearInterval(timer); resolve(false); }
    }, 700);
  });
}

async function probeRoutes(port, routes) {
  const results = [];
  for (const r of routes) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}${r}`, { signal: AbortSignal.timeout(15000) });
      const html = await res.text();
      const errorPage = /__next_error__|Application error: a (client|server)-side exception|Internal Server Error/i.test(html);
      const empty = html.replace(/<[^>]+>/g, "").trim().length < 20;
      results.push({ route: r, status: res.status, ok: res.status === 200 && !errorPage && !empty, errorPage, empty });
    } catch (e) {
      results.push({ route: r, status: 0, ok: false, detail: String(e.message || e) });
    }
  }
  return results;
}

// ── deterministic source checks (Tier-1 taste gate, cheap) ────────────────
async function structuralChecks(projectDir, framework) {
  const checks = [];
  const screensDir = join(projectDir, "components", "screens");
  const screenFiles = existsSync(screensDir)
    ? (await readdir(screensDir)).filter((f) => f.endsWith(".tsx"))
    : [];

  // fonts wired (web)
  if (framework === "next") {
    const layout = await readFile(join(projectDir, "app", "layout.tsx"), "utf8").catch(() => "");
    checks.push(/fonts\.googleapis\.com/.test(layout) ? pass("fonts wired") : fail("fonts wired", "no Google Fonts link in layout"));
    const globals = await readFile(join(projectDir, "app", "globals.css"), "utf8").catch(() => "");
    checks.push(/--background|@theme/.test(globals) ? pass("tokens present") : fail("tokens present", "globals.css has no design tokens"));
  }

  // real routes (not a single artboard)
  checks.push(screenFiles.length >= 1 ? pass("real route components") : fail("real route components", "no screen components found"));

  // mobile: screenshot-as-screen is a FAIL unless reference-only
  if (framework === "expo") {
    const manifest = await readProjectManifest(projectDir);
    const tabsDir = join(projectDir, "app", "(tabs)");
    const tabFiles = existsSync(tabsDir) ? (await readdir(tabsDir)).filter((f) => f.endsWith(".tsx") && f !== "_layout.tsx") : [];
    let screenshotScreens = 0;
    for (const f of tabFiles) {
      const src = await readFile(join(tabsDir, f), "utf8").catch(() => "");
      const ref = src.includes("@/components/screens/") ? await readFile(join(screensDir, src.match(/@\/components\/screens\/(\w+)/)?.[1] + ".tsx" || ""), "utf8").catch(() => "") : src;
      if (/source=\{\{\s*uri:\s*["']https?:\/\/[^"']*\/shot\//.test(ref)) screenshotScreens++;
    }
    checks.push(screenshotScreens === 0 ? pass("native screens (no screenshot cop-out)") : fail("native screens", `${screenshotScreens} screen(s) render a screenshot instead of native UI`));
  }

  return checks;
}

async function buildProject(projectDir, framework, pm, log) {
  if (framework === "next") {
    log("Building (next build)…");
    const code = await run(pm, ["run", "build"], { cwd: projectDir });
    return code === 0;
  }
  // expo: typecheck + web export
  log("Type-checking + exporting (expo)…");
  const tc = await run("npx", ["tsc", "--noEmit"], { cwd: projectDir });
  const ex = await run("npx", ["expo", "export", "--platform", "web"], { cwd: projectDir });
  return tc === 0 && ex === 0;
}

async function bootAndProbe(projectDir, framework, pm, log) {
  if (framework !== "next") {
    // expo web export served check is heavier; the build gate covers it for now.
    return { booted: true, routes: [], note: "expo runtime probe deferred to build/export" };
  }
  const routes = await listRouteDirs(projectDir);
  log(`Booting server, probing ${routes.length} route(s)…`);
  const logFile = join(projectDir, ".v1design", "verify-server.log");
  const child = spawn(pm, ["run", "start", "--", "-p", String(PROBE_PORT)], {
    cwd: projectDir, stdio: "ignore", env: { ...process.env, PORT: String(PROBE_PORT) },
  });
  try {
    const up = await waitForServer(logFile, PROBE_PORT);
    if (!up) return { booted: false, routes: [] };
    const results = await probeRoutes(PROBE_PORT, routes);
    return { booted: true, routes: results };
  } finally {
    try { child.kill("SIGTERM"); } catch {}
  }
}

// ── heal: bounded, known deterministic fixes ──────────────────────────────
async function attemptHeal(projectDir, framework, log) {
  let changed = false;
  const screensDir = join(projectDir, "components", "screens");
  if (existsSync(screensDir)) {
    for (const f of (await readdir(screensDir)).filter((x) => x.endsWith(".tsx"))) {
      const p = join(screensDir, f);
      let src = await readFile(p, "utf8");
      // missing "use client" but uses hooks/handlers
      if (!/^\s*["']use client["']/.test(src) && /\buse(State|Effect|Ref|Memo)\b|\bon[A-Z]\w+=\{/.test(src)) {
        src = `"use client";\n\n${src}`;
        await writeFile(p, src);
        changed = true;
        log(`  heal: added "use client" to ${f}`);
      }
    }
  }
  return changed;
}

/**
 * Verify a scaffolded project. Returns a structured report.
 * @param dir    project directory
 * @param flags  { heal, against, surface, json, install }
 */
export async function verifyProject(dir, flags = {}, log = console.error) {
  const manifest = await readProjectManifest(dir);
  const framework = manifest?.framework || (existsSync(join(dir, "app.json")) ? "expo" : "next");
  const pm = detectPackageManager(flags.pm);

  if (flags.install && !existsSync(join(dir, "node_modules"))) {
    log("Installing dependencies…");
    await run(pm, ["install"], { cwd: dir });
  }

  const maxRounds = flags.heal ? 3 : 1;
  let report = null;
  for (let round = 1; round <= maxRounds; round++) {
    const structural = await structuralChecks(dir, framework);
    const built = await buildProject(dir, framework, pm, log);
    const probe = built ? await bootAndProbe(dir, framework, pm, log) : { booted: false, routes: [] };

    const routeFails = (probe.routes || []).filter((r) => !r.ok);
    const structuralFails = structural.filter((c) => !c.ok);
    const ok = built && probe.booted !== false && routeFails.length === 0 && structuralFails.length === 0;

    report = {
      pass: ok,
      framework,
      round,
      build: built,
      booted: probe.booted,
      routes: probe.routes,
      structural,
      note: probe.note,
    };

    if (ok || !flags.heal) break;
    log(`Round ${round} failed — attempting heal…`);
    const healed = await attemptHeal(dir, framework, log);
    if (!healed) break;
  }

  return report;
}

/** CLI entry for `v1design verify [dir]`. */
export async function verifyCommand(dir, flags) {
  const target = dir || process.cwd();
  const report = await verifyProject(target, { ...flags, install: true });
  if (flags.json) { console.log(JSON.stringify(report, null, 2)); return report; }

  console.error("");
  console.error(report.pass ? "✓ VERIFY PASSED" : "✗ VERIFY FAILED");
  console.error(`  build: ${report.build ? "ok" : "FAILED"}`);
  for (const c of report.structural) console.error(`  ${c.ok ? "✓" : "✗"} ${c.name}${c.detail ? " — " + c.detail : ""}`);
  for (const r of report.routes || []) console.error(`  ${r.ok ? "✓" : "✗"} ${r.route} (${r.status})`);
  if (report.note) console.error(`  note: ${report.note}`);
  if (!report.pass) {
    console.error("");
    console.error("  For the WOW/visual verdict, an agent can screenshot each route and run: v1design grade <dir>");
    process.exitCode = 1;
  }
  return report;
}
