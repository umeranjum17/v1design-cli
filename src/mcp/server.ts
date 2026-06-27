/**
 * v-1.design MCP server — the tools an agent (Claude Code / Codex / Cursor) calls. The SAME server is
 * exposed over TWO ingresses (see bin/agent.mjs for stdio, http/server.ts for the `/mcp` HTTP route);
 * both wrap one engine. Tools talk to the engine over its HTTP API via {@link EngineHttpClient} — for
 * stdio that's the configured remote engine + env key; for the HTTP ingress it's the engine's own
 * loopback + the caller's key. create / add / wait consume the engine SSE stream (reconnecting with
 * Last-Event-ID) and forward each event as an MCP progress notification — push, no polling.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const INSTRUCTIONS = `v-1.design is a design engine ("the forge") that generates on-brand app UI — real React/TSX screens + a shadcn/Tailwind design system (globals.css) + a DESIGN.md.

HARD RULE — LIBRARY-FIRST; THREE DISTINCT INTENTS, don't conflate them:
1. SEARCH / PULL — search_library / search, then get_design / get_screen_code / get_tokens / get_theme / get_colors / list_designs. Always fine, free.
2. EXPLORE — for "explore designs / generate new ones", use the explore tool. It returns TWO SEPARATE LANES and you must deliver BOTH without blending them: Lane A = existing v1design LIBRARY designs matching the idea (pull/adapt the idea onto them — reuse); Lane B = run the user's LOCAL recipe to GENERATE brand-new designs on its own (do NOT feed Lane A in). Spends NO engine credits. The default for "generate new designs".
3. STUDIO (the engine forge) — create_studio_design / add_screen GENERATE new work on the engine and SPEND CREDITS. Do NOT call them unless the user EXPLICITLY asked for the "studio" forge; both require confirm:true.
When in doubt: search/pull or explore — never studio.

WORKFLOW: stay non-intrusive until the user explicitly asks to use v-1.design in the project. It is okay to connect, check status, and search_library as read-only discovery. Do not create a design, pull artifacts, fetch screen code into files, or edit the target repo unless the user asks to pull/use/build/integrate with v-1.design. If the user provides an app idea but no design link and asks to use v-1.design in a brand-new project, search_library first with limit:5 and the right surface, show the five Library options/links to the user, ask which one resonates, and wait for their choice before pulling artifacts or building. Use surface:"web" for browser/Next.js work and surface:"mobile" for React Native/Expo work. If the user explicitly delegates the choice to you, compare the candidates and state which reference you chose before building. create_studio_design with a product brief generates a new design on the user's account (the engine forge — spends credits, confirm:true required); the finished bundle (design tokens + every screen's TSX) is returned in that same call. add_screen adds a screen; get_design pulls one; list_designs lists the user's own designs.

Every result also includes a studio URL (https://…/studio/<id>) — SHARE IT with the user so they can open the design in their browser to see it rendered and tweak it visually.

HOW TO REPRODUCE FAITHFULLY (like Figma's Dev Mode): the engine is the renderer and the source of truth. get_screen_code returns the engine-RENDERED reference image of a screen INLINE — you see exactly how it should look with no rendering capability of your own — plus the screen's TSX. Build to match the image by reading the EXACT values (sizes, spacing, colors as tokens, radii, weights) from the TSX/design-tokens.json — do not eyeball or "improve". There is no required screenshot-diff loop; precise values + the image you're handed are what guarantee the match (if you happen to be able to render your build, comparing it to the image is a nice self-check, not a requirement). In every render, the top status-bar row (time + signal/wifi/battery) and the bottom tab bar are MOCKUP CHROME, not app content: the OS draws the status bar (reserve it with a safe-area inset, never hand-draw it) and the tab bar is shared chrome you build ONCE and reuse.

THEN BUILD THE REAL APP. The screens are a visual reference (web React + Tailwind tokens) — you own routing, state, data and the implementation. Pick the path for the user's target:
• WEB (Next.js + React + Tailwind / shadcn by default for a new repo): start with a Next.js App Router TypeScript project unless the target repo already uses another stack or the user asks otherwise. In an existing web repo, keep its framework/router and integrate only the requested screens/components. Use the screens almost directly — drop app/globals.css in (use the token classes bg-background / text-foreground / bg-primary / rounded-lg, never hard-code colors), load the two Google fonts from DESIGN.md, extract the shared chrome (nav/sidebar/tab bar) into ONE reused component, then one route per screen, replacing placeholder content with real data/state. The reference frame is not a viewport contract: the app must fill the browser, adapt at wide/normal/mobile sizes, and never leave exposed body whitespace from a fixed 1440px shell.
• MOBILE (React Native / Expo by default for a new repo): start with Expo + React Native unless the target repo already uses another mobile stack or the user asks otherwise. The TSX handoff won't run as-is in native — treat the design as the SOURCE OF TRUTH for look & feel and re-implement it with native primitives (View/Text/FlatList/ScrollView/Pressable) or the repo's NativeWind/components. Read design-tokens.json for palette/type/radius and keep the same tokens across screens.
• OTHER NATIVE STACKS (Flutter, SwiftUI, etc.): the TSX won't run as-is — rebuild with native primitives, matching hierarchy, spacing, tokens, and copy.

IMPORTANT: never poll. create_studio_design / add_screen / wait_for_design are push-based — they stream progress and return the finished design in one call. get_design is a single read, not a loop.`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type ProgressEntry = { type: string; [k: string]: any };

/** Talks to the engine's HTTP API. Same class for both ingresses — only baseUrl + key differ. */
export class EngineHttpClient {
  constructor(private baseUrl: string, private apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }
  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { ...extra };
    if (this.apiKey) h.authorization = `Bearer ${this.apiKey}`;
    return h;
  }
  async json(method: string, path: string, body?: unknown): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers(body ? { "content-type": "application/json" } : undefined),
      body: body ? JSON.stringify(body) : undefined,
    });
    const txt = await res.text();
    let j: any = null;
    try { j = txt ? JSON.parse(txt) : null; } catch {}
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${j?.error ? JSON.stringify(j) : txt || ""}`);
    return j;
  }
  async text(path: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}${path}`, { headers: this.headers() });
    const txt = await res.text();
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${txt.slice(0, 200)}`);
    return txt;
  }
  /** Fetch a binary asset (e.g. a rendered-screen PNG) as base64 + mime, so it can be returned as an
   *  inline MCP image block. Accepts an absolute URL (the public /shot link) or an engine path. Returns
   *  null on any failure so callers degrade gracefully to text-only. */
  async bytes(urlOrPath: string): Promise<{ base64: string; mimeType: string } | null> {
    try {
      const url = /^https?:\/\//.test(urlOrPath) ? urlOrPath : `${this.baseUrl}${urlOrPath}`;
      const res = await fetch(url, { headers: this.headers() });
      if (!res.ok) return null;
      const mimeType = res.headers.get("content-type") || "image/png";
      const base64 = Buffer.from(await res.arrayBuffer()).toString("base64");
      return base64 ? { base64, mimeType } : null;
    } catch { return null; }
  }
  /** Tail the engine SSE to completion, reconnecting with Last-Event-ID on drop. */
  async streamUntilDone(projectId: string, onEntry: (e: ProgressEntry) => void | Promise<void>, maxMs = 600_000): Promise<boolean> {
    const deadline = Date.now() + maxMs;
    let lastId = "";
    while (Date.now() < deadline) {
      let res: Response;
      try { res = await fetch(`${this.baseUrl}/designs/${projectId}/events`, { headers: this.headers(lastId ? { "last-event-id": lastId } : undefined) }); }
      catch { await sleep(1000); continue; }
      if (!res.ok || !res.body) return false;
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "", serverClosed = false;
      while (Date.now() < deadline) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try { chunk = await reader.read(); } catch { serverClosed = true; break; }
        if (chunk.done) { serverClosed = true; break; }
        buf += dec.decode(chunk.value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, idx); buf = buf.slice(idx + 2);
          const id = (block.match(/^id: (.*)$/m) || [])[1];
          const ev = (block.match(/^event: (.*)$/m) || [])[1];
          const data = (block.match(/^data: (.*)$/m) || [])[1];
          if (id) lastId = id;
          if (ev === "done") { try { await reader.cancel(); } catch {} return true; }
          if (ev === "fallback") { try { await reader.cancel(); } catch {} return false; }
          if ((ev === "progress" || ev === "screen") && data) { try { await onEntry(JSON.parse(data)); } catch {} }
        }
      }
      try { await reader.cancel(); } catch {}
      if (!serverClosed) break;
    }
    return false;
  }
}

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
type ToolResult = { content: Content[]; isError?: boolean };
const text = (s: string): ToolResult => ({ content: [{ type: "text", text: s }] });
const errText = (s: string): ToolResult => ({ content: [{ type: "text", text: s }], isError: true });

type Extra = { _meta?: { progressToken?: string | number }; sendNotification: (n: ServerNotification) => Promise<void> };
function reporter(extra: Extra) {
  const token = extra._meta?.progressToken;
  let n = 0;
  return async (e: ProgressEntry) => {
    if (token === undefined) return;
    n++;
    const msg = e.type === "screen" ? `screen ${e.screen?.status}: ${e.screen?.name}` : (e.event?.message ?? "");
    try { await extra.sendNotification({ method: "notifications/progress", params: { progressToken: token, progress: n, message: String(msg).slice(0, 120) } }); } catch {}
  };
}
const footer = (s: any) => (s ? `\n\n---\n_status: ${s.ready} ready · ${s.pending} pending · ${s.failed} failed · ${s.locked} locked_` : "");

// Where the human can open a design in the browser (the web studio). The engine knows the web app's
// URL via WEB_APP_URL; default to the production host.
const WEB_URL = (process.env.WEB_APP_URL || "https://v-1.design").replace(/\/+$/, "");
const studioUrl = (id: string) => `${WEB_URL}/studio/${id}`;
const DESIGN_REF_ALIASES: Record<string, string> = {
  "aetra-deploy": "aetra-a3e7c2b1",
};
const SEARCH_STOPWORDS = new Set(["app", "apps", "design", "designs", "ui", "ux", "template", "templates"]);
const SEARCH_ALIASES: Record<string, string[]> = {
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
function designRef(input: string): string {
  const raw = String(input || "").trim();
  if (!raw) return raw;
  const normalize = (ref: string) => DESIGN_REF_ALIASES[ref] ?? ref;
  try {
    const url = new URL(raw);
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.findIndex((p) => ["studio", "share", "library"].includes(p));
    if (idx >= 0 && parts[idx + 1]) return normalize(decodeURIComponent(parts[idx + 1]));
  } catch {
    // not a URL; treat as an id/slug
  }
  return normalize(raw.replace(/^\/+|\/+$/g, ""));
}
const openLine = (id: string) => `\n\n→ Open in v-1.design: ${studioUrl(id)} or ${WEB_URL}/library/${encodeURIComponent(id)}`;

function librarySearchTokenGroups(query: string): string[][] {
  return String(query || "")
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter(Boolean)
    .filter((token) => !SEARCH_STOPWORDS.has(token))
    .map((token) => SEARCH_ALIASES[token] ?? [token]);
}

function librarySearchText(card: any): string {
  return [
    card.appName,
    card.summary,
    card.category,
    ...(card.tags ?? []),
    ...(card.surfaces ?? []),
  ].join(" ").toLowerCase();
}

function librarySearchTerms(card: any): Set<string> {
  return new Set(librarySearchText(card).split(/[^a-z0-9]+/).filter(Boolean));
}

function verifiedStack(card: any): string {
  return String(card?.verified?.stack ?? "").toLowerCase();
}

function stackMatchesSurface(card: any, surface: string): boolean {
  if (!surface) return true;
  const stack = verifiedStack(card);
  if (!stack) return true;
  const nativeStack = /\b(expo|react native|nativewind)\b/.test(stack);
  const webStack = /\b(next|vite|remix|astro|react \+ typescript|shadcn|tailwind)\b/.test(stack);
  if (surface === "web") return !nativeStack || webStack;
  if (surface === "mobile") return nativeStack || !webStack;
  return true;
}

function surfaceMatches(card: any, surface: string): boolean {
  if (!surface) return true;
  const surfaces = (card.surfaces ?? []).map((item: string) => String(item).toLowerCase());
  if (!surfaces.includes(surface)) return false;
  return stackMatchesSurface(card, surface);
}

function libraryCardScore(card: any, groups: string[][]): number {
  const tagSet = new Set((card.tags ?? []).map((tag: string) => String(tag).toLowerCase()));
  const surfaceSet = new Set((card.surfaces ?? []).map((surface: string) => String(surface).toLowerCase()));
  const category = String(card.category ?? "").toLowerCase();
  const appName = String(card.appName ?? "").toLowerCase();
  const summary = String(card.summary ?? "").toLowerCase();
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
        if (token.length >= 5 && String(tag).includes(token)) groupScore += 3;
      }
    }
    score += groupScore || -1;
  }

  if (card.verified?.status === "pass") score += 0.5;
  if (card.tier === "free") score += 0.2;
  if (card.beta) score -= 1;
  return score;
}

function normalizeSurface(input?: string): "" | "web" | "mobile" {
  const surface = String(input ?? "").trim().toLowerCase();
  if (!surface) return "";
  if (surface === "web" || surface === "mobile") return surface;
  throw new Error(`Invalid surface "${input}". Expected web or mobile.`);
}

function searchLibraryCards(cards: any[], query: string, options: { surface?: string; looseSurface?: boolean } = {}): any[] {
  const groups = librarySearchTokenGroups(query);
  const surface = normalizeSurface(options.surface);
  const looseSurface = Boolean(options.looseSurface);
  const candidates = surface
    ? (cards ?? []).filter((card) => {
      const surfaces = (card.surfaces ?? []).map((item: string) => String(item).toLowerCase());
      if (!surfaces.includes(surface)) return false;
      return looseSurface || stackMatchesSurface(card, surface);
    })
    : (cards ?? []);
  const ranked = candidates
    .map((card, index) => ({ card, index, score: libraryCardScore(card, groups), terms: librarySearchTerms(card) }))
    .filter((entry) => !groups.length || entry.score > 0)
    .sort((a, b) => (b.score - a.score) || (a.index - b.index));
  const strict = groups.length
    ? ranked.filter((entry) => groups.every((group) => group.some((token) => entry.terms.has(token))))
    : ranked;
  return (strict.length ? strict : ranked).map((entry) => entry.card);
}

/** Build the MCP server. `client` is how its tools reach the engine (stdio → remote; HTTP → loopback). */
export function buildServer(client: EngineHttpClient): McpServer {
  const server = new McpServer({ name: "v-1.design", version: "1.0.0" }, { instructions: INSTRUCTIONS });

  server.registerTool("search_library", {
    description: "Search the v-1.design Library catalog by app idea, tags, category, or surface. For a brand-new project, call this with limit:5, present the five candidate links, and ask the user which one resonates before pulling or editing unless they explicitly delegated the choice.",
    inputSchema: { query: z.string().default(""), surface: z.enum(["web", "mobile"]).optional(), limit: z.number().int().min(1).max(50).optional() },
  }, async ({ query, surface, limit }) => {
    const j = await client.json("GET", "/api/library");
    const max = limit ?? 8;
    const matches = searchLibraryCards(j.designs ?? [], query, { surface }).slice(0, max);
    if (surface && matches.length < max) {
      const seen = new Set(matches.map((d: any) => d.slug));
      const loose = searchLibraryCards(j.designs ?? [], query, { surface, looseSurface: true });
      for (const d of loose) {
        if (seen.has(d.slug)) continue;
        matches.push(d);
        seen.add(d.slug);
        if (matches.length >= max) break;
      }
    }
    if (!matches.length) {
      const scope = surface ? ` ${surface}` : "";
      return text(`No Library${scope} designs matched "${query}". Try broader words like books, reading, dashboard, marketplace, finance, or health.`);
    }
    const rows = matches.map((d: any) => {
      const tags = (d.tags ?? []).slice(0, 8).join(", ");
      const surfaces = (d.surfaces ?? []).join(", ") || "unknown surface";
      const strictNote = surface && !stackMatchesSurface(d, surface) ? " · surface-tagged visual reference" : "";
      return `- ${d.appName} (${d.slug})\n  ${d.summary}\n  ${d.category ?? "uncategorized"} · ${surfaces}${strictNote}${tags ? ` · ${tags}` : ""}\n  ${WEB_URL}/library/${encodeURIComponent(d.slug)}`;
    });
    const scope = surface ? ` ${surface}` : "";
    return text(`Library${scope} matches for "${query || "all"}":\n${rows.join("\n")}`);
  });

  // Rock-solid search over EVERY entity in the verified library — designs, screens,
  // palettes (by colour), fonts, components. The library as a RAG: keep searching,
  // pull handles, mix and match. Pull a result with get_design / get_screen_code /
  // get_tokens / get_theme using its handle (slug, slug/Screen, slug#palette, …).
  server.registerTool("search", {
    description: "Search the WHOLE verified v-1.design library at any granularity — designs, individual screens, palettes (by colour like 'teal'), fonts, and components. Returns ranked handles you then pull (get_design/get_screen_code/get_tokens) and mix-and-match. Keep searching + pulling; treat 'what should this look like?' as retrieval. type filters to one kind; surface to web|mobile.",
    inputSchema: { q: z.string(), type: z.enum(["design", "screen", "palette", "font", "component"]).optional(), surface: z.enum(["web", "mobile"]).optional(), limit: z.number().int().min(1).max(50).optional() },
  }, async ({ q, type, surface, limit }) => {
    const params = new URLSearchParams({ q });
    if (type) params.set("type", type);
    if (surface) params.set("surface", surface);
    params.set("limit", String(limit ?? 12));
    let res: any = null;
    try { res = await client.json("GET", `/api/search?${params.toString()}`); } catch { /* older engine */ }
    if (!res || !res.results) {
      const j = await client.json("GET", "/api/library");
      const m = searchLibraryCards(j.designs ?? [], q, { surface }).slice(0, limit ?? 12);
      return text(m.length ? m.map((d: any) => `- [design] ${d.appName} (${d.slug})`).join("\n") : `No matches for "${q}".`);
    }
    if (!res.results.length) return text(`No matches for "${q}".`);
    const rows = res.results.map((r: any) => {
      const what = r.type === "design" ? r.appName
        : r.type === "screen" ? `${r.design} · ${r.screen} (${r.surface})`
        : r.type === "palette" ? `${r.design} palette · ${r.colour} (${r.harmony ?? ""})`
        : r.type === "font" ? `${r.design} fonts · ${r.display ?? ""}/${r.body ?? ""}`
        : `${r.design} · ${r.component}`;
      return `- [${r.type}] ${what}\n    pull: ${r.handle}`;
    });
    return text(`${res.count} matches for "${q}" — top ${res.results.length}:\n${rows.join("\n")}`);
  });

  server.registerTool("list_designs", { description: "List the designs on your v-1.design account." }, async () => {
    const j = await client.json("GET", "/designs");
    const rows = (j.designs ?? []).map((d: any) => {
      // Report the count the handoff can actually deliver (ready screens), and flag locked/pending so
      // "5 screens" never overstates a 3-screen handoff (a recurring dogfood confusion).
      const st = d.status ?? {};
      const ready = typeof st.ready === "number" ? st.ready : d.screens;
      const extra = [
        st.locked ? `${st.locked} locked` : "",
        st.pending ? `${st.pending} generating` : "",
        st.failed ? `${st.failed} failed` : "",
      ].filter(Boolean).join(", ");
      const count = `${ready} screen${ready === 1 ? "" : "s"}${extra ? ` (+${extra})` : ""}`;
      return `- "${d.appName}" (${count}) · ${String(d.brief).slice(0, 60)}\n    ${studioUrl(d.id)}  ·  id: ${d.id}`;
    });
    return text(rows.length ? `Your designs:\n${rows.join("\n")}` : "No designs on your account yet. Use search_library to pull a library design (don't create one unless the user explicitly asked).");
  });

  server.registerTool("get_design", {
    description: "Fetch one finished design as a self-contained bundle (tokens + globals.css + every screen's TSX). Accepts a studio/share/library URL, project id, or library slug. A single read — not a loop.",
    inputSchema: { projectId: z.string().describe("Studio/share/library URL, project id, or library slug."), format: z.enum(["markdown", "json"]).optional() },
  }, async ({ projectId, format }) => {
    const ref = designRef(projectId);
    const fmt = format === "json" ? "json" : "md";
    // slim=1: the bundle omits inlined per-screen TSX (it blows the MCP token cap even on 3 screens) —
    // the agent pulls each screen's source + rendered image via get_screen_code, as the guide says.
    const body = await client.text(`/designs/${encodeURIComponent(ref)}?format=${fmt}&slim=1`);
    // Keep JSON pure (parseable); append the openable studio URL only to the markdown bundle.
    return text(fmt === "json" ? body : body + openLine(ref));
  });

  server.registerTool("get_screen_code", {
    description: "Get one screen of a design by name: accepts a studio/share/library URL, project id, or library slug. Returns the engine-rendered REFERENCE IMAGE of the screen (inline — you see it directly, no rendering needed on your side) plus its TSX source. Build your screen to match the image, reading exact values (sizes, spacing, colors, radii) from the code/tokens. Like Figma's get_screenshot + get_code.",
    inputSchema: { projectId: z.string().describe("Studio/share/library URL, project id, or library slug."), screenName: z.string() },
  }, async ({ projectId, screenName }) => {
    const ref = designRef(projectId);
    const j = await client.json("GET", `/designs/${encodeURIComponent(ref)}?format=json`);
    const s = (j.screens ?? []).find((x: any) => x.name?.toLowerCase() === screenName.toLowerCase());
    if (!s) return errText(`No screen "${screenName}". Screens: ${(j.screens ?? []).map((x: any) => x.name).join(", ")}`);
    if (!s.code) return errText(`Screen "${s.name}" has no source yet (status: ${s.status}).`);
    // Figma-style: hand the agent the rendered image INLINE so it can see the target without any
    // rendering capability of its own. Fall back to a URL line if the shot can't be fetched.
    const shot = s.screenshotUrl ? await client.bytes(s.screenshotUrl) : null;
    // Surface-aware caption: a web/desktop screen has no phone status bar / tab bar, so don't tell the
    // agent to build them (the #1 dogfood blocker was mobile chrome boilerplate on a desktop design).
    const isWeb = s.surface === "web";
    const dims = isWeb ? "1440×900" : "402×874";
    const chrome = isWeb
      ? `The shared chrome is the top nav bar / left sidebar — build it once and reuse it across routes; there is no phone status bar or bottom tab bar here.`
      : `The top status-bar row (time + signal/wifi/battery) and the bottom tab bar are MOCKUP CHROME: the OS draws the status bar (reserve it with a safe-area inset, never hand-draw it; keep the app logo/header just below it), and the tab bar is shared chrome built once and reused.`;
    const note = `Reference render of "${s.name}" (${dims}, full-bleed, rendered @2× — the app surface itself, no device frame). Build to match it. ${chrome} The TSX below is cleaned for handoff (studio-canvas attributes and the fixed-size frame removed); reproduce every value from it exactly.`;
    if (shot) {
      return {
        content: [
          { type: "image", data: shot.base64, mimeType: shot.mimeType },
          { type: "text", text: `${note}\n\n\`\`\`tsx\n${s.code}\n\`\`\`` },
        ],
      };
    }
    // Image-less client / fetch failure: keep the full guidance + the openable reference URL so a
    // text-only agent still has the target and the chrome rules (don't silently drop the note).
    const urlLine = s.screenshotUrl ? `Reference image (open it — your build must match it): ${s.screenshotUrl}\n` : "";
    return text(`${note}\n${urlLine}\n\`\`\`tsx\n${s.code}\n\`\`\``);
  });

  // EXPLORE — the recipe RUNNER. Pulls a few library designs as inspiration AND returns
  // the user's LOCAL recipe to run. Knows NOTHING about what the recipe does. No engine
  // credits. The default for "generate new designs / show me options".
  server.registerTool("explore", {
    description: "Explore designs for an idea — returns TWO SEPARATE LANES (deliver both, never blend): Lane A = existing v1design LIBRARY designs matching the idea (pull/adapt the idea onto them, reuse); Lane B = the user's LOCAL recipe to GENERATE brand-new designs on its own (do not feed Lane A in). The DEFAULT for 'generate new designs / show me options'. Spends NO engine credits. No local recipe → only Lane A + how to add a recipe.",
    inputSchema: { idea: z.string().min(1), surface: z.enum(["web", "mobile"]).optional(), pulled: z.number().int().min(0).max(12).optional(), recipe: z.string().optional().describe("path to a recipe dir; else discovered via V1DESIGN_RECIPE_DIR → ./.v1design/recipe → ~/.v1design/recipe") },
  }, async ({ idea, surface, pulled, recipe }) => {
    const { assembleExploration } = await import("../cli/explore.mjs");
    const r: any = await assembleExploration(idea, { surface, pulled, recipe });
    return text(r.text);
  });

  // The ENGINE forge — "studio". Generates a NEW design server-side (spends credits).
  // This is NOT the "explore" recipe runner; only use it on an explicit studio/forge ask.
  const studioForgeSchema = { brief: z.string().min(1).max(2000), confirm: z.boolean().optional().describe("Must be true. Set ONLY when the user explicitly asked for the studio forge to generate a new design."), target: z.enum(["web", "mobile", "both"]).optional(), mode: z.enum(["light", "dark"]).optional(), vibe: z.string().optional(), url: z.string().optional(), format: z.enum(["markdown", "json"]).optional(), wait: z.boolean().optional() };
  const studioForgeHandler = async ({ brief, confirm, target, mode, vibe, url, format, wait }: any, extra: any) => {
    if (!confirm) return errText("Refusing to forge a design without confirmation. The studio forge GENERATES a new design on the engine and SPENDS CREDITS — the default is library search + pull, or `explore` to generate from the user's local recipe (no engine credits). Only call create_studio_design again with confirm:true when the USER has EXPLICITLY asked for the studio forge.");
    const created = await client.json("POST", "/designs", { brief, target, mode, vibe, url });
    const pid = created.projectId;
    if (wait === false) return text(`Started generating "${created.appName}". projectId: ${pid}\n→ Watch it draft live in the studio: ${studioUrl(pid)}\nCall wait_for_design("${pid}") to receive the finished bundle here.`);
    await client.streamUntilDone(pid, reporter(extra as Extra));
    const fmt = format === "json" ? "json" : "md";
    const body = await client.text(`/designs/${pid}?format=${fmt}&slim=1`);
    if (fmt === "json") return text(body);
    const status = (await client.json("GET", `/designs/${pid}?format=json&slim=1`)).status;
    return text(body + footer(status) + openLine(pid));
  };
  server.registerTool("create_studio_design", {
    description: "STUDIO FORGE: generate a NEW app design from a brief on the engine. SPENDS CREDITS — only call when the user EXPLICITLY asked for the studio forge, and you MUST pass confirm:true (omitting it is refused). For 'generate new designs' in general, prefer `explore` (uses the user's local recipe, no engine credits); for existing designs, prefer search_library + pull. Blocks and streams progress, returning the finished bundle in one call (no polling). wait:false returns immediately with the projectId. Optional `url` MATCHes an existing brand.",
    inputSchema: studioForgeSchema,
  }, studioForgeHandler);
  // Deprecated alias kept one release so 0.3.x callers don't break.
  server.registerTool("create_design", {
    description: "DEPRECATED — renamed to create_studio_design (the engine forge, spends credits). Same behavior; requires confirm:true. Prefer `explore` to generate from the user's local recipe.",
    inputSchema: studioForgeSchema,
  }, studioForgeHandler);

  server.registerTool("add_screen", {
    description: "Add a NEW on-brand screen to an existing design. SPENDS CREDITS — only when the user EXPLICITLY asked to generate a new screen, and you MUST pass confirm:true (omitting it is refused). Blocks and streams progress, returning when the screen is ready.",
    inputSchema: { projectId: z.string(), name: z.string().min(1).max(80), confirm: z.boolean().optional().describe("Must be true. Set ONLY when the user explicitly asked to generate a new screen."), surface: z.enum(["mobile", "web"]).optional(), wait: z.boolean().optional() },
  }, async ({ projectId, name, confirm, surface, wait }, extra) => {
    if (!confirm) return errText("Refusing to add a screen without confirmation. add_screen GENERATES a new screen and SPENDS CREDITS. Only call it again with confirm:true when the USER has EXPLICITLY asked to generate a new screen.");
    const ref = designRef(projectId);
    await client.json("POST", `/designs/${encodeURIComponent(ref)}/screens`, { name, surface });
    if (wait === false) return text(`Adding "${name}" to ${ref}. Call get_design("${ref}") shortly to pull it.${openLine(ref)}`);
    await client.streamUntilDone(ref, reporter(extra as Extra));
    const j = await client.json("GET", `/designs/${encodeURIComponent(ref)}?format=json`);
    const s = (j.screens ?? []).find((x: any) => x.name?.toLowerCase() === name.toLowerCase());
    return text((s?.code ? `Added "${s.name}":\n\n\`\`\`tsx\n${s.code}\n\`\`\`` : `Added "${name}" to ${ref}.`) + openLine(ref));
  });

  server.registerTool("wait_for_design", {
    description: "Attach to an in-flight generation (e.g. started with wait:false or in the web studio) and receive the finished design here. Push-based — blocks once, no polling.",
    inputSchema: { projectId: z.string(), format: z.enum(["markdown", "json"]).optional() },
  }, async ({ projectId, format }, extra) => {
    const ref = designRef(projectId);
    await client.streamUntilDone(ref, reporter(extra as Extra));
    const fmt = format === "json" ? "json" : "md";
    const body = await client.text(`/designs/${encodeURIComponent(ref)}?format=${fmt}&slim=1`);
    return text(fmt === "json" ? body : body + openLine(ref));
  });

  // ── high-level orchestration verbs (state intent, not steps) ────────────
  // These wrap the v1design build pipeline so the agent issues one call. They
  // produce a runnable project on disk and run the deterministic gate.

  server.registerTool("build_app", {
    description: "Scaffold a runnable app from a v-1.design design (a library/studio/share URL or slug) and verify it. Produces a real Next.js (web) or Expo (mobile) project on disk — tokens, fonts, one route per screen — then builds + boots + probes every route. Use after the user has chosen a design. Returns the project path, routes, and the verify result.",
    inputSchema: {
      ref: z.string().describe("design URL, id, or library slug"),
      surface: z.enum(["web", "mobile"]).optional(),
      out: z.string().optional().describe("output directory (defaults to ~/.v1design/workspace/<ref>)"),
      install: z.boolean().optional().describe("install dependencies (default true)"),
    },
  }, async ({ ref, surface, out, install }) => {
    const { scaffoldFromRef } = await import("../cli/scaffold.mjs");
    const result: any = await scaffoldFromRef(ref, { surface, out, install: install ?? true, "allow-project-write": true });
    try {
      const { verifyProject } = await import("../cli/verify.mjs");
      result.verify = await verifyProject(result.projectDir, { against: result.ref, surface: result.surface });
    } catch (e: any) { result.verifyError = String(e?.message ?? e); }
    return text(`Built ${result.framework} app at ${result.projectDir}\nRoutes: ${result.routes.map((r: any) => r.path).join("  ")}\nVerify: ${result.verify ? (result.verify.pass ? "PASSED" : "issues found") : (result.verifyError || "skipped")}\nRun: ${result.runCommand}`);
  });

  server.registerTool("remix_app", {
    description: "Merge screens from two or more v-1.design designs into ONE coherent app. The --system design's tokens win and the others re-skin to match. Produces a runnable project on disk. Pass refs as URLs/ids/slugs, optionally with #ScreenName to pick specific screens.",
    inputSchema: {
      refs: z.array(z.string()).min(2).describe("two+ design refs (optionally ref#ScreenName)"),
      system: z.string().optional().describe("which design's system wins (default: first ref)"),
      surface: z.enum(["web", "mobile"]).optional(),
      out: z.string().optional(),
      install: z.boolean().optional(),
    },
  }, async ({ refs, system, surface, out, install }) => {
    const { remixCommand } = await import("../cli/remix.mjs");
    const result: any = await remixCommand(refs, { system, surface, out, install: install ?? false, "allow-project-write": true, json: false });
    return text(`Remixed ${result.screens.length} screens from ${result.sources.length} designs into the ${result.system} system.\nProject: ${result.projectDir}\nRoutes: ${result.routes.map((r: any) => r.path).join("  ")}${result.conflicts ? `\n${result.conflicts} donor screen(s) flagged in REMIX-CONFLICTS.md` : ""}`);
  });

  server.registerTool("verify_app", {
    description: "Verify a scaffolded app: build it, boot it, probe every route for HTTP 200 + a real page, run structural checks, and (with heal) attempt bounded auto-fixes. This is the deterministic quality gate — run it before declaring any v-1.design-derived build done.",
    inputSchema: {
      dir: z.string().describe("project directory"),
      heal: z.boolean().optional().describe("attempt auto-fixes and re-run"),
      against: z.string().optional().describe("design ref to grade against"),
    },
  }, async ({ dir, heal, against }) => {
    const { verifyProject } = await import("../cli/verify.mjs");
    const r: any = await verifyProject(dir, { heal, against, install: true });
    const routes = (r.routes || []).map((x: any) => `${x.ok ? "✓" : "✗"} ${x.route} (${x.status})`).join("\n");
    const checks = (r.structural || []).map((x: any) => `${x.ok ? "✓" : "✗"} ${x.name}`).join("\n");
    return text(`Verify ${r.pass ? "PASSED" : "FAILED"}\nbuild: ${r.build ? "ok" : "FAILED"}\n${checks}\n${routes}${r.pass ? "" : "\n\nFix the failures (or run with heal), then re-verify. For the WOW verdict, screenshot the routes and use grade."}`);
  });

  server.registerTool("grade", {
    description: "Get the WOW / visual verdict for a scaffolded app from the v-1.design oracle (the authoritative quality gate). Runs the deterministic gate, then asks the engine to score the build against the design's reference. Optionally pass screenshots of the running app for a per-screen visual comparison.",
    inputSchema: {
      dir: z.string(),
      against: z.string().optional(),
      surface: z.enum(["web", "mobile"]).optional(),
    },
  }, async ({ dir, against, surface }) => {
    const { gradeProject } = await import("../cli/grade.mjs");
    const r: any = await gradeProject(dir, { against, surface });
    const oracle = r.oracle?.available === false ? `oracle: ${r.oracle.note}` : `oracle: ${r.oracle?.pass ? "pass" : "below bar"}`;
    return text(`Grade ${r.pass ? "PASS" : "below bar"}\ndeterministic gate: ${r.deterministic.pass ? "pass" : "FAIL"}\n${oracle}${r.oracle?.issues?.length ? "\n- " + r.oracle.issues.join("\n- ") : ""}`);
  });

  server.registerTool("vibe", {
    description: "Hot re-skin a scaffolded app's design tokens — e.g. 'darker', 'teal fintech', 'warmer'. Because every screen styles via design tokens, this morphs the whole app at once. The running dev server hot-reloads the new look.",
    inputSchema: {
      intent: z.string().describe("e.g. 'darker', 'teal fintech', 'more vivid'"),
      dir: z.string().describe("the scaffolded app directory"),
    },
  }, async ({ intent, dir }) => {
    const { vibeCommand } = await import("../cli/vibe.mjs");
    const r: any = await vibeCommand(intent, { in: dir, json: false });
    return text(`Re-skinned "${intent}" → ${r.file}. The running dev server hot-reloads the new look.`);
  });

  // ---- the library as a RAG: pull tokens / theme / colors from ANY design ----
  server.registerTool("get_tokens", {
    description: "Pull a design's tokens from ANY design in the library (the library is a RAG, not just a gallery): semantic light+dark, primitive ramps, radius, typography/fonts, and hex. Compose them yourself — lift a palette, swap a font, mix two designs. Prefer pulling a proven theme over inventing colors.",
    inputSchema: { ref: z.string().describe("Studio/share/library URL, project id, or library slug.") },
  }, async ({ ref }) => {
    const { tokensGetCommand } = await import("../cli/theme.mjs");
    const r: any = await tokensGetCommand(ref, { __return: true });
    return text(JSON.stringify(r, null, 2));
  });

  server.registerTool("get_theme", {
    description: "Pull a design's full theme from ANY library design: the complete globals.css (light + dark token blocks + @theme map), or structured JSON. To re-skin a scaffolded app, write the CSS to its app/globals.css — every screen restyles via the tokens and the dev server hot-reloads.",
    inputSchema: { ref: z.string(), as: z.enum(["css", "json"]).optional().describe("css = the literal globals.css; json = structured (default)") },
  }, async ({ ref, as }) => {
    const { themeGetCommand } = await import("../cli/theme.mjs");
    const r: any = await themeGetCommand(ref, { css: as === "css", __return: true });
    return text(typeof r === "string" ? r : JSON.stringify(r, null, 2));
  });

  server.registerTool("get_colors", {
    description: "Pull a design's palette from ANY library design: seed, harmony, accent roles (primary/secondary/accent/destructive) and full primitive ramps, light + dark hex. Use it to recolor or match another design's look.",
    inputSchema: { ref: z.string() },
  }, async ({ ref }) => {
    const { colorsGetCommand } = await import("../cli/theme.mjs");
    const r: any = await colorsGetCommand(ref, { __return: true });
    return text(JSON.stringify(r, null, 2));
  });

  return server;
}

export { INSTRUCTIONS };
