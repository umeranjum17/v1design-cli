// `v1design explore "<idea>"` — the recipe RUNNER. Discovers a local recipe and
// assembles a two-track EXPLORATION plan for the agent: PULL library designs as
// inspiration + GENERATE fresh per the recipe (jury-vetted, concept-first, NO SEED).
// With no local recipe it falls back to remote library exploration. Ships ZERO doctrine.
import { fetchLibrary } from "./lib/engine.mjs";
import { resolveRecipe, readRecipe } from "./lib/recipe.mjs";

const STOP = new Set(["app", "apps", "design", "designs", "ui", "ux", "a", "an", "the", "for", "with", "of", "to", "build", "make", "create", "explore", "idea"]);

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
  return `- ${c.appName} (${c.slug})${c.category ? ` · ${c.category}` : ""}${tags ? ` · ${tags}` : ""}`;
}

/** Build the exploration plan (pure — used by both the CLI and the MCP `explore` tool). */
export async function assembleExploration(idea, flags = {}) {
  const surface = flags.surface || null;
  const fresh = Number(flags.fresh ?? 3);
  const pulled = Number(flags.pulled ?? 3);
  const recipe = resolveRecipe(flags);

  let cards = [];
  try { cards = await fetchLibrary(); } catch { /* offline → no pulled refs */ }
  const refs = rankCards(cards, idea, surface, pulled);

  if (!recipe.found) {
    const text =
`v1design explore — "${idea}"  (no local recipe → remote library exploration)

PULLED from the library as inspiration (${refs.length}):
${refs.map(refLine).join("\n") || "  (no matches — try broader words)"}

No local recipe found, so I can't generate FRESH designs from a pipeline.
  • Scaffold one:  v1design recipe init     (then edit ./.v1design/recipe/)
  • Or point V1DESIGN_RECIPE_DIR at your recipe folder.
See RECIPE.md for the format.`;
    return { text, json: { idea, surface, recipe: null, fallback: "remote-library", pulled: refs.map((c) => c.slug), seed: false } };
  }

  const { manifest, files } = await readRecipe(recipe.dir);
  const text =
`v1design explore — "${idea}"
recipe: ${recipe.dir}  (via ${recipe.source})
recipe files: recipe.md${files.length ? `, ${files.join(", ")}` : ""}

Run the recipe's "explore" flow. TWO TRACKS, both jury-vetted and CONCEPT-FIRST.
HARD RULE: this is EXPLORATION — STOP before any seed/list/publish step. Do not run
seed-library / stamp-verified / any "add to library" step here.

A) PULL — ${refs.length} library design(s) as inspiration:
${refs.map(refLine).join("\n") || "  (no matches)"}

B) FRESH — generate ${fresh} new concept(s) per the recipe below, anchored on the
   pulled designs + the recipe's own inspiration. Score each against the recipe's jury.

Read recipe.md (and its referenced files in ${recipe.dir}) and follow it exactly.

────────────────────────── recipe.md ──────────────────────────
${manifest.trim()}
────────────────────────────────────────────────────────────────`;
  return {
    text,
    json: { idea, surface, recipe: { dir: recipe.dir, source: recipe.source, files: ["recipe.md", ...files] }, fresh, pulled: refs.map((c) => c.slug), seed: false },
  };
}

/** CLI entry for `v1design explore "<idea>"`. */
export async function exploreCommand(idea, flags = {}) {
  if (!idea || !String(idea).trim()) {
    throw new Error('Usage: v1design explore "<idea>" [--fresh N] [--pulled M] [--surface web|mobile] [--recipe <path>]');
  }
  const { text, json } = await assembleExploration(idea, flags);
  if (flags.json) console.log(JSON.stringify(json, null, 2));
  else console.log(text);
  return json;
}
