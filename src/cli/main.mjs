// v1design — human/script CLI for v-1.design.
import "dotenv/config";
import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, parse as parsePath, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { login, logout, readCredentials, status, DEFAULT_API_URL } from "./auth.ts";
import { requireCreateConfirmation } from "./lib/confirm.mjs";

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
Explore designs for an idea — BOTH lanes (adapt from library + fresh from recipe), then a browser gallery to pick from:
  v1design explore "an idea" [--surface web|mobile] [--adapt N] [--fresh N] [--recipe <dir>] [--json]
  v1design gallery [folder] [--no-open]           # assemble + open a browser gallery of the rendered concepts
  v1design recipe init [--out <dir>] [--force]   # scaffold a sample recipe to ./.v1design/recipe
  v1design recipe path                            # show which recipe "explore" resolves

Generate a brand-new design with the ENGINE forge (spends credits — only on an explicit ask):
  v1design studio "brief" --yes [--target web|mobile|both] [--wait] [--json]
      ("studio" GENERATES a new design via the engine + spends credits, so it needs --yes.
       "v1design create" is a deprecated alias for "studio".)
  v1design search "fintech dashboard" [--type design|screen|palette|font|component] [--surface web|mobile] [--limit 12]
  v1design library search "book app" [--surface web|mobile] [--json] [--limit 8]
  v1design library suggest "book app" [--surface web|mobile] [--limit 5] [--open] [--json]
  v1design designs list [--json]
  v1design designs get <studio-url|share-url|library-url|id|slug> [--json] [--full] [--zip out.zip] [--allow-project-write]
  v1design pull <design-ref> [--out handoff.zip] [--allow-project-write]
  v1design screens get <design-ref> <screen-name> [--out Screen.tsx] [--json] [--allow-project-write]
  v1design tokens get <design-ref> [--out tokens.json]
  v1design theme  get <design-ref> [--css] [--out theme.css|theme.json]
  v1design colors get <design-ref> [--out colors.json]
  v1design skill install [--target ~/.codex/skills] [--allow-project-write]

Build a runnable, verified app (idea or a specific design → Next.js / Expo):
  v1design new "idea" [--surface web|mobile] [--target ./dir] [--design <ref>] [--install] [--run]
  v1design scaffold <design-ref> [--surface web|mobile] [--out ./dir] [--install] [--run] [--no-verify]
  v1design remix <refA> <refB> [--system <ref>] [--surface web|mobile] [--out ./dir] [--install]
  v1design verify [dir] [--heal] [--against <ref>] [--json]
  v1design grade <dir> [--against <ref>] [--json]

Find AI-slop tells in any UI (free, no account, no API key, runs locally):
  v1design detect [dir] [--json] [--tells]
  v1design vibe "darker|teal fintech|..." [--in ./dir]
  v1design compose <design-ref> --add "Settings,Billing" [--wait]
  v1design compare <refA> <refB> [--surface web|mobile] [--open]
  v1design screenshots <design-ref> [--out ./shots] [--screens A,B]

Design refs can be Studio links, share links, Library links, raw ids, or Library slugs.
Run "v1design connect" once; no secret or config copying is needed after that.

Safety: generated artifacts default to ~/.v1design/workspace/<design-ref>. The CLI refuses
to write inside a Git worktree unless --allow-project-write is passed.`);
}

function libraryUsage() {
  console.log(`v1design library

Usage:
  v1design library search "idea or tags" [--surface web|mobile] [--json] [--limit 8]
  v1design library suggest "idea or tags" [--surface web|mobile] [--limit 5] [--open] [--json]

Use search for scriptable discovery. Use suggest at the start of a brand-new project:
it prints the top candidates, their tags and Library URLs, and prompts the human to
pick what resonates before any artifacts are pulled or code is changed.

