// `v1design explore "<idea>"` — TWO SEPARATE LANES, never blended:
//   Lane A — pull from the v1design LIBRARY and explore the idea on those existing designs.
//   Lane B — GENERATE FRESH from the user's LOCAL recipe (if one is present), on its own.
// The lanes are independent on purpose: Lane A reuses what exists; Lane B creates new from the
// recipe. The CLI does NOT feed Lane A's designs into Lane B, and ships no doctrine of its own.
import { fetchLibrary } from "./lib/engine.mjs";
import { resolveRecipe, readRecipe } from "./lib/recipe.mjs";

const STOP = new Set(["app", "apps", "design", "designs", "ui", "ux", "a", "an", "the", "for", "with", "of", "to", "build", "make", "explore", "idea"]);

function rankCards(cards, idea, surface, limit) {
  const tokens = String(idea || "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t && !STOP.has(t));
  const scored = (cards || []).map((c) => {
    if (surface && !(c.surfaces || []).map((s) => String(s).toLowerCase()).includes(surface)) return { c, s: -1 };
    const hay = [c.appName, c.summary, c.category, ...(c.tags || [])].join(" ").toLowerCase();
    let s = 0;
    for (const t of tokens) if (hay.includes(t)) s += 1;
    if (c.verified?.status === "pass") s += 0.2;
    return { c, s };
  }).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map((x) => x.c);
}

function refLine(c) {
  const tags = (c.tags || []).slice(0, 6).join(", ");
  return `  - ${c.appName} (${c.slug})${c.category ? ` · ${c.category}` : ""}${tags ? ` · ${tags}` : ""}`;
}

/** Assemble the two-lane explore output (pure — shared by the CLI and the MCP `explore` tool). */
export async function assembleExploration(idea, flags = {}) {
  const surface = flags.surface || null;
  const pulled = Number(flags.pulled ?? 4);
  const recipe = resolveRecipe(flags);

  // Lane A — the library.
  let cards = [];
  try { cards = await fetchLibrary(); } catch { /* offline → no library lane */ }
  const refs = rankCards(cards, idea, surface, pulled);
  const laneA = refs.map(refLine).join("\n") || "  (no library matches — try broader words)";

  // Lane B — the local recipe.
  let laneB;
  if (recipe.found) {
    const { manifest, files } = await readRecipe(recipe.dir);
    laneB =
`  recipe: ${recipe.dir}  (via ${recipe.source})
  files: recipe.md${files.length ? `, ${files.join(", ")}` : ""}

  Run this recipe to GENERATE BRAND-NEW designs for "${idea}" — on its own, from the
  recipe's own doctrine/inspiration. Do NOT reuse Lane A's designs as input here.
  Read recipe.md (and its referenced files in ${recipe.dir}) and follow it.

  ────────────────────────── recipe.md ──────────────────────────
${manifest.trim().split("\n").map((l) => "  " + l).join("\n")}
  ────────────────────────────────────────────────────────────────`;
  } else {
    laneB =
`  No local recipe found — Lane B (fresh generation) is unavailable here.
  Add one:  v1design recipe init   (or set V1DESIGN_RECIPE_DIR). See RECIPE.md.`;
  }

  const text =
`v1design explore — "${idea}"

TWO SEPARATE LANES. Keep them apart — never blend Lane A into Lane B. Deliver BOTH so the
user can compare: the idea explored on EXISTING library designs, and BRAND-NEW designs from
the recipe.

━━━ LANE A · explore your idea on the LIBRARY (${refs.length} existing design${refs.length === 1 ? "" : "s"}) ━━━
${laneA}
  → Pull any of these and adapt "${idea}" onto it — its system, screens, palette, components.
    This lane REUSES what already exists (pull/remix), it does NOT generate anything new.

━━━ LANE B · GENERATE FRESH from your recipe ━━━
${laneB}`;

  return {
    text,
    json: {
      idea, surface,
      laneA: { source: "library", designs: refs.map((c) => c.slug) },
      laneB: recipe.found ? { source: "recipe", dir: recipe.dir, recipeSource: recipe.source } : null,
    },
  };
}

/** CLI entry for `v1design explore "<idea>"`. */
export async function exploreCommand(idea, flags = {}) {
  if (!idea || !String(idea).trim()) {
    throw new Error('Usage: v1design explore "<idea>" [--pulled M] [--surface web|mobile] [--recipe <path>] [--json]');
  }
  const { text, json } = await assembleExploration(idea, flags);
  if (flags.json) console.log(JSON.stringify(json, null, 2));
  else console.log(text);
  return json;
}
