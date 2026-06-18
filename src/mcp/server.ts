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

WORKFLOW: stay non-intrusive until the user explicitly asks to use v-1.design in the project. It is okay to connect, check status, and search_library as read-only discovery. Do not create a design, pull artifacts, fetch screen code into files, or edit the target repo unless the user asks to pull/use/build/integrate/create with v-1.design. If the user provides an app idea but no design link and asks to use v-1.design, search_library first, with surface:"web" for browser/Next.js work or surface:"mobile" for React Native/Expo work. Inspect the best matching Library design with get_design, then choose a reference and build from it. create_design with a product brief generates a new design on the user's account; the finished bundle (design tokens + every screen's TSX) is returned in that same call. add_screen adds a screen; get_design pulls one; list_designs lists the user's own designs.

Every result also includes a studio URL (https://…/studio/<id>) — SHARE IT with the user so they can open the design in their browser to see it rendered and tweak it visually.

HOW TO REPRODUCE FAITHFULLY (like Figma's Dev Mode): the engine is the renderer and the source of truth. get_screen_code returns the engine-RENDERED reference image of a screen INLINE — you see exactly how it should look with no rendering capability of your own — plus the screen's TSX. Build to match the image by reading the EXACT values (sizes, spacing, colors as tokens, radii, weights) from the TSX/design-tokens.json — do not eyeball or "improve". There is no required screenshot-diff loop; precise values + the image you're handed are what guarantee the match (if you happen to be able to render your build, comparing it to the image is a nice self-check, not a requirement). In every render, the top status-bar row (time + signal/wifi/battery) and the bottom tab bar are MOCKUP CHROME, not app content: the OS draws the status bar (reserve it with a safe-area inset, never hand-draw it) and the tab bar is shared chrome you build ONCE and reuse.

THEN BUILD THE REAL APP. The screens are a visual reference (web React + Tailwind tokens) — you own routing, state, data and the implementation. Pick the path for the user's target:
• WEB (Next.js + React + Tailwind / shadcn by default for a new repo): start with a Next.js App Router TypeScript project unless the target repo already uses another stack or the user asks otherwise. In an existing web repo, keep its framework/router and integrate only the requested screens/components. Use the screens almost directly — drop app/globals.css in (use the token classes bg-background / text-foreground / bg-primary / rounded-lg, never hard-code colors), load the two Google fonts from DESIGN.md, extract the shared chrome (nav/sidebar/tab bar) into ONE reused component, then one route per screen, replacing placeholder content with real data/state. The reference frame is not a viewport contract: the app must fill the browser, adapt at wide/normal/mobile sizes, and never leave exposed body whitespace from a fixed 1440px shell.
• MOBILE (React Native / Expo by default for a new repo): start with Expo + React Native unless the target repo already uses another mobile stack or the user asks otherwise. The TSX handoff won't run as-is in native — treat the design as the SOURCE OF TRUTH for look & feel and re-implement it with native primitives (View/Text/FlatList/ScrollView/Pressable) or the repo's NativeWind/components. Read design-tokens.json for palette/type/radius and keep the same tokens across screens.
• OTHER NATIVE STACKS (Flutter, SwiftUI, etc.): the TSX won't run as-is — rebuild with native primitives, matching hierarchy, spacing, tokens, and copy.

IMPORTANT: never poll. create_design / add_screen / wait_for_design are push-based — they stream progress and return the finished design in one call. get_design is a single read, not a loop.`;

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

function searchLibraryCards(cards: any[], query: string, options: { surface?: string } = {}): any[] {
  const groups = librarySearchTokenGroups(query);
  const surface = normalizeSurface(options.surface);
  const candidates = surface
    ? (cards ?? []).filter((card) => (card.surfaces ?? []).map((item: string) => String(item).toLowerCase()).includes(surface))
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
    description: "Search the v-1.design Library catalog by app idea, tags, category, or surface. Use this before choosing a reference when the user asks for a new app but does not provide a design link.",
    inputSchema: { query: z.string().default(""), surface: z.enum(["web", "mobile"]).optional(), limit: z.number().int().min(1).max(50).optional() },
  }, async ({ query, surface, limit }) => {
    const j = await client.json("GET", "/api/library");
    const matches = searchLibraryCards(j.designs ?? [], query, { surface }).slice(0, limit ?? 8);
    if (!matches.length) {
      const scope = surface ? ` ${surface}` : "";
      return text(`No Library${scope} designs matched "${query}". Try broader words like books, reading, dashboard, marketplace, finance, or health.`);
    }
    const rows = matches.map((d: any) => {
      const tags = (d.tags ?? []).slice(0, 8).join(", ");
      const surfaces = (d.surfaces ?? []).join(", ") || "unknown surface";
      return `- ${d.appName} (${d.slug})\n  ${d.summary}\n  ${d.category ?? "uncategorized"} · ${surfaces}${tags ? ` · ${tags}` : ""}\n  ${WEB_URL}/library/${encodeURIComponent(d.slug)}`;
    });
    const scope = surface ? ` ${surface}` : "";
    return text(`Library${scope} matches for "${query || "all"}":\n${rows.join("\n")}`);
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
    return text(rows.length ? `Your designs:\n${rows.join("\n")}` : "No designs yet. Use create_design.");
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

  server.registerTool("create_design", {
    description: "Generate a new app design from a brief. Blocks and streams progress, returning the finished design bundle in one call (no polling). Pass wait:false to return immediately with just the projectId. Optionally pass `url` (or just paste an existing site's URL in the brief) to MATCH that brand — the engine fetches the site and seeds the design's color, logo & nav from it. Vibe/palette are auto-inferred when omitted.",
    inputSchema: { brief: z.string().min(1).max(2000), target: z.enum(["web", "mobile", "both"]).optional(), mode: z.enum(["light", "dark"]).optional(), vibe: z.string().optional(), url: z.string().optional(), format: z.enum(["markdown", "json"]).optional(), wait: z.boolean().optional() },
  }, async ({ brief, target, mode, vibe, url, format, wait }, extra) => {
    const created = await client.json("POST", "/designs", { brief, target, mode, vibe, url });
    const pid = created.projectId;
    if (wait === false) return text(`Started generating "${created.appName}". projectId: ${pid}\n→ Watch it draft live in the studio: ${studioUrl(pid)}\nCall wait_for_design("${pid}") to receive the finished bundle here.`);
    await client.streamUntilDone(pid, reporter(extra as Extra));
    const fmt = format === "json" ? "json" : "md";
    const body = await client.text(`/designs/${pid}?format=${fmt}&slim=1`);
    if (fmt === "json") return text(body);
    const status = (await client.json("GET", `/designs/${pid}?format=json&slim=1`)).status;
    return text(body + footer(status) + openLine(pid));
  });

  server.registerTool("add_screen", {
    description: "Add a new on-brand screen to an existing design. Blocks and streams progress, returning when the screen is ready.",
    inputSchema: { projectId: z.string(), name: z.string().min(1).max(80), surface: z.enum(["mobile", "web"]).optional(), wait: z.boolean().optional() },
  }, async ({ projectId, name, surface, wait }, extra) => {
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

  return server;
}

export { INSTRUCTIONS };
