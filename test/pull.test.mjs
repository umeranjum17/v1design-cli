// v1design pull into-repo mode: fake-engine tests (no network, no account).
// Run with: npx tsx --test test/pull.test.mjs
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promises as fs } from "node:fs";
import {
  PACK_START,
  PACK_END,
  PULL_STATE_REL,
  SUPPORTED_PACK_VERSION,
  detectProjectRoot,
  resolvePullMode,
  targetDirFor,
  parseAgents,
  extractBlock,
  mergeAgentFile,
  planPackWrites,
  planFileWrite,
  readPullState,
  assertSupportedPackVersion,
  fetchProjectPack,
  pullIntoCommand,
} from "../src/cli/pull.mjs";
import { LibraryAccessError } from "../src/cli/lib/engine.mjs";

process.env.V1_DESIGN_API_URL = "https://engine.test";
process.env.V1_DESIGN_API_KEY = "fake-test-key";

const block = (body) => `${PACK_START}\n${body}\n${PACK_END}\n`;
const TOKENS = '{"accent":"#123456"}\n';
const { createHash } = await import("node:crypto");
const TOKENS_HASH = createHash("sha256").update(TOKENS).digest("hex");
const manifest = (rulesBody, overrides = {}) => ({
  version: 1,
  appName: "Demo App",
  designId: "demo-1",
  tokensHash: TOKENS_HASH,
  files: [
    { path: "DESIGN.md", content: "# Demo App design system\n" },
    { path: "design-tokens.json", content: TOKENS },
    { path: "PROMPT.md", content: "Build the demo app.\n" },
    { path: "WORK-ORDER.md", content: "# Work order\n\nFollow route by route.\n" },
    { path: "work-order.json", content: JSON.stringify({ version: 1, designId: "demo-1", routes: [] }) + "\n" },
    { path: "agents/CLAUDE.md", content: `# Project rules\n\n${block(rulesBody)}` },
    { path: "agents/AGENTS.md", content: `# AGENTS.md\n\n${block(rulesBody)}` },
    { path: "agents/v1design.mdc", content: `---\ndescription: demo\n---\n\n${block(rulesBody)}` },
    { path: "prompts/Home.md", content: "Build the Home screen.\n" },
    { path: "screens/Home.tsx", content: "export default function Home() {}\n" },
  ],
  ...overrides,
});

const SEARCH_RESULTS = {
  results: [
    { type: "design", handle: "demo-1", appName: "Demo App" },
    { type: "screen", handle: "demo-1#Home", design: "Demo App", screen: "Home", surface: "web" },
  ],
};

const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const fail = (status, body) => ({ ok: false, status, json: async () => body, text: async () => JSON.stringify(body) });

// Fake engine: scenario "pack" serves the manifest, "denied" 402s, "missing" 404s,
// "forbidden" 403s the project pack, "gone" 404s it, "noauth" 401s it.
function fakeEngine(scenario, rulesBody = "# v1 rules") {
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.pathname === "/api/search") return ok(SEARCH_RESULTS);
    if (u.pathname.startsWith("/designs/") && u.searchParams.get("format") === "pack") {
      if (scenario === "denied") return fail(402, { error: "library_required" });
      if (scenario === "missing") return fail(404, { error: "not_found" });
      return ok(manifest(rulesBody));
    }
    if (/^\/api\/projects\/[^/]+\/pack$/.test(u.pathname)) {
      if (!String(init.headers?.authorization || "").startsWith("Bearer ")) return fail(401, { error: "unauthorized" });
      if (scenario === "forbidden") return fail(403, { error: "forbidden" });
      if (scenario === "gone") return fail(404, { error: "not_found" });
      return ok(manifest(rulesBody));
    }
    throw new Error(`unexpected engine call ${url}`);
  };
}

let lines;
const origLog = console.log;
beforeEach(() => {
  lines = [];
  console.log = (...args) => { lines.push(args.join(" ")); };
});
afterEach(() => { console.log = origLog; });

const out = () => lines.join("\n");
async function mkproject(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), "pull-test-"));
  await fs.writeFile(join(dir, "package.json"), '{"name":"t"}\n');
  for (const [rel, content] of Object.entries(files)) {
    await fs.mkdir(join(dir, ...rel.split("/").slice(0, -1)), { recursive: true }).catch(() => {});
    await fs.writeFile(join(dir, rel), content);
  }
  return dir;
}

