// v1design pull <ref> — into-repo mode (feature/v2).
//
// Fetches GET /designs/:id?format=pack (a JSON manifest of files) and writes it
// into an EXISTING repo: DESIGN.md, design-tokens.json, PROMPT.md, prompts/*.md
// and screens/*.tsx wholesale; agent rules merge into CLAUDE.md, AGENTS.md and
// .cursor/rules/v1design.mdc ONLY between the managed markers, so re-pulls
// never touch the member's own text.
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { apiRequest, expandHome, normalizeRef, searchLibraryRemote } from "./lib/engine.mjs";

/** Managed markers: agent files are upserted ONLY between these lines. */
export const PACK_START = "<!-- v1design:start -->";
export const PACK_END = "<!-- v1design:end -->";

// The engine pack manifest carries agent rules under agents/ — the repo layout differs.
const AGENT_REMAP = {
  "agents/CLAUDE.md": "CLAUDE.md",
  "agents/AGENTS.md": "AGENTS.md",
  "agents/v1design.mdc": ".cursor/rules/v1design.mdc",
};

export const AGENT_TARGETS = {
  claude: "CLAUDE.md",
  codex: "AGENTS.md",
  cursor: join(".cursor", "rules", "v1design.mdc"),
};

/** Walk up from start; the project root holds a package.json or .git. */
export function detectProjectRoot(start, existsFn = existsSync) {
  let dir = resolve(expandHome(start || "."));
  while (true) {
    if (existsFn(join(dir, "package.json")) || existsFn(join(dir, ".git"))) return dir;
    const next = dirname(dir);
    if (next === dir) return null;
    dir = next;
  }
}

/**
 * "zip" keeps today's handoff-zip download (scripts); "into" writes the pack
 * manifest into the repo and is the default inside an existing project.
 */
export function resolvePullMode(flags = {}, cwd = process.cwd(), existsFn) {
  if (flags.zip || typeof flags.out === "string") return "zip";
  if (flags.into !== undefined) return "into";
  return detectProjectRoot(cwd, existsFn) ? "into" : "zip";
}

/** Target dir for into-mode: --into <dir>, else the detected project root, else cwd. */
export function targetDirFor(flags = {}, cwd = process.cwd(), existsFn) {
  if (typeof flags.into === "string" && flags.into) return resolve(expandHome(flags.into));
  return detectProjectRoot(cwd, existsFn) || resolve(cwd);
}

/** --agents claude,codex,cursor limits which rules files are written (default: all). */
export function parseAgents(flags = {}) {
  const v = flags.agents;
  if (v === undefined || v === true || v === "") return Object.values(AGENT_TARGETS);
  const picks = String(v).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const bad = picks.filter((p) => !(p in AGENT_TARGETS));
  if (bad.length) throw new Error(`Unknown --agents "${bad.join(",")}". Expected any of: claude,codex,cursor.`);
  return [...new Set(picks)].map((p) => AGENT_TARGETS[p]);
}

/** Fetch the pack manifest; 402 carries the Lifetime LibraryAccessError. */
export async function fetchPack(ref, request = apiRequest) {
  const r = normalizeRef(ref);
  const manifest = await request("GET", `/designs/${encodeURIComponent(r)}?format=pack`, { refForAccess: r });
  if (!manifest || !Array.isArray(manifest.files)) {
    throw new Error(`Engine did not return a format=pack manifest for "${r}" — is the engine on feature/v2?`);
  }
  return manifest;
}

/** Split pack content into the pre-marker header and the managed block (inclusive). */
export function extractBlock(content) {
  const text = String(content || "");
  const start = text.indexOf(PACK_START);
  const end = text.indexOf(PACK_END);
  if (start >= 0 && end > start) {
    return { header: text.slice(0, start), block: text.slice(start, end + PACK_END.length) };
  }
  return { header: "", block: `${PACK_START}\n${text.trim()}\n${PACK_END}\n` };
}

/** Merge a managed block into an existing agent file; null when the file is absent. */
export function mergeAgentFile(existing, block) {
  if (existing == null) return null;
  const start = existing.indexOf(PACK_START);
  const end = existing.indexOf(PACK_END);
  if (start >= 0 && end > start) {
    return existing.slice(0, start) + block + existing.slice(end + PACK_END.length);
  }
  return `${existing.trimEnd()}\n\n${block}\n`;
}

