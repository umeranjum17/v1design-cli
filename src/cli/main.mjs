// v1design — human/script CLI for v-1.design.
import "dotenv/config";
import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, parse as parsePath, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { login, logout, readCredentials, status, DEFAULT_API_URL } from "./auth.ts";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const SKILL_SOURCE = join(ROOT, "skills", "v1-design");
const DESIGN_REF_ALIASES = {
  "aetra-deploy": "aetra-a3e7c2b1",
};
const WEB_URL = (process.env.V1_DESIGN_WEB_URL || "https://v-1.design").replace(/\/+$/, "");
const SEARCH_STOPWORDS = new Set(["app", "apps", "design", "designs", "ui", "ux", "template", "templates"]);
const SEARCH_ALIASES = {
  book: ["book", "books", "reading", "library", "literary"],
  books: ["book", "books", "reading", "library", "literary"],
  ebook: ["book", "books", "reading", "library", "literary"],
  ebooks: ["book", "books", "reading", "library", "literary"],
  read: ["read", "reading", "reader", "book", "books", "literary"],
  reader: ["read", "reading", "reader", "book", "books", "literary"],
  desktop: ["web"],
  landing: ["web"],
  mobileapp: ["mobile"],
  webapp: ["web"],
  webpage: ["web"],
  website: ["web"],
  websites: ["web"],
};

function usage() {
  console.log(`v1design

Usage:
  v1design login
  v1design connect [--client auto|codex|cursor|claude|all] [--target ~/.codex/skills] [--allow-project-write]
  v1design status
  v1design logout
  v1design create "brief" [--target web|mobile|both] [--wait] [--json]
  v1design library search "book app" [--json] [--limit 8]
  v1design designs list [--json]
  v1design designs get <studio-url|share-url|library-url|id|slug> [--json] [--full] [--zip out.zip] [--allow-project-write]
  v1design pull <design-ref> [--out handoff.zip] [--allow-project-write]
  v1design screens get <design-ref> <screen-name> [--out Screen.tsx] [--json] [--allow-project-write]
  v1design skill install [--target ~/.codex/skills] [--allow-project-write]

Design refs can be Studio links, share links, Library links, raw ids, or Library slugs.
Run "v1design connect" once; no secret or config copying is needed after that.

Safety: generated artifacts default to ~/.v1design/workspace/<design-ref>. The CLI refuses
to write inside a Git worktree unless --allow-project-write is passed.`);
}

function packageVersion() {
  try {
    return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version || "unknown";
  } catch {
    return "unknown";
  }
}

function parse(argv) {
  const flags = {};
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { args.push(a); continue; }
    const key = a.slice(2);
    if (["json", "wait", "full", "no-wait", "allow-project-write", "version"].includes(key)) flags[key] = true;
    else flags[key] = argv[++i];
  }
  return { args, flags };
}

function designRef(input) {
  const raw = String(input || "").trim();
  const normalize = (ref) => DESIGN_REF_ALIASES[ref] || ref;
  try {
    const url = new URL(raw);
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.findIndex((p) => ["studio", "share", "library"].includes(p));
    if (idx >= 0 && parts[idx + 1]) return normalize(decodeURIComponent(parts[idx + 1]));
  } catch {}
  return normalize(raw.replace(/^\/+|\/+$/g, ""));
}

function librarySearchTokenGroups(query) {
  return String(query || "")
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter(Boolean)
    .filter((token) => !SEARCH_STOPWORDS.has(token))
    .map((token) => SEARCH_ALIASES[token] || [token]);
}

function librarySearchText(card) {
  return [
    card.appName,
    card.summary,
    card.category,
    ...(card.tags || []),
    ...(card.surfaces || []),
  ].join(" ").toLowerCase();
}

function librarySearchTerms(card) {
  return new Set(librarySearchText(card).split(/[^a-z0-9]+/).filter(Boolean));
}

function libraryCardScore(card, groups) {
  const tagSet = new Set((card.tags || []).map((tag) => String(tag).toLowerCase()));
  const surfaceSet = new Set((card.surfaces || []).map((surface) => String(surface).toLowerCase()));
  const category = String(card.category || "").toLowerCase();
  const appName = String(card.appName || "").toLowerCase();
  const summary = String(card.summary || "").toLowerCase();
  const terms = librarySearchTerms(card);
  let score = 0;

  for (const group of groups) {
    let groupScore = 0;
    for (const token of group) {
      if (tagSet.has(token)) groupScore += 8;
      if (category === token || surfaceSet.has(token)) groupScore += 6;
      if (terms.has(token)) groupScore += 2;
      if (token.length >= 5 && appName.includes(token)) groupScore += 4;
      if (token.length >= 5 && summary.includes(token)) groupScore += 2;
      for (const tag of tagSet) {
        if (token.length >= 5 && tag.includes(token)) groupScore += 3;
      }
    }
    score += groupScore || -1;
  }

  if (card.verified?.status === "pass") score += 0.5;
  if (card.tier === "free") score += 0.2;
  if (card.beta) score -= 1;
  return score;
}