test("pull into-mode writes the pack into the repo and prints the next step", async () => {
  fakeEngine("pack");
  const dir = await mkproject();
  const res = await pullIntoCommand("demo-1", {}, { dir });
  assert.equal(res.status, "done");
  for (const rel of ["DESIGN.md", "design-tokens.json", "PROMPT.md", "CLAUDE.md", "AGENTS.md",
    join(".cursor", "rules", "v1design.mdc"), join("prompts", "Home.md"), join("screens", "Home.tsx")]) {
    assert.ok((await fs.stat(join(dir, rel))).isFile(), `pack file written: ${rel}`);
  }
  assert.match(await fs.readFile(join(dir, "CLAUDE.md"), "utf8"), new RegExp(PACK_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(await fs.readFile(join(dir, "WORK-ORDER.md"), "utf8"), /Follow route by route/);
  assert.match(out(), /ask your agent to follow WORK-ORDER\.md/);
  const state = JSON.parse(await fs.readFile(join(dir, PULL_STATE_REL), "utf8"));
  assert.equal(state.version, SUPPORTED_PACK_VERSION);
  assert.equal(state.designId, "demo-1");
  assert.equal(state.tokensHash, TOKENS_HASH);
  assert.equal(state.source, "library");
});

test("second identical pull produces no changes", async () => {
  fakeEngine("pack");
  const dir = await mkproject();
  const first = await pullIntoCommand("demo-1", {}, { dir });
  assert.equal(first.status, "done");
  assert.ok(first.plan.some((p) => p.mode !== "unchanged"), "first pull writes");
  lines.length = 0;
  const second = await pullIntoCommand("demo-1", {}, { dir });
  assert.equal(second.status, "done");
  assert.ok(second.plan.length > 0, "plan still lists files");
  assert.ok(second.plan.every((p) => p.mode === "unchanged"), `second pull changes nothing, got: ${second.plan.filter((p) => p.mode !== "unchanged").map((p) => p.rel).join(",")}`);
  assert.match(out(), /Wrote 0 files/);
});

test("pull warns when remote tokens moved since the last pull", async () => {
  fakeEngine("pack");
  const dir = await mkproject();
  await pullIntoCommand("demo-1", {}, { dir });
  lines.length = 0;
  const moved = manifest("# v1 rules");
  moved.tokensHash = "0".repeat(64);
  moved.files = moved.files.map((f) => (f.path === "design-tokens.json" ? { ...f, content: '{"accent":"#654321"}\n' } : f));
  await pullIntoCommand("demo-1", {}, { dir, fetchPack: async () => moved });
  assert.match(out(), /stale tokens/);
  assert.equal(await fs.readFile(join(dir, "design-tokens.json"), "utf8"), '{"accent":"#654321"}\n');
  assert.equal(readPullState(dir).tokensHash, "0".repeat(64));
});

test("pull refuses an unknown future pack version", async () => {
  fakeEngine("pack");
  const dir = await mkproject();
  await assert.rejects(
    pullIntoCommand("demo-1", {}, { dir, fetchPack: async () => manifest("# v1 rules", { version: SUPPORTED_PACK_VERSION + 1 }) }),
    /newer than this CLI understands/
  );
  assert.throws(() => assertSupportedPackVersion({ version: 99 }), /newer than this CLI understands/);
  assert.doesNotThrow(() => assertSupportedPackVersion({ version: 1 }));
  assert.doesNotThrow(() => assertSupportedPackVersion({}));
});

test("pull re-run replaces only the managed block, keeping member text", async () => {
  fakeEngine("pack", "# v1 rules v1");
  const dir = await mkproject({
    "CLAUDE.md": `# Mine\n\nMy notes stay.\n\n${block("# v1 rules v1")}`,
    "AGENTS.md": "# Team notes live here.\n",
  });
  fakeEngine("pack", "# v1 rules v2");
  await pullIntoCommand("demo-1", {}, { dir });
  const claude = await fs.readFile(join(dir, "CLAUDE.md"), "utf8");
  assert.match(claude, /My notes stay\./);
  assert.match(claude, /# v1 rules v2/);
  assert.doesNotMatch(claude, /# v1 rules v1/);
  const agents = await fs.readFile(join(dir, "AGENTS.md"), "utf8");
  assert.match(agents, /Team notes live here\./);
  assert.match(agents, /# v1 rules v2/);
});

test("pull --dry-run prints the plan and writes nothing", async () => {
  fakeEngine("pack");
  const dir = await mkproject();
  const res = await pullIntoCommand("demo-1", { "dry-run": true }, { dir });
  assert.equal(res.status, "dry-run");
  assert.match(out(), /dry run — nothing written/);
  assert.match(out(), /DESIGN\.md/);
  assert.equal((await fs.readdir(dir)).sort().join(","), "package.json");
});

test("pull --project fetches the Studio run pack with auth and records it", async () => {
  fakeEngine("pack");
  const dir = await mkproject();
  const res = await pullIntoCommand(undefined, { project: "proj-123" }, { dir });
  assert.equal(res.status, "done");
  assert.match(await fs.readFile(join(dir, "WORK-ORDER.md"), "utf8"), /Follow route by route/);
  assert.match(out(), /ask your agent to follow WORK-ORDER\.md/);
  const state = JSON.parse(await fs.readFile(join(dir, PULL_STATE_REL), "utf8"));
  assert.equal(state.source, "project");
  assert.equal(state.ref, "proj-123");
});

test("pull --project surfaces owner-only errors plainly", async () => {
  const dir = await mkproject();
  fakeEngine("forbidden");
  await assert.rejects(pullIntoCommand(undefined, { project: "proj-123" }, { dir }), /owner-only \(403\)/);
  fakeEngine("gone");
  await assert.rejects(pullIntoCommand(undefined, { project: "proj-123" }, { dir }), /No Studio project "proj-123" \(404\)/);
  const throwing = (status) => async () => { throw new Error(`GET /api/projects/p/pack failed (${status}): nope`); };
  await assert.rejects(fetchProjectPack("p", throwing(401)), /needs sign-in \(401\)/);
  await assert.rejects(fetchProjectPack("p", throwing(403)), /owner-only \(403\)/);
  await assert.rejects(fetchProjectPack("p", throwing(404)), /No Studio project/);
  await assert.rejects(fetchProjectPack(""), /Usage: v1design pull --project/);
  await assert.rejects(pullIntoCommand(undefined, {}, { dir }), /^Error: Usage: v1design pull /);
});

test("pull --project --dry-run lists files and writes nothing", async () => {
  fakeEngine("pack");
  const dir = await mkproject();
  const res = await pullIntoCommand(undefined, { project: "proj-123", "dry-run": true }, { dir });
  assert.equal(res.status, "dry-run");
  assert.match(out(), /dry run — nothing written/);
  assert.match(out(), /WORK-ORDER\.md/);
  assert.match(out(), new RegExp(PULL_STATE_REL.replace(/\\/g, "\\\\").replace(/\./g, "\\.")));
  assert.equal((await fs.readdir(dir)).sort().join(","), "package.json");
});

test("pull --agents limits which rules files are written", async () => {
  fakeEngine("pack");
  const dir = await mkproject();
  await pullIntoCommand("demo-1", { agents: "cursor" }, { dir });
  await fs.stat(join(dir, ".cursor", "rules", "v1design.mdc"));
  await assert.rejects(fs.stat(join(dir, "CLAUDE.md")), /ENOENT/);
  await assert.rejects(fs.stat(join(dir, "AGENTS.md")), /ENOENT/);
  assert.throws(() => parseAgents({ agents: "bogus" }), /Unknown --agents/);
});

test("pull zip routing is unchanged: --zip/--out force zip, projects default to into", async () => {
  const project = await mkproject();
  const bare = mkdtempSync(join(tmpdir(), "pull-bare-"));
  assert.equal(resolvePullMode({ zip: true }, project), "zip");
  assert.equal(resolvePullMode({ out: "handoff.zip" }, project), "zip");
  assert.equal(resolvePullMode({ zip: true }, bare), "zip");
  assert.equal(resolvePullMode({ into: "sub" }, bare), "into");
  assert.equal(resolvePullMode({}, project), "into");
  // Hermetic negative: no markers anywhere (the real /tmp may carry stray ones).
  const noMarkers = () => false;
  assert.equal(resolvePullMode({}, bare, noMarkers), "zip");
  assert.equal(targetDirFor({}, bare, noMarkers), resolve(bare));
  assert.equal(targetDirFor({ into: join(bare, "sub") }, bare), join(bare, "sub"));
  assert.equal(targetDirFor({}, project), project);
  assert.equal(detectProjectRoot(project), project);
  assert.equal(detectProjectRoot(bare, noMarkers), null);
});

test("pull surfaces the Lifetime entitlement on 402", async () => {
  fakeEngine("denied");
  const dir = await mkproject();
  await assert.rejects(pullIntoCommand("demo-1", {}, { dir }), (e) => {
    assert.ok(e instanceof LibraryAccessError, `expected LibraryAccessError, got ${e}`);
    assert.match(e.message, /Lifetime/);
    assert.match(e.message, /\/pricing/);
    return true;
  });
});

test("pull of an unknown ref lists search matches instead of failing silently", async () => {
  fakeEngine("missing");
  const dir = await mkproject();
  const res = await pullIntoCommand("a cozy reading app", {}, { dir });
  assert.equal(res.status, "brief");
  assert.match(out(), /find my design/);
  assert.match(out(), /v1design pull demo-1/);
});

test("merge helpers: extract replaces in place, appends when unmarked", () => {
  const { header, block: b } = extractBlock(`# H\n\n${block("R")}`);
  assert.equal(header, "# H\n\n");
  assert.ok(b.startsWith(PACK_START), "block keeps the start marker");
  assert.ok(b.endsWith(PACK_END), "block ends at the end marker");
  const replaced = mergeAgentFile(`mine\n\n${block("OLD")}\n`, b);
  assert.match(replaced, /^mine\n/);
  assert.match(replaced, /R/);
  assert.doesNotMatch(replaced, /OLD/);
  assert.match(mergeAgentFile("just notes\n", b), /just notes\n\n<!-- v1design:start -->/);
  assert.equal(mergeAgentFile(null, b), null);
  const planned = planPackWrites("/nonexistent-probe", manifest("R"), ["CLAUDE.md"]);
  assert.deepEqual(planned.map((p) => p.rel).sort(), ["CLAUDE.md", "DESIGN.md", "PROMPT.md", "WORK-ORDER.md", "design-tokens.json",
    "work-order.json", join("prompts", "Home.md"), join("screens", "Home.tsx")].sort());
});
