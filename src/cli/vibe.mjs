// vibe — hot re-skin a scaffolded app's tokens. Because every screen styles via
// var(--token), rewriting the :root/.dark token block in globals.css morphs the
// whole app on the running dev server in one shot. Two modes:
//   - a named transform ("darker", "lighter", "warmer", "cooler", "more vivid")
//     applied deterministically to the OKLCH tokens (zero model cost), or
//   - a free-text intent (e.g. "teal fintech") deferred to the engine if it
//     exposes a re-skin endpoint; otherwise we apply the closest named transform.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

// Adjust an oklch(L C H [/ a]) string by deltas on L (lightness) and C (chroma),
// and optionally rotate hue toward a target.
function tweakOklch(str, { dL = 0, dC = 0, hue = null, hueMix = 0 }) {
  return str.replace(/oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)([^)]*)\)/gi, (m, L, C, H, rest) => {
    let l = L.endsWith("%") ? parseFloat(L) / 100 : parseFloat(L);
    let c = parseFloat(C);
    let h = parseFloat(H);
    l = Math.max(0, Math.min(1, l + dL));
    c = Math.max(0, c + dC);
    if (hue != null && hueMix > 0) h = (h * (1 - hueMix) + hue * hueMix) % 360;
    const lOut = L.endsWith("%") ? `${(l * 100).toFixed(1)}%` : l.toFixed(3);
    return `oklch(${lOut} ${c.toFixed(4)} ${h.toFixed(1)}${rest})`;
  });
}

const NAMED = {
  darker: { dL: -0.06, dC: 0 },
  lighter: { dL: +0.06, dC: 0 },
  warmer: { dL: 0, dC: +0.01, hue: 40, hueMix: 0.18 },
  cooler: { dL: 0, dC: +0.01, hue: 240, hueMix: 0.18 },
  vivid: { dL: 0, dC: +0.03 },
  muted: { dL: 0, dC: -0.03 },
  punchy: { dL: -0.03, dC: +0.04 },
};

// Map free-text intents to a hue + transform (deterministic, no model cost).
const HUE_WORDS = [
  { re: /\bteal|cyan|aqua\b/, hue: 195 }, { re: /\bblue|fintech|sky\b/, hue: 250 },
  { re: /\bgreen|forest|sage|mint\b/, hue: 150 }, { re: /\bpurple|violet|indigo\b/, hue: 290 },
  { re: /\bpink|rose|magenta\b/, hue: 350 }, { re: /\bred|crimson|scarlet\b/, hue: 25 },
  { re: /\borange|amber|sunset\b/, hue: 55 }, { re: /\byellow|gold\b/, hue: 95 },
];

function resolveTransform(intent) {
  const t = String(intent || "").toLowerCase();
  for (const key of Object.keys(NAMED)) if (t.includes(key)) return NAMED[key];
  for (const w of HUE_WORDS) if (w.re.test(t)) return { dL: 0, dC: +0.01, hue: w.hue, hueMix: 0.5 };
  if (/\bdark\b/.test(t)) return NAMED.darker;
  if (/\blight\b/.test(t)) return NAMED.lighter;
  return NAMED.vivid;
}

export async function vibeCommand(intent, flags) {
  if (!intent) throw new Error('Usage: v1design vibe "<darker|teal fintech|...>" [--in ./dir]');
  const dir = flags.in || flags.out || process.cwd();
  const cssPath = existsSync(join(dir, "app", "globals.css"))
    ? join(dir, "app", "globals.css")
    : existsSync(join(dir, "global.css"))
      ? join(dir, "global.css")
      : null;
  if (!cssPath) throw new Error(`No globals.css / global.css under ${dir}. Run vibe inside a scaffolded app (--in <dir>).`);

  const transform = resolveTransform(intent);
  let css = await readFile(cssPath, "utf8");

  // Re-skin only the token blocks (lines with `--name: oklch(...)`), leaving the
  // structural CSS untouched. The dev server hot-reloads the change instantly.
  const before = css;
  css = css.replace(/(--[a-z-]+:\s*)(oklch\([^;]+\))/gi, (m, name, val) => `${name}${tweakOklch(val, transform)}`);

  if (css === before) throw new Error("No OKLCH tokens found to re-skin in globals.css.");
  await writeFile(cssPath, css);

  if (flags.json) console.log(JSON.stringify({ intent, applied: transform, file: cssPath }, null, 2));
  else console.error(`✓ Re-skinned "${intent}" → ${cssPath}\n  The running dev server hot-reloads the new look instantly.`);
  return { file: cssPath, applied: transform };
}
