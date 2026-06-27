// `v1design explore "<idea>"` — TWO SEPARATE LANES with a forcing function (Lane A can't
// silently drop) AND archetype-aware library search:
//   Lane A — adapt an existing v1design LIBRARY design onto the idea (REUSE). Searched by
//            ARCHETYPE (design fit) when --archetype is given, else by keyword (domain fit).
//   Lane B — GENERATE FRESH from the user's LOCAL recipe (on its own).
// Library matches come from /api/library (which carries `archetype`); there is no server-side
// search endpoint yet, so ranking is client-side. The CLI ships no doctrine of its own.
import { fetchLibrary } from "./lib/engine.mjs";
import { resolveRecipe, readRecipe } from "./lib/recipe.mjs";

const STOP = new Set(["app", "apps", "design", "designs", "ui", "ux", "a", "an", "the", "for", "with", "of", "to", "build", "make", "explore", "idea", "over", "other"]);
const STRONG = 2; // >= 2 keyword hits (or any archetype match) = a real library fit → Lane A REQUIRED

function rankCards(cards, idea, surface, limit, archetype) {
  const tokens = String(idea || "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t && !STOP.has(t));
  const arch = String(archetype || "").trim().toLowerCase();
  const scored = (cards || []).map((c) => {
    if (surface && !(c.surfaces || []).map((s) => String(s).toLowerCase()).includes(surface)) return null;
    const cardArch = String(c.archetype || "").toLowerCase();
    const archHit = arch && cardArch && (cardArch.includes(arch) || arch.includes(cardArch));
    if (arch && !archHit) return null; // --archetype is a FILTER: only that archetype's designs
    const hay = [c.appName, c.summary, c.category, ...(c.tags || [])].join(" ").toLowerCase();
    let kw = 0;
    for (const t of tokens) if (hay.includes(t)) kw += 1;
    // archetype match is a strong design-fit signal; keyword is domain-fit on top.
    return { card: c, kw, archHit: !!archHit, score: (archHit ? 10 : 0) + kw };
  }).filter(Boolean).sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

function refLine(e) {
  const c = e.card;
  const tags = (c.tags || []).slice(0, 4).join(", ");
  const a = c.archetype ? ` · ⟨${c.archetype}⟩` : "";
  return `  - ${c.appName} (${c.slug})${a}${c.category ? ` · ${c.category}` : ""}${tags ? ` · ${tags}` : ""}  [match ${e.score}]`;
}

function topArchetypes(cards, n = 8) {
  const counts = {};
  for (const c of cards || []) { const a = c.archetype; if (a) counts[a] = (counts[a] || 0) + 1; }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n).map(([a, k]) => `${a} (${k})`);
}

/** Assemble the two-lane explore output (pure; CLI + MCP share it). */
export async function assembleExploration(idea, flags = {}) {
  const surface = flags.surface || null;
  const pulled = Number(flags.pulled ?? 5);
  const archetype = flags.archetype || null;
  const recipe = resolveRecipe(flags);

  let cards = [];
  try { cards = await fetchLibrary(); } catch { /* offline → no library lane */ }
  const scored = rankCards(cards, idea, surface, pulled, archetype);
  const top = scored[0];
  // Strong if filtering by archetype (those are design-relevant by construction), or >=2 keyword hits.
  const strongA = archetype ? scored.length > 0 : (top?.score ?? 0) >= STRONG;
  const laneAList = scored.map(refLine).join("\n") || (archetype
    ? `  (no ${archetype} designs found for this surface)`
    : "  (no library matches)");
  const archHint = archetype ? "" : `\n  Tip: search Lane A by ARCHETYPE (design fit, not just domain) — re-run with --archetype "<name>".
  Available: ${topArchetypes(cards).join(", ")}.`;

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
    laneB = `  No local recipe found — Lane B unavailable. Add one: v1design recipe init (or V1DESIGN_RECIPE_DIR). See RECIPE.md.`;
  }

  const laneADo = strongA
    ? `  DO THIS (do NOT skip — there IS a real ${archetype ? archetype + " " : ""}match):
    1. v1design designs get ${top.card.slug}
    2. v1design theme get ${top.card.slug} --css
    3. Adapt "${idea}" onto ${top.card.appName}'s REAL system/palette/components and produce an artifact (e.g. a rendered concept). REUSE — do not author from scratch here.`
    : `  No STRONG library match — the matches above are tangential (different domain; best ${top ? top.score : 0} hit${(top?.score ?? 0) === 1 ? "" : "s"}). Lane A is OPTIONAL here. You MUST still make an explicit decision and state it: (a) re-run with --archetype "<name>" to pull design-relevant matches and adapt one, (b) adapt the closest match anyway (note it's a stretch), or (c) skip Lane A and say "skipped — no close library fit". NEVER silently drop it.`;

  const doneWhen = strongA
    ? "you have produced BOTH a Lane-A adaptation artifact AND a Lane-B fresh artifact (two separate deliverables)."
    : "you have produced a Lane-B fresh artifact AND stated an explicit Lane-A decision (archetype-search, adapted-closest, or skipped-with-reason). A silent Lane-A drop = explore NOT done.";

  const text =
`v1design explore — "${idea}"${archetype ? `  (Lane A archetype: ${archetype})` : ""}

DELIVERABLES — explore is NOT complete until BOTH lanes are handled, as SEPARATE artifacts:
  [ ] Lane A — adapt an existing LIBRARY design onto this idea   (${strongA ? "REQUIRED" : "OPTIONAL — no strong fit; decision still required"})
  [ ] Lane B — generate a FRESH design from your recipe          (REQUIRED)

━━━ LANE A · adapt an existing LIBRARY design (searched ${archetype ? `by archetype "${archetype}"` : "by keyword"}) ━━━
${laneAList}${archHint}
${laneADo}

━━━ LANE B · GENERATE FRESH from your recipe ━━━
${laneB}

DONE WHEN: ${doneWhen}
Keep the lanes separate — never blend Lane A into Lane B.`;

  return {
    text,
    json: {
      idea, surface, archetype: archetype || null,
      laneA: { required: strongA, searchedBy: archetype ? "archetype" : "keyword", topMatch: top?.card.slug ?? null, topScore: top?.score ?? 0, designs: scored.map((e) => e.card.slug) },
      laneB: recipe.found ? { source: "recipe", dir: recipe.dir } : null,
    },
  };
}

/** CLI entry for `v1design explore "<idea>"`. */
export async function exploreCommand(idea, flags = {}) {
  if (!idea || !String(idea).trim()) {
    throw new Error('Usage: v1design explore "<idea>" [--archetype "<name>"] [--pulled M] [--surface web|mobile] [--recipe <path>] [--json]');
  }
  const { text, json } = await assembleExploration(idea, flags);
  if (flags.json) console.log(JSON.stringify(json, null, 2));
  else console.log(text);
  return json;
}