function searchLibraryCards(cards, query) {
  const groups = librarySearchTokenGroups(query);
  const ranked = (cards || [])
    .map((card, index) => ({ card, index, score: libraryCardScore(card, groups), terms: librarySearchTerms(card) }))
    .filter((entry) => !groups.length || entry.score > 0)
    .sort((a, b) => (b.score - a.score) || (a.index - b.index));
  const strict = groups.length
    ? ranked.filter((entry) => groups.every((group) => group.some((token) => entry.terms.has(token))))
    : ranked;
  return (strict.length ? strict : ranked).map((entry) => entry.card);
}

async function credentials() {
  const local = await readCredentials();
  const apiUrl = (process.env.V1_DESIGN_API_URL || local?.apiUrl || DEFAULT_API_URL).replace(/\/$/, "");
  const key = process.env.V1_DESIGN_API_KEY || local?.key || "";
  if (!key) throw new Error("Not connected. Run: v1design connect");
  return { apiUrl, key };
}

async function request(method, path, body, expect = "json") {
  const { apiUrl, key } = await credentials();
  const res = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} failed (${res.status}): ${text.slice(0, 500)}`);
  }
  if (expect === "text") return res.text();
  if (expect === "bytes") return Buffer.from(await res.arrayBuffer());
  return res.json();
}

function printJson(data) {
  console.log(JSON.stringify(data, null, 2));
}

function expandHome(p) {
  return String(p || "").replace(/^~(?=$|\/|\\)/, process.env.HOME || "~");
}

function v1Home() {
  return resolve(expandHome(process.env.V1DESIGN_HOME || join(process.env.HOME || ".", ".v1design")));
}

function pathInside(child, parent) {
  const c = resolve(child);
  const p = resolve(parent);
  return c === p || c.startsWith(p.endsWith(sep) ? p : `${p}${sep}`);
}

async function findGitWorktree(path) {
  let dir = resolve(path);
  try {
    const s = await stat(dir);
    if (!s.isDirectory()) dir = dirname(dir);
  } catch {
    dir = dirname(dir);
  }
  while (true) {
    if (existsSync(join(dir, ".git"))) return dir;
    const next = dirname(dir);
    if (next === dir || next === parsePath(dir).root) return null;
    dir = next;
  }
}

function projectWriteAllowed(flags = {}) {
  return Boolean(flags["allow-project-write"]) || process.env.V1DESIGN_ALLOW_PROJECT_WRITE === "1";
}

async function assertSafeWritePath(path, flags = {}, label = "output") {
  const resolved = resolve(expandHome(path));
  const allowedRoots = [
    v1Home(),
    resolve(expandHome(process.env.CODEX_HOME || join(process.env.HOME || ".", ".codex"))),
  ];
  if (allowedRoots.some((root) => pathInside(resolved, root))) return resolved;
  const gitRoot = await findGitWorktree(resolved);
  if (gitRoot && !projectWriteAllowed(flags)) {
    throw new Error(
      `Refusing to write ${label} inside Git worktree ${gitRoot}.\n` +
      `Use a temp path or ~/.v1design/workspace, or pass --allow-project-write if this repo is the intended target.`
    );
  }
  return resolved;
}

function workspaceDirFor(ref) {
  const safe = String(ref || "design").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "design";
  return join(v1Home(), "workspace", safe);
}

function handoffPathFor(ref) {
  return join(workspaceDirFor(ref), "handoff.zip");
}

async function installSkill(flags) {
  if (!existsSync(SKILL_SOURCE)) throw new Error(`Bundled skill missing: ${SKILL_SOURCE}`);
  const base = flags.target
    ? resolve(expandHome(flags.target))
    : join(process.env.CODEX_HOME || join(process.env.HOME || ".", ".codex"), "skills");
  await assertSafeWritePath(base, flags, "skill target");
  const dest = join(base, "v1-design");
  await mkdir(base, { recursive: true });
  await cp(SKILL_SOURCE, dest, { recursive: true, force: true });
  console.log(`Installed v-1.design skill to ${dest}`);
  console.log(`Try: Use $v1-design to build this app from a v-1.design link.`);
}

async function readText(file) {
  try { return await readFile(file, "utf8"); }
  catch { return ""; }
}

async function configureCodex() {
  const codexHome = process.env.CODEX_HOME || join(process.env.HOME || ".", ".codex");
  const configPath = join(codexHome, "config.toml");
  const block = `[mcp_servers.v1design]\ncommand = "v1design-agent"\nargs = []\n`;
  const current = await readText(configPath);
  const withoutExisting = current.replace(/\n?\[mcp_servers\.v1design\]\n[\s\S]*?(?=\n\[[^\n]+\]|$)/g, "").trimEnd();
  const next = `${withoutExisting}${withoutExisting ? "\n\n" : ""}${block}`;
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, next.endsWith("\n") ? next : `${next}\n`);
  console.log(`Configured Codex local connector at ${configPath}`);
}

async function configureCursor(flags = {}) {
  const configPath = join(process.cwd(), ".cursor", "mcp.json");
  await assertSafeWritePath(configPath, flags, "Cursor MCP config");
  let json = {};
  const current = await readText(configPath);
  if (current.trim()) {
    try { json = JSON.parse(current); }
    catch { throw new Error(`Could not parse ${configPath}. Fix the JSON or pass --client codex.`); }
  }
  json.mcpServers = {
    ...(json.mcpServers || {}),
    v1design: { command: "v1design-agent", args: [] },
  };
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(json, null, 2) + "\n");
  console.log(`Configured Cursor local connector at ${configPath}`);
}

async function runClaudeSetup() {
  await new Promise((resolve) => {
    const child = spawn("claude", ["mcp", "add", "v1design", "--", "v1design-agent"], { stdio: "inherit" });
    child.on("error", () => {
      console.log("Claude Code CLI not found; skipping Claude setup.");
      resolve();
    });
    child.on("close", (code) => {
      if (code === 0) console.log("Configured Claude Code local connector.");
      else console.log("Claude Code setup did not complete; rerun `v1design connect --client claude` after checking Claude Code.");
      resolve();
    });
  });
}

async function connect(flags) {
  await installSkill(flags);
  await login();
  const client = String(flags.client || "auto").toLowerCase();
  const configureAll = client === "all";
  const auto = client === "auto";
  if (configureAll || auto || client === "codex") await configureCodex();
  if (configureAll || client === "cursor") await configureCursor(flags);
  if (configureAll || client === "claude") await runClaudeSetup();
  console.log("v-1.design is connected. In your agent, say: Use $v1-design to build this app from <v-1.design link>.");
}

async function listDesigns(flags) {
  const json = await request("GET", "/designs");
  if (flags.json) { printJson(json); return; }
  const designs = json.designs || [];
  if (!designs.length) {
    console.log("No designs yet. Run: v1design create \"your app brief\"");
    return;
  }
  for (const d of designs) {
    const s = d.status || {};
    console.log(`${d.appName}  ${d.id}`);
    console.log(`  ${s.ready ?? d.screens} ready · ${s.pending ?? 0} pending · ${s.failed ?? 0} failed`);
  }
}

async function searchLibrary(query, flags) {
  const needle = String(query || "").trim();
  const limit = Math.max(1, Math.min(50, Number(flags.limit || 8) || 8));
  const json = await request("GET", "/api/library");
  const matches = searchLibraryCards(json.designs || [], needle).slice(0, limit);
  if (flags.json) {
    printJson({ query: needle, count: matches.length, designs: matches });
    return;
  }
  if (!matches.length) {
    console.log(`No Library designs matched "${needle}". Try broader words like web, mobile, books, reading, dashboard, marketplace, finance, or health.`);
    return;
  }
  console.log(`Library matches for "${needle || "all"}":`);
  for (const d of matches) {
    const tags = (d.tags || []).slice(0, 8).join(", ");
    const surfaces = (d.surfaces || []).join(", ") || "unknown surface";
    console.log(`- ${d.appName} · ${d.slug}`);
    console.log(`  ${d.summary}`);
    console.log(`  ${d.category || "uncategorized"} · ${surfaces}${tags ? ` · ${tags}` : ""}`);
    console.log(`  ${WEB_URL}/library/${encodeURIComponent(d.slug)}`);
  }
}

async function getDesign(refInput, flags) {
  const ref = designRef(refInput);
  if (!ref) throw new Error("Design ref required.");
  if (flags.zip) {
    const zipPath = await assertSafeWritePath(String(flags.zip), flags, "design zip");
    const bytes = await request("GET", `/designs/${encodeURIComponent(ref)}?format=zip`, undefined, "bytes");
    await mkdir(dirname(zipPath), { recursive: true });
    await writeFile(zipPath, bytes);
    console.log(`Wrote ${zipPath}`);
    return;
  }
  const format = flags.json ? "json" : "md";
  const slim = flags.full ? "" : "&slim=1";
  const out = await request("GET", `/designs/${encodeURIComponent(ref)}?format=${format}${slim}`, undefined, flags.json ? "json" : "text");
  if (flags.json) printJson(out);
  else console.log(out);
}

async function pull(refInput, flags) {
  const ref = designRef(refInput);
  const out = String(flags.out || handoffPathFor(ref));
  await getDesign(refInput, { ...flags, zip: out });
}

async function getScreen(refInput, screenName, flags) {
  const ref = designRef(refInput);
  if (!ref || !screenName) throw new Error("Usage: v1design screens get <design-ref> <screen-name>");
  const outPath = flags.out ? await assertSafeWritePath(String(flags.out), flags, "screen output") : "";
  const json = await request("GET", `/designs/${encodeURIComponent(ref)}?format=json`, undefined, "json");
  const screen = (json.screens || []).find((s) => s.name?.toLowerCase() === screenName.toLowerCase());
  if (!screen) throw new Error(`No screen "${screenName}". Screens: ${(json.screens || []).map((s) => s.name).join(", ")}`);
  if (flags.json) { printJson(screen); return; }
  if (flags.out) {
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, screen.code || "");
    console.log(`Wrote ${outPath}`);
    return;
  }
  console.log(screen.code || `// ${screen.name} has no code in this handoff.`);
}

