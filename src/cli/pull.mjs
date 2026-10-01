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

/** The only pack format version this CLI understands (manifest.version). */
export const SUPPORTED_PACK_VERSION = 1;

/** Managed pull record: where the last pulled pack version + tokensHash live. */
export const PULL_STATE_REL = join(".v1design", "pull.json");

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

/** Fetch a Studio run pack (one chosen variation = its project id). Owner-only. */
export async function fetchProjectPack(projectId, request = apiRequest) {
  const id = String(projectId || "").trim();
  if (!id) throw new Error("Usage: v1design pull --project <project-id> [--into <dir>] [--dry-run]");
  try {
    const manifest = await request("GET", `/api/projects/${encodeURIComponent(id)}/pack`);
    if (!manifest || !Array.isArray(manifest.files)) {
      throw new Error(`Engine did not return a project pack for "${id}" — is the engine on feature/v2?`);
    }
    return manifest;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/\(401\)/.test(msg)) {
      throw new Error(`Studio project "${id}" needs sign-in (401). Run: v1design connect — then pull a project you own.`);
    }
    if (/\(403\)/.test(msg)) {
      throw new Error(`Studio project "${id}" is owner-only (403). Sign in as the project owner, then: v1design pull --project ${id}`);
    }
    if (/\(404\)/.test(msg)) {
      throw new Error(`No Studio project "${id}" (404). Check the id — it is the chosen variation's project id.`);
    }
    throw e;
  }
}

/** Refuse a pack format newer than this CLI understands. */
export function assertSupportedPackVersion(manifest) {
  const v = manifest && manifest.version;
  if (v != null && Number(v) > SUPPORTED_PACK_VERSION) {
    throw new Error(
      `Pack format version ${v} is newer than this CLI understands (version ${SUPPORTED_PACK_VERSION}). ` +
      `Update @v1design/cli, then pull again.`
    );
  }
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

/** One planned write: new, updated, or unchanged (byte-identical — skipped on write). */
export function planFileWrite(dir, rel, content) {
  const abs = assertInside(dir, rel);
  const text = String(content ?? "");
  if (!existsSync(abs)) return { rel, abs, content: text, mode: "new" };
  return { rel, abs, content: text, mode: readFileSync(abs, "utf8") === text ? "unchanged" : "updated" };
}

/** Read the last pull record ({ version, tokensHash, ... }) or null. */
export function readPullState(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, PULL_STATE_REL), "utf8"));
  } catch {
    return null;
  }
}

/**
 * Plan every write: generated files wholesale, agent rules merged between
 * markers (created with the pack header when absent). Reads the repo so
 * --dry-run prints exactly what a real run would do, and a second identical
 * pull plans no changes.
 */
export function planPackWrites(dir, manifest, agentTargets) {
  const wanted = new Set(agentTargets);
  const plan = [];
  for (const file of manifest.files || []) {
    const rel = AGENT_REMAP[file.path] ?? file.path;
    const isAgent = Object.values(AGENT_TARGETS).includes(rel);
    if (isAgent && !wanted.has(rel)) continue;
    const content = String(file.content ?? "");
    if (!isAgent) {
      plan.push(planFileWrite(dir, rel, content));
      continue;
    }
    const { header, block } = extractBlock(content);
    const abs = assertInside(dir, rel);
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
  const projectId = typeof flags.project === "string" && flags.project.trim() ? flags.project.trim() : null;
  const input = String(refInput || "").trim();
  if (!input && !projectId) {
    throw new Error("Usage: v1design pull <design-or-brief> [--into <dir>] [--dry-run] [--agents claude,codex,cursor] | v1design pull --project <project-id>");
  }
  const dir = opts.dir || targetDirFor(flags, opts.cwd || process.cwd());

  let manifest;
  let source;
  if (projectId) {
    manifest = opts.fetchPack ? await opts.fetchPack(projectId) : await fetchProjectPack(projectId);
    source = { kind: "project", ref: projectId };
  } else {
    const ref = normalizeRef(input);
    try {
      manifest = opts.fetchPack ? await opts.fetchPack(ref) : await fetchPack(ref);
    } catch (e) {
      if (isNotFound(e)) return briefFallback(input, opts);
      throw e;
    }
    source = { kind: "library", ref };
  }
  assertSupportedPackVersion(manifest);

  // Stale tokens: the remote pack's tokens moved since the last recorded pull.
  const prior = readPullState(dir);
  if (prior && manifest.tokensHash && prior.tokensHash && prior.tokensHash !== manifest.tokensHash) {
    console.log(`Warning: remote design tokens changed since your last pull (stale tokens) — this pull overwrites design-tokens.json.`);
  }

  const plan = planPackWrites(dir, manifest, parseAgents(flags));
  const state = {
    version: manifest.version ?? SUPPORTED_PACK_VERSION,
    designId: manifest.designId ?? null,
    tokensHash: manifest.tokensHash ?? null,
    source: source.kind,
    ref: source.ref,
  };
  plan.push(planFileWrite(dir, PULL_STATE_REL, `${JSON.stringify(state, null, 2)}\n`));

  if (flags["dry-run"]) {
    const changes = plan.filter((p) => p.mode !== "unchanged").length;
    console.log(`Would write ${changes} of ${plan.length} files into ${dir} (dry run — nothing written):`);
    for (const p of plan) console.log(`  ${p.mode} ${p.rel} (${Buffer.byteLength(p.content, "utf8")} bytes)`);
    return { status: "dry-run", dir, plan };
  }
  for (const p of plan) {
    if (p.mode === "unchanged") continue;
    await mkdir(dirname(p.abs), { recursive: true });
    await writeFile(p.abs, p.content);
  }
  const wrote = plan.filter((p) => p.mode !== "unchanged");
  if (!wrote.length) {
    console.log(`Already up to date: all ${plan.length} files in ${dir} match ${source.ref} — nothing written.`);
    return { status: "done", dir, plan };
  }
  console.log(`Wrote ${wrote.length} files into ${dir}:`);
  for (const p of wrote) console.log(`  ${p.mode} ${p.rel}`);
  if (plan.some((p) => p.rel === "WORK-ORDER.md")) {
    console.log(`Next: ask your agent to follow WORK-ORDER.md to apply the design route by route.`);
  } else {
    console.log(`Next: tell your agent "apply the v1 design".`);
  }
  return { status: "done", dir, plan };
}