Options:
  --surface web|mobile   Match the target app surface and implementation stack.
  --limit N              Number of candidates to show.
  --open                 Open each candidate Library page in your browser.
  --json                 Print JSON for automation.`);
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
    if ([
      "json", "wait", "full", "no-wait", "allow-project-write", "version", "open", "no-open", "loose-surface",
      "install", "run", "yes", "confirm", "strict", "no-verify", "reference-only", "heal", "png", "md", "zip", "css", "tells", "force",
    ].includes(key)) flags[key] = true;
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

function verifiedStack(card) {
  return String(card?.verified?.stack || "").toLowerCase();
}

function stackMatchesSurface(card, surface, loose = false) {
  if (!surface || loose) return true;
  const stack = verifiedStack(card);
  if (!stack) return true;
  const nativeStack = /\b(expo|react native|nativewind)\b/.test(stack);
  const webStack = /\b(next|vite|remix|astro|react \+ typescript|shadcn|tailwind)\b/.test(stack);
  if (surface === "web") return !nativeStack || webStack;
  if (surface === "mobile") return nativeStack || !webStack;
  return true;
}

function surfaceMatches(card, surface, loose = false) {
  if (!surface) return true;
  const surfaces = (card.surfaces || []).map((item) => String(item).toLowerCase());
  if (!surfaces.includes(surface)) return false;
  return stackMatchesSurface(card, surface, loose);
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

function searchLibraryCards(cards, query, options = {}) {
  const groups = librarySearchTokenGroups(query);
  const surface = normalizeSurface(options.surface);
  const looseSurface = Boolean(options.looseSurface);
  const candidates = surface
    ? (cards || []).filter((card) => surfaceMatches(card, surface, looseSurface))
    : (cards || []);
  const ranked = candidates
    .map((card, index) => ({ card, index, score: libraryCardScore(card, groups), terms: librarySearchTerms(card) }))
    .filter((entry) => !groups.length || entry.score > 0)
    .sort((a, b) => (b.score - a.score) || (a.index - b.index));
  const strict = groups.length
    ? ranked.filter((entry) => groups.every((group) => group.some((token) => entry.terms.has(token))))
    : ranked;
  return (strict.length ? strict : ranked).map((entry) => entry.card);
}

function normalizeSurface(input) {
  const surface = String(input || "").trim().toLowerCase();
  if (!surface) return "";
  if (surface === "web" || surface === "mobile") return surface;
  throw new Error(`Invalid --surface "${input}". Expected web or mobile.`);
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

async function copySkillTo(base, flags = {}) {
  if (!existsSync(SKILL_SOURCE)) throw new Error(`Bundled skill missing: ${SKILL_SOURCE}`);
  await assertSafeWritePath(base, flags, "skill target");
  const dest = join(base, "v1-design");
  await mkdir(base, { recursive: true });
  await cp(SKILL_SOURCE, dest, { recursive: true, force: true });
  return dest;
}

async function installSkill(flags) {
  const base = flags.target
    ? resolve(expandHome(flags.target))
    : join(process.env.CODEX_HOME || join(process.env.HOME || ".", ".codex"), "skills");
  const dest = await copySkillTo(base, flags);
  console.log(`Installed v-1.design skill to ${dest}`);
  console.log(`Try: Use $v1-design to build this app from a v-1.design link.`);
}

/** Install the skill where Claude Code auto-loads it (~/.claude/skills), so the
 *  SKILL.md "brain" loads by description on "use v1design to build X". */
async function installClaudeSkill(flags = {}) {
  const base = join(process.env.HOME || ".", ".claude", "skills");
  try {
    const dest = await copySkillTo(base, { ...flags, "allow-project-write": true });
    console.log(`Installed v-1.design skill for Claude Code at ${dest}`);
  } catch (e) {
    console.log(`Could not install Claude Code skill: ${e instanceof Error ? e.message : e}`);
  }
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
  await installClaudeSkill();
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
  if (configureAll || auto || client === "claude") await installClaudeSkill(flags);
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
  const surface = normalizeSurface(flags.surface);
  const json = await request("GET", "/api/library");
  const matches = searchLibraryCards(json.designs || [], needle, { surface, looseSurface: flags["loose-surface"] }).slice(0, limit);
  if (flags.json) {
    printJson({ query: needle, surface: surface || null, count: matches.length, designs: matches });
    return;
  }
  if (!matches.length) {
    const scope = surface ? ` ${surface}` : "";
    console.log(`No Library${scope} designs matched "${needle}". Try broader words like books, reading, dashboard, marketplace, finance, or health.`);
    return;
  }
  const scope = surface ? ` ${surface}` : "";
  console.log(`Library${scope} matches for "${needle || "all"}":`);
  for (const d of matches) {
    const tags = (d.tags || []).slice(0, 8).join(", ");
    const surfaces = (d.surfaces || []).join(", ") || "unknown surface";
    console.log(`- ${d.appName} · ${d.slug}`);
    console.log(`  ${d.summary}`);
    console.log(`  ${d.category || "uncategorized"} · ${surfaces}${tags ? ` · ${tags}` : ""}`);
    console.log(`  ${WEB_URL}/library/${encodeURIComponent(d.slug)}`);
  }
}

// Rock-solid engine-backed search over EVERY entity in the verified library
// (designs, screens, palettes, fonts, components). The agent's primary discovery
// verb: search, pull the handle, mix and match. Falls back to the card search if
// the engine has no /api/search yet.
async function searchEngine(query, flags) {
  const q = String(query || "").trim();
  if (!q) throw new Error('Usage: v1design search "<what you need>" [--type design|screen|palette|font|component] [--surface web|mobile] [--limit N]');
  const params = new URLSearchParams({ q });
  if (flags.type) params.set("type", String(flags.type));
  if (flags.surface) params.set("surface", String(flags.surface));
  if (flags.limit) params.set("limit", String(flags.limit));
  let out;
  try {
    out = await request("GET", `/api/search?${params.toString()}`);
  } catch {
    if (flags.__return) return { query: q, count: 0, results: [] };
    return searchLibrary(q, flags); // older engine without /api/search
  }
  if (flags.__return) return out;
  if (flags.json) { printJson(out); return; }
  const results = out.results || [];
  if (!results.length) { console.log(`No matches for "${q}".`); return; }
  console.log(`${out.count} matches for "${q}" — top ${results.length} (pull any with its handle):`);
  for (const r of results) {
    const what = r.type === "design" ? r.appName
      : r.type === "screen" ? `${r.design} · ${r.screen} (${r.surface})`
      : r.type === "palette" ? `${r.design} palette · ${r.colour} (${r.harmony || ""})`
      : r.type === "font" ? `${r.design} fonts · ${r.display || ""}/${r.body || ""}`
      : `${r.design} · ${r.component}`;
    console.log(`- [${r.type}] ${what}`);
    console.log(`    ${r.handle}`);
  }
}

function libraryUrl(slug) {
  return `${WEB_URL}/library/${encodeURIComponent(slug)}`;
}

async function openUrl(url) {
  const command = process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
      ? "cmd"
      : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  await new Promise((resolve) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
    child.unref?.();
  });
}

async function suggestLibrary(query, flags) {
  const needle = String(query || "").trim();
  const limit = Math.max(1, Math.min(10, Number(flags.limit || 5) || 5));
  const surface = normalizeSurface(flags.surface);
  const json = await request("GET", "/api/library");
  const strictMatches = searchLibraryCards(json.designs || [], needle, { surface, looseSurface: flags["loose-surface"] });
  const matches = strictMatches.slice(0, limit);
  if (surface && !flags["loose-surface"] && matches.length < limit) {
    const seen = new Set(matches.map((d) => d.slug));
    const looseMatches = searchLibraryCards(json.designs || [], needle, { surface, looseSurface: true });
    for (const d of looseMatches) {
      if (seen.has(d.slug)) continue;
      matches.push(d);
      seen.add(d.slug);
      if (matches.length >= limit) break;
    }
  }
  const candidates = matches.map((d, index) => ({
    rank: index + 1,
    appName: d.appName,
    slug: d.slug,
    summary: d.summary,
    category: d.category || "uncategorized",
    surfaces: d.surfaces || [],
    strictSurface: surface ? stackMatchesSurface(d, surface) : true,
    tags: (d.tags || []).slice(0, 10),
    url: libraryUrl(d.slug),
  }));

  if (flags.open) {
    await Promise.all(candidates.map((candidate) => openUrl(candidate.url)));
  }

  if (flags.json) {
    printJson({
      query: needle,
      surface: surface || null,
      count: candidates.length,
      opened: Boolean(flags.open),
      candidates,
      nextStep: "Ask the user which option resonates before pulling artifacts or editing the repo.",
    });
    return;
  }

  if (!candidates.length) {
    const scope = surface ? ` ${surface}` : "";
    console.log(`No Library${scope} candidates matched "${needle}". Try broader words like books, reading, dashboard, marketplace, finance, or health.`);
    return;
  }

  const scope = surface ? ` ${surface}` : "";
  console.log(`Top ${candidates.length} Library${scope} candidates for "${needle || "all"}":`);
  for (const d of candidates) {
    const tags = d.tags.join(", ");
    console.log(`${d.rank}. ${d.appName} · ${d.slug}`);
    console.log(`   ${d.summary}`);
    const strictNote = d.strictSurface ? "" : " · surface-tagged visual reference";
    console.log(`   ${d.category} · ${d.surfaces.join(", ") || "unknown surface"}${strictNote}${tags ? ` · ${tags}` : ""}`);
    console.log(`   ${d.url}`);
  }
  if (flags.open) console.log(`\nOpened ${candidates.length} Library page${candidates.length === 1 ? "" : "s"} in your browser.`);
  console.log("\nAsk the user: which one resonates with the product you want? Then pull/build only after they choose.");
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
  // Library-first: the studio forge spends credits, so it never runs on intent.
  await requireCreateConfirmation("studio", flags);
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
  if (cmd === "studio" || cmd === "create") {
    // "studio" = the ENGINE forge (generates a NEW design, spends credits). `create` is a
    // deprecated alias kept so 0.3.x callers don't break — it warns then runs studio.
    if (cmd === "create") console.error("Note: `v1design create` is now `v1design studio` (the engine forge). Running studio…");
    await createDesign([sub, ...rest].filter(Boolean).join(" "), flags); return;
  }
  if (cmd === "explore") {
    const { exploreCommand } = await import("./explore.mjs");
    await exploreCommand([sub, ...rest].filter(Boolean).join(" "), flags); return;
  }
  if (cmd === "gallery") {
    const { galleryCommand } = await import("./gallery.mjs");
    await galleryCommand(sub, flags); return;
  }
  if (cmd === "recipe") {
    const { recipeCommand } = await import("./recipe.mjs");
    await recipeCommand(sub, flags); return;
  }
  if (cmd === "search") { await searchEngine([sub, ...rest].filter(Boolean).join(" "), flags); return; }
  if (cmd === "pull") { await pull(sub, flags); return; }
  if (cmd === "skill" && sub === "install") { await installSkill(flags); return; }
  if (cmd === "library" && (!sub || sub === "help" || sub === "--help" || sub === "-h")) { libraryUsage(); return; }
  if (cmd === "library" && sub === "search") { await searchLibrary(rest.join(" "), flags); return; }
  if (cmd === "library" && sub === "suggest") { await suggestLibrary(rest.join(" "), flags); return; }
  if (cmd === "designs" && sub === "list") { await listDesigns(flags); return; }
  if (cmd === "designs" && sub === "get") { await getDesign(rest[0], flags); return; }
  if (cmd === "screens" && sub === "get") { await getScreen(rest[0], rest.slice(1).join(" "), flags); return; }
  if (cmd === "tokens" && sub === "get") { const { tokensGetCommand } = await import("./theme.mjs"); await tokensGetCommand(rest[0], flags); return; }
  if (cmd === "theme" && sub === "get") { const { themeGetCommand } = await import("./theme.mjs"); await themeGetCommand(rest[0], flags); return; }
  if (cmd === "colors" && sub === "get") { const { colorsGetCommand } = await import("./theme.mjs"); await colorsGetCommand(rest[0], flags); return; }

  // ── build commands (lazy-loaded so existing commands stay fast) ──────────
  if (cmd === "new") {
    const { newCommand } = await import("./wizard.mjs");
    await newCommand([sub, ...rest].filter(Boolean).join(" "), flags); return;
  }
  if (cmd === "scaffold") {
    const { scaffoldCommand } = await import("./scaffold.mjs");
    await scaffoldCommand(sub, flags); return;
  }
  if (cmd === "remix") {
    const { remixCommand } = await import("./remix.mjs");
    await remixCommand([sub, ...rest].filter(Boolean), flags); return;
  }
  if (cmd === "verify") {
    const { verifyCommand } = await import("./verify.mjs");
    await verifyCommand(sub, flags); return;
  }
  if (cmd === "detect") {
    const { detectCommand } = await import("./detect.mjs");
    await detectCommand(sub || ".", flags); return;
  }
  if (cmd === "grade") {
    const { gradeCommand } = await import("./grade.mjs");
    await gradeCommand(sub, flags); return;
  }
  if (cmd === "vibe") {
    const { vibeCommand } = await import("./vibe.mjs");
    await vibeCommand([sub, ...rest].filter(Boolean).join(" "), flags); return;
  }
  if (cmd === "compose") {
    const { composeCommand } = await import("./compose.mjs");
    await composeCommand(sub, flags); return;
  }
  if (cmd === "compare") {
    const { compareCommand } = await import("./compare.mjs");
    await compareCommand([sub, ...rest].filter(Boolean), flags); return;
  }
  if (cmd === "screenshots" || (cmd === "export" && flags.png)) {
    const { screenshotsCommand } = await import("./screenshots.mjs");
    await screenshotsCommand(cmd === "export" ? sub : sub, flags); return;
  }

  usage();
  process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