async function waitForDesign(projectId, flags) {
  const { apiUrl, key } = await credentials();
  const res = await fetch(`${apiUrl}/designs/${encodeURIComponent(projectId)}/events`, {
    headers: { authorization: `Bearer ${key}` },
  });
  if (!res.ok || !res.body) throw new Error(`wait failed (${res.status})`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buf += dec.decode(chunk.value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, idx); buf = buf.slice(idx + 2);
      const ev = (block.match(/^event: (.*)$/m) || [])[1];
      const data = (block.match(/^data: (.*)$/m) || [])[1];
      if (ev === "progress" && data) {
        try { console.error(JSON.parse(data).event?.message || "working..."); } catch {}
      }
      if (ev === "screen" && data) {
        try {
          const parsed = JSON.parse(data);
          console.error(`${parsed.screen?.status || "screen"}: ${parsed.screen?.name || ""}`);
        } catch {}
      }
      if (ev === "done") return getDesign(projectId, flags.json ? { json: true } : {});
    }
  }
}

async function createDesign(brief, flags) {
  if (!brief) throw new Error("Brief required.");
  const body = {
    brief,
    target: flags.target,
    mode: flags.mode,
    url: flags.url,
    vibe: flags.vibe,
  };
  const created = await request("POST", "/designs", body, "json");
  const studio = `https://v-1.design/studio/${created.projectId}`;
  if (flags.wait) {
    await waitForDesign(created.projectId, flags);
    return;
  }
  if (flags.json) printJson({ ...created, studioUrl: studio });
  else {
    console.log(`Started ${created.appName}`);
    console.log(`Project: ${created.projectId}`);
    console.log(`Open: ${studio}`);
    console.log(`Run: v1design designs get ${created.projectId}`);
  }
}

async function main() {
  const { args, flags } = parse(process.argv.slice(2));
  const [cmd, sub, ...rest] = args;

  if (flags.version || cmd === "version" || cmd === "--version" || cmd === "-v") { console.log(packageVersion()); return; }
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") { usage(); return; }
  if (cmd === "login" || cmd === "auth:login") { await login(); return; }
  if (cmd === "connect" || cmd === "setup") { await connect(flags); return; }
  if (cmd === "status" || cmd === "auth:status") { await status(); return; }
  if (cmd === "logout" || cmd === "auth:logout") { await logout(); return; }
  if (cmd === "create") { await createDesign([sub, ...rest].filter(Boolean).join(" "), flags); return; }
  if (cmd === "pull") { await pull(sub, flags); return; }
  if (cmd === "skill" && sub === "install") { await installSkill(flags); return; }
  if (cmd === "library" && sub === "search") { await searchLibrary(rest.join(" "), flags); return; }
  if (cmd === "designs" && sub === "list") { await listDesigns(flags); return; }
  if (cmd === "designs" && sub === "get") { await getDesign(rest[0], flags); return; }
  if (cmd === "screens" && sub === "get") { await getScreen(rest[0], rest.slice(1).join(" "), flags); return; }

  usage();
  process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
