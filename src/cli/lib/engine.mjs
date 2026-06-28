// Shared engine + filesystem helpers for the v1design build commands
// (new, scaffold, remix, verify, grade, vibe, screenshots, compose).
// Mirrors the behavior of the helpers in main.mjs so the new commands fetch,
// resolve refs, and honor the write-safety model identically.
import "dotenv/config";
import { stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, parse as parsePath, resolve, sep } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { readCredentials, DEFAULT_API_URL } from "../auth.ts";

const DESIGN_REF_ALIASES = {
  "aetra-deploy": "aetra-a3e7c2b1",
};

/** Expand a leading ~ to $HOME. */
export function expandHome(p) {
  return String(p || "").replace(/^~(?=$|\/|\\)/, process.env.HOME || "~");
}

/** The ~/.v1design home (overridable via V1DESIGN_HOME). */
export function v1Home() {
  return resolve(expandHome(process.env.V1DESIGN_HOME || join(process.env.HOME || ".", ".v1design")));
}

/** Resolve API url + bearer key from env or stored credentials. */
export async function loadCredentials() {
  const local = await readCredentials();
  const apiUrl = (process.env.V1_DESIGN_API_URL || local?.apiUrl || DEFAULT_API_URL).replace(/\/$/, "");
  const key = process.env.V1_DESIGN_API_KEY || local?.key || "";
  if (!key) throw new Error("Not connected. Run: v1design connect");
  return { apiUrl, key };
}

/** A 402 from a gated library design — carries an actionable message. */
export class LibraryAccessError extends Error {
  constructor(ref) {
    super(
      `"${ref}" requires v-1.design library access (402).\n` +
      `Open it with: v1design designs get ${ref}\n` +
      `Or pick a free-tier design — list them with: v1design library search "<idea>" --json`
    );
    this.name = "LibraryAccessError";
    this.code = 402;
  }
}

/**
 * Call the engine. `expect` is "json" | "text" | "bytes".
 * `refForAccess` (optional) turns a 402 into a friendly LibraryAccessError.
 */
export async function apiRequest(method, path, { body, expect = "json", refForAccess } = {}) {
  const { apiUrl, key } = await loadCredentials();
  const res = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    if (res.status === 402 && refForAccess) throw new LibraryAccessError(refForAccess);
    const text = await res.text().catch(() => "");
    throw new Error(`${method} ${path} failed (${res.status}): ${text.slice(0, 500)}`);
  }
  if (expect === "text") return res.text();
  if (expect === "bytes") return Buffer.from(await res.arrayBuffer());
  return res.json();
}

/** Accept Studio/share/library URLs, raw ids, or slugs → bare ref. */
export function normalizeRef(input) {
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

/**
 * Parse an entity handle for granular search/remix:
 *   slug            → { ref, kind: "design" }
 *   slug#Screen     → { ref, kind: "screen", name: "Screen" }
 *   slug~Component  → { ref, kind: "component", name: "Component" }
 *   slug@logo       → { ref, kind: "logo", name: "logo" }
 *   slug:asset      → { ref, kind: "asset", name: "asset" }
 */
export function parseHandle(input) {
  const raw = String(input || "").trim();
  const m = raw.match(/^(.*?)([#~@:])(.+)$/);
  if (!m) return { ref: normalizeRef(raw), kind: "design", name: null, handle: normalizeRef(raw) };
  const kindBySigil = { "#": "screen", "~": "component", "@": "logo", ":": "asset" };
  const ref = normalizeRef(m[1]);
  const name = decodeURIComponent(m[3]);
  return { ref, kind: kindBySigil[m[2]], name, handle: `${ref}${m[2]}${name}` };
}

/** Fetch the full handoff JSON (designSystem, screens[].code, artifacts.*). */
export async function fetchHandoff(ref) {
  const r = normalizeRef(ref);
  return apiRequest("GET", `/designs/${encodeURIComponent(r)}?format=json`, { refForAccess: r });
}

/** Fetch the lean public library catalog (no auth-gated code). */
export async function fetchLibrary() {
  const data = await apiRequest("GET", "/api/library");
  return Array.isArray(data) ? data : data.designs || [];
}

/** Call the engine's indexed /api/search (public, searches every field incl. prompts). Returns the
 *  ranked results[] or null on error/timeout, so callers can fall back to a client-side search.
 *  No auth required (public endpoint); resolves apiUrl from env/creds without demanding `connect`. */
export async function searchLibraryRemote(q, { surface, archetype, limit = 6, timeoutMs = 4500 } = {}) {
  if (!q || !String(q).trim()) return null;
  let apiUrl = process.env.V1_DESIGN_API_URL;
  if (!apiUrl) { try { apiUrl = (await readCredentials())?.apiUrl; } catch {} }
  apiUrl = (apiUrl || DEFAULT_API_URL).replace(/\/$/, "");
  const params = new URLSearchParams({ q: String(q), limit: String(limit) });
  if (surface) params.set("surface", surface);
  if (archetype) params.set("archetype", archetype);
  try {
    const res = await fetch(`${apiUrl}/api/search?${params}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data?.results)) return null;
    return { results: data.results, backend: data.backend || "unknown" };
  } catch { return null; }
}

/** Download a screen's rendered reference PNG (public /shot route). */
export async function fetchShot(id, screenName) {
  const { apiUrl, key } = await loadCredentials();
  const url = `${apiUrl}/shot/${encodeURIComponent(id)}/${encodeURIComponent(screenName)}.png`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`shot ${id}/${screenName} failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

// ── write-safety (mirrors main.mjs) ───────────────────────────────────────
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

export function projectWriteAllowed(flags = {}) {
  return Boolean(flags["allow-project-write"]) || process.env.V1DESIGN_ALLOW_PROJECT_WRITE === "1";
}

/**
 * Resolve a write path, refusing to write inside a Git worktree unless the
 * caller passed --allow-project-write (or the target is under ~/.v1design / CODEX_HOME).
 */
export async function assertSafeWritePath(path, flags = {}, label = "output") {
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

/** Default scaffold target for a ref when --out/--target is omitted. */
export function workspaceDirFor(ref) {
  const safe = String(ref || "design").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "design";
  return join(v1Home(), "workspace", safe);
}

/** Open a URL in the user's browser (best-effort, cross-platform). */
export function openUrl(url) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {}
}

/**
 * Run a command, resolving with the exit code. Child stdout is routed to OUR
 * stderr (not stdout) so `--json` output stays pure JSON. Pass { interactive }
 * to inherit stdio fully (e.g. a foreground dev server).
 */
export function run(cmd, args, opts = {}) {
  const { interactive, ...rest } = opts;
  const stdio = interactive ? "inherit" : ["ignore", 2, 2];
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio, ...rest });
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 0));
  });
}

/** Detect a preferred package manager (bun > pnpm > npm) unless one is given. */
export function detectPackageManager(preferred) {
  if (preferred) return preferred;
  for (const pm of ["bun", "pnpm", "npm"]) {
    const which = process.platform === "win32" ? "where" : "which";
    try {
      const { status } = spawnSync(which, [pm], { stdio: "ignore" });
      if (status === 0) return pm;
    } catch {}
  }
  return "npm";
}

/** kebab-case a screen/route name. */
export function kebab(name) {
  return String(name || "screen")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "screen";
}

/** PascalCase a name (for component identifiers). */
export function pascal(name) {
  return String(name || "Screen")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("") || "Screen";
}
