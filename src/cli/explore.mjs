// `v1design explore "<idea>"` — TWO SEPARATE LANES with a FORCING FUNCTION so Lane A
// can't silently drop:
//   Lane A — adapt an existing v1design LIBRARY design onto the idea (REUSE).
//   Lane B — GENERATE FRESH from the user's LOCAL recipe (on its own).
// Lane A is REQUIRED when there's a genuine library match, and HONESTLY OPTIONAL (with a
// stated decision — never a silent drop) when the library has no close fit. The output ends
// with a hard DELIVERABLES checklist + a DONE-WHEN gate. The CLI ships no doctrine of its own.
import { fetchLibrary } from "./lib/engine.mjs";
import { resolveRecipe, readRecipe } from "./lib/recipe.mjs";

const STOP = new Set(["app", "apps", "design", "designs", "ui", "ux", "a", "an", "the", "for", "with", "of", "to", "build", "make", "explore", "idea", "over", "other"]);
const STRONG = 2; // >= 2 token hits on a match = a real library fit (Lane A becomes REQUIRED)

function rankCards(cards, idea, surface, limit) {
  const tokens = String(idea || "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t && !STOP.has(t));
  const scored = (cards || []).map((c) => {
    if (surface && !(c.surfaces || []).map((s) => String(s).toLowerCase()).includes(surface)) return { card: c, score: -1 };
    const hay = [c.appName, c.summary, c.category, ...(c.tags || [])].join(" ").toLowerCase();
    let s = 0;
    for (const t of tokens) if (hay.includes(t)) s += 1;
    return { card: c, score: s }; // raw token hits = relevance (verified bonus omitted so it doesn't fake "strong")
  }).filter((x) => x.score >= 0).sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

function refLine(e) {
  const c = e.card;
  const tags = (c.tags || []).slice(0, 5).join(", ");
  return `  - ${c.appName} (${c.slug})${c.category ? ` · ${c.category}` : ""}${tags ? ` · ${tags}` : ""}  [match ${e.score}]`;
}

/** Assemble the two-lane explore output with the forcing function (pure; CLI + MCP share it). */
export async function assembleExploration(idea, flags = {}) {
  const surface = flags.surface || null;
  const pulled = Number(flags.pulled ?? 5);
  const recipe = resolveRecipe(flags);

  let cards = [];
  try { cards = await fetchLibrary(); } catch { /* offline → no library lane */ }
  const scored = rankCards(cards, idea, surface, pulled);
  const top = scored[0];
  const strongA = (top?.score ?? 0) >= STRONG;
  const laneAList = scored.map(refLine).join("\n") || "  (no library matches)";

  let laneB;
  if (recipe.found) {
    const { manifest, files } = await readRecipe(recipe.dir);
    laneB =
`  recipe: ${recipe.dir}  (via ${recipe.source})
  files: recipe.md${files.length ? `, ${files.join(", ")}` : ""}

  Generate BRAND-NEW design(s) for "${idea}" from the recipe's own doctrine — on its own.
  Do NOT reuse Lane A's designs as input. Read recipe.md (+ referenced files) and follow it.

  ────────────────────────── recipe.md ──────────────────────────
${manifest.trim().split("\n").map((l) => "  " + l).join("\n")}
  ────────────────────────────────────────────────────────────────`;
  } else {
    laneB =
`  No local recipe found — Lane B unavailable. Add one: v1design recipe init (or V1DESIGN_RECIPE_DIR). See RECIPE.md.`;
  }

  const laneADo = strongA
    ? `  DO THIS (do NOT skip — there IS a real match):
    1. v1design designs get ${top.card.slug}
    2. v1design theme get ${top.card.slug} --css
    3. Adapt "${idea}" onto ${top.card.appName}'s REAL system/palette/components and produce an artifact (e.g. a rendered concept). This is REUSE — do not author from scratch here.`
    : `  No STRONG library match — the matches above are tangential (different domain; best match ${top ? top.score : 0} hit${(top?.score ?? 0) === 1 ? "" : "s"}). Lane A is OPTIONAL here. You MUST still make an explicit decision and state it: either (a) adapt the closest match anyway and note it's a stretch, or (b) skip Lane A and say "skipped — no close library fit for this idea". NEVER silently drop it.`;

  const doneWhen = strongA
    ? "you have produced BOTH a Lane-A adaptation artifact AND a Lane-B fresh artifact (two separate deliverables)."
    : "you have produced a Lane-B fresh artifact AND stated an explicit Lane-A decision (adapted-the-closest, or skipped-with-reason). A silent Lane-A drop = explore NOT done.";

  const text =
`v1design explore — "${idea}"

DELIVERABLES — explore is NOT complete until BOTH lanes are handled, as SEPARATE artifacts:
  [ ] Lane A — adapt an existing LIBRARY design onto this idea   (${strongA ? "REQUIRED" : "OPTIONAL — no strong fit; decision still required"})
  [ ] Lane B — generate a FRESH design from your recipe          (REQUIRED)

━━━ LANE A · adapt an existing LIBRARY design ━━━
${laneAList}
${laneADo}

━━━ LANE B · GENERATE FRESH from your recipe ━━━
${laneB}

DONE WHEN: ${doneWhen}
Keep the lanes separate — never blend Lane A into Lane B.`;

  return {
    text,
    json: {
      idea, surface,
      laneA: { required: strongA, topMatch: top?.card.slug ?? null, topScore: top?.score ?? 0, designs: scored.map((e) => e.card.slug) },
      laneB: recipe.found ? { source: "recipe", dir: recipe.dir } : null,
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
