// `v1design explore "<idea>"` — the recipe RUNNER. It does exactly two things and
// knows NOTHING about what a recipe does: (1) pull some library designs as inspiration
// for the idea, (2) discover the user's LOCAL recipe and hand it to the agent to run.
// Every workflow decision — what to generate, how to judge it, whether anything is ever
// published — lives in the user's own recipe `.md` files. This CLI ships no doctrine and
// no workflow. No local recipe → just the library results.
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
  return `- ${c.appName} (${c.slug})${c.category ? ` · ${c.category}` : ""}${tags ? ` · ${tags}` : ""}`;
}

/** Assemble the explore output (pure — shared by the CLI and the MCP `explore` tool). */
export async function assembleExploration(idea, flags = {}) {
  const surface = flags.surface || null;
  const pulled = Number(flags.pulled ?? 3);
  const recipe = resolveRecipe(flags);

  let cards = [];
  try { cards = await fetchLibrary(); } catch { /* offline → no pulled refs */ }
  const refs = rankCards(cards, idea, surface, pulled);
  const refsBlock = refs.map(refLine).join("\n") || "  (no matches — try broader words)";

  if (!recipe.found) {
    const text =
`v1design explore — "${idea}"  (no local recipe found)

Library designs for "${idea}" (${refs.length}):
${refsBlock}

There's no local recipe, so there's nothing to run beyond the library results above.
  • Add your own:  v1design recipe init   (then edit ./.v1design/recipe/)
  • Or point V1DESIGN_RECIPE_DIR at your recipe folder.
See RECIPE.md.`;
    return { text, json: { idea, surface, recipe: null, pulled: refs.map((c) => c.slug) } };
  }

  const { manifest, files } = await readRecipe(recipe.dir);
  const text =
`v1design explore — "${idea}"
recipe: ${recipe.dir}  (via ${recipe.source})
files: recipe.md${files.length ? `, ${files.join(", ")}` : ""}

Library designs pulled as inspiration for "${idea}" (${refs.length}):
${refsBlock}

Now run YOUR recipe: read recipe.md (and its referenced files in ${recipe.dir}) and
follow it for "${idea}", using the pulled designs above as inspiration. The recipe
defines everything that happens next — this CLI ships no doctrine or workflow of its own.

────────────────────────── recipe.md ──────────────────────────
${manifest.trim()}
────────────────────────────────────────────────────────────────`;
  return {
    text,
    json: { idea, surface, recipe: { dir: recipe.dir, source: recipe.source, files: ["recipe.md", ...files] }, pulled: refs.map((c) => c.slug) },
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