function assertInside(dir, rel) {
  const abs = resolve(dir, rel);
  if (abs !== dir && !abs.startsWith(dir.endsWith(sep) ? dir : `${dir}${sep}`)) {
    throw new Error(`Refusing to write outside ${dir}: ${rel}`);
  }
  return abs;
}

/**
 * Plan every write: generated files wholesale, agent rules merged between
 * markers (created with the pack header when absent). Reads the repo so
 * --dry-run prints exactly what a real run would do.
 */
export function planPackWrites(dir, manifest, agentTargets) {
  const wanted = new Set(agentTargets);
  const plan = [];
  for (const file of manifest.files || []) {
    const rel = AGENT_REMAP[file.path] ?? file.path;
    const abs = assertInside(dir, rel);
    const isAgent = Object.values(AGENT_TARGETS).includes(rel);
    if (isAgent && !wanted.has(rel)) continue;
    const content = String(file.content ?? "");
    if (!isAgent) {
      plan.push({ rel, abs, content, mode: existsSync(abs) ? "updated" : "new" });
      continue;
    }
    const { header, block } = extractBlock(content);
    if (!existsSync(abs)) {
      plan.push({ rel, abs, content: `${header}${block}`, mode: "new" });
      continue;
    }
    const merged = mergeAgentFile(readFileSync(abs, "utf8"), block);
    plan.push({ rel, abs, content: merged, mode: merged === readFileSync(abs, "utf8") ? "unchanged" : "merged" });
  }
  return plan;
}

function searchLabel(r) {
  if (r.type === "design") return r.appName || r.handle;
  if (r.type === "screen") return `${r.design} · ${r.screen} (${r.surface || "?"})`;
  if (r.type === "palette") return `${r.design} palette · ${r.colour || ""} (${r.harmony || ""})`;
  if (r.type === "font") return `${r.design} fonts · ${r.display || ""}/${r.body || ""}`;
  return `${r.design} · ${r.component || r.name || r.handle}`;
}

// The ref isn't a known design — treat the input as a brief: "find my design"
// is coming (v1-match plugs in later), so list today's search matches to pick from.
async function briefFallback(input, opts = {}) {
  console.log(`"find my design" is coming — v1-match will plug it in. Meanwhile, pick a match:`);
  const search = opts.searchBrief || ((q, o) => searchLibraryRemote(q, o));
  let results = [];
  try {
    const found = await search(input, { limit: 8 });
    results = (found && found.results) || [];
  } catch {}
  if (!results.length) {
    console.log(`No Library matches for "${input}". Try broader words like dashboard, marketplace, finance, or health.`);
    return { status: "brief", matches: [] };
  }
  console.log(`Top matches for "${input}":`);
  for (const r of results.slice(0, 8)) {
    console.log(`- [${r.type}] ${searchLabel(r)}`);
    console.log(`    v1design pull ${r.handle}`);
  }
  return { status: "brief", matches: results.slice(0, 8) };
}

const isNotFound = (e) => /\(404\)/.test(e instanceof Error ? e.message : String(e));

export async function pullIntoCommand(refInput, flags = {}, opts = {}) {
  const input = String(refInput || "").trim();
  if (!input) throw new Error("Usage: v1design pull <design-or-brief> [--into <dir>] [--dry-run] [--agents claude,codex,cursor]");
  const ref = normalizeRef(input);
  const dir = opts.dir || targetDirFor(flags, opts.cwd || process.cwd());

  let manifest;
  try {
    manifest = opts.fetchPack ? await opts.fetchPack(ref) : await fetchPack(ref);
  } catch (e) {
    if (isNotFound(e)) return briefFallback(input, opts);
    throw e;
  }

  const plan = planPackWrites(dir, manifest, parseAgents(flags));
  if (flags["dry-run"]) {
    console.log(`Would write ${plan.length} files into ${dir} (dry run — nothing written):`);
    for (const p of plan) console.log(`  ${p.mode} ${p.rel} (${Buffer.byteLength(p.content, "utf8")} bytes)`);
    return { status: "dry-run", dir, plan };
  }
  for (const p of plan) {
    if (p.mode === "unchanged") continue;
    await mkdir(dirname(p.abs), { recursive: true });
    await writeFile(p.abs, p.content);
  }
  const wrote = plan.filter((p) => p.mode !== "unchanged");
  console.log(`Wrote ${wrote.length} files into ${dir}:`);
  for (const p of wrote) console.log(`  ${p.mode} ${p.rel}`);
  console.log(`Next: tell your agent "apply the v1 design".`);
  return { status: "done", dir, plan };
}
