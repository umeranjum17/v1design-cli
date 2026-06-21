// Pull tokens / theme / colors from ANY design — the library as a RAG. These
// are pure retrieval verbs: they hand the agent the raw material (semantic
// tokens, the full globals.css, the palette + fonts) and the agent (LLM) does
// the composing — swap a font, lift a palette, mix two designs. No deterministic
// transforms here; the engine's gate enforces quality.
//
// Each command hits the dedicated engine endpoint when present and falls back to
// the format=json handoff, so it works against older engines too.
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { apiRequest, normalizeRef, fetchHandoff, assertSafeWritePath } from "./lib/engine.mjs";
import { oklchToHex } from "./scaffold/color.mjs";

const HEX_ROLES = [
  "background", "foreground", "card", "cardForeground", "primary", "primaryForeground",
  "secondary", "accent", "muted", "mutedForeground", "border", "destructive",
];

function hexRoles(ds) {
  const hex = (v) => { try { return oklchToHex(v) || v; } catch { return v; } };
  return HEX_ROLES.map((r) => ({ role: r, light: hex(ds.semantic?.light?.[r]), dark: hex(ds.semantic?.dark?.[r]) }));
}

function parseTokensJson(handoff) {
  const tj = handoff.artifacts?.tokensJson;
  try { return typeof tj === "string" ? JSON.parse(tj) : (tj || {}); } catch { return {}; }
}

async function endpoint(ref, suffix, expect = "json") {
  const r = normalizeRef(ref);
  return apiRequest("GET", `/designs/${encodeURIComponent(r)}/${suffix}`, { expect, refForAccess: r });
}

async function pullTokens(ref) {
  try { return await endpoint(ref, "tokens"); }
  catch {
    const h = await fetchHandoff(ref);
    const ds = h.designSystem || {};
    return {
      id: h.id, appName: h.appName,
      semantic: { light: ds.semantic?.light, dark: ds.semantic?.dark },
      primitives: ds.primitives, radius: ds.shape?.radius, typography: ds.typography,
      hex: ds.semantic ? hexRoles(ds) : [], tokensJson: parseTokensJson(h),
    };
  }
}

async function pullThemeJson(ref) {
  try { return await endpoint(ref, "theme"); }
  catch {
    const h = await fetchHandoff(ref);
    const ds = h.designSystem || {};
    return {
      id: h.id, mode: h.mode ?? "light", globalsCss: h.artifacts?.globalsCss || "",
      light: ds.semantic?.light, dark: ds.semantic?.dark, radius: ds.shape?.radius, typography: ds.typography,
    };
  }
}

async function pullThemeCss(ref) {
  try { return await endpoint(ref, "theme?format=css", "text"); }
  catch { const h = await fetchHandoff(ref); return h.artifacts?.globalsCss || ""; }
}

async function pullColors(ref) {
  try { return await endpoint(ref, "colors"); }
  catch {
    const h = await fetchHandoff(ref);
    const ds = h.designSystem || {};
    const roles = ds.semantic ? hexRoles(ds) : [];
    return {
      id: h.id, seed: ds.seedHex, harmony: ds.harmony,
      accents: roles.filter((x) => ["primary", "secondary", "accent", "destructive"].includes(x.role)),
      palette: roles, primitives: ds.primitives,
    };
  }
}

async function emit(data, flags, label, asText = false) {
  const body = asText ? String(data) : JSON.stringify(data, null, 2);
  if (flags.out) {
    const out = await assertSafeWritePath(String(flags.out), flags, label);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, body);
    if (!flags.__return) console.log(`Wrote ${out}`);
  } else if (!flags.__return) {
    console.log(body);
  }
  return data;
}

export async function tokensGetCommand(ref, flags = {}) {
  if (!ref) throw new Error('Usage: v1design tokens get <ref> [--json] [--out tokens.json]');
  return emit(await pullTokens(ref), flags, "tokens output");
}

export async function themeGetCommand(ref, flags = {}) {
  if (!ref) throw new Error('Usage: v1design theme get <ref> [--css] [--out theme.css|theme.json]');
  const wantCss = Boolean(flags.css) || (flags.out && String(flags.out).toLowerCase().endsWith(".css"));
  if (wantCss) return emit(await pullThemeCss(ref), flags, "theme css", true);
  return emit(await pullThemeJson(ref), flags, "theme output");
}

export async function colorsGetCommand(ref, flags = {}) {
  if (!ref) throw new Error('Usage: v1design colors get <ref> [--out colors.json]');
  return emit(await pullColors(ref), flags, "colors output");
}
