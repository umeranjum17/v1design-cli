// `v1design explore "<idea>"` — TWO SEPARATE LANES with a forcing function (Lane A can't
// silently drop) AND archetype-aware library search:
//   Lane A — adapt an existing v1design LIBRARY design onto the idea (REUSE). Searched by
//            ARCHETYPE (design fit) when --archetype is given, else by keyword (domain fit).
//   Lane B — GENERATE FRESH from the user's LOCAL recipe (on its own).
// Lane A uses the engine's INDEXED /api/search (searches every field incl. prompts) when it's
// available, else falls back to a client-side rank over /api/library. The CLI ships no doctrine.
import { fetchLibrary, searchLibraryRemote } from "./lib/engine.mjs";
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
  const rel = (e.relevance != null) ? `relevance ${e.relevance}%` : `match ${e.score}`;
  return `  - ${c.appName} (${c.slug})${a}${c.category ? ` · ${c.category}` : ""}${tags ? ` · ${tags}` : ""}  [${rel}]`;
}

function topArchetypes(cards, n = 8) {
  const counts = {};
  for (const c of cards || []) { const a = c.archetype; if (a) counts[a] = (counts[a] || 0) + 1; }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n).map(([a, k]) => `${a} (${k})`);
}

/** Assemble the two-lane explore output (pure; CLI + MCP share it). */
export async function assembleExploration(idea, flags = {}) {
  const surface = flags.surface || null;
  const adapt = Math.max(1, Number(flags.adapt ?? 2));   // Lane A count (default 2 unless the user asks for more)
  const fresh = Math.max(1, Number(flags.fresh ?? 2));   // Lane B count (default 2)
  const pulled = Number(flags.pulled ?? Math.max(5, adapt + 3));
  const archetype = flags.archetype || null;
  const recipe = resolveRecipe(flags);
  const slug = (String(idea).toLowerCase().match(/[a-z0-9]+/g) || ["idea"]).slice(0, 4).join("-");
  const folder = `v1-explore/${slug}${surface ? `-${surface}` : ""}`;   // FRESH per-idea folder; never muddle an existing one

  // Lane A search: prefer the engine's indexed /api/search (covers prompts); fall back to client-side.
  let cards = [];
  let scored, searchedBy;
  const remote = await searchLibraryRemote(idea, { surface, archetype, limit: pulled });
  if (remote && Array.isArray(remote.results) && remote.results.length) {
    scored = remote.results.map((r) => ({
      card: { appName: r.appName, slug: r.slug || r.handle, archetype: r.archetype, category: r.category, tags: r.tags || [] },
      score: r.score ?? 0,
      relevance: r.relevance,
    }));
    searchedBy = `engine /api/search · indexed, incl. prompts (${remote.backend})`;
  } else {
    try { cards = await fetchLibrary(); } catch { /* offline → no library lane */ }
    scored = rankCards(cards, idea, surface, pulled, archetype);
    searchedBy = archetype ? `archetype "${archetype}" · client` : "keyword · client";
  }
  const top = scored[0];
  const fromEngine = searchedBy.startsWith("engine");
  // Engine results are relevance-ranked (any result = a real match); client keyword needs >=2 hits.
  const strongA = (fromEngine || archetype) ? scored.length > 0 : (top?.score ?? 0) >= STRONG;
  const laneAList = scored.map(refLine).join("\n") || (archetype
    ? `  (no ${archetype} designs found for this surface)`
    : "  (no library matches)");
  const archHint = archetype ? "" : `\n  Tip: narrow Lane A by ARCHETYPE (design fit) — re-run with --archetype "<name>".${cards.length ? `\n  Available: ${topArchetypes(cards).join(", ")}.` : ""}`;

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
    ? `  DO THIS (do NOT skip — there IS a real ${archetype ? archetype + " " : ""}match). Adapt the TOP ${adapt}:
    1. v1design designs get ${top.card.slug}   (then: v1design theme get ${top.card.slug} --css)
    2. Adapt "${idea}" onto ${top.card.appName}'s REAL system/palette/components → a rendered concept in ${folder}/. REUSE — do not author from scratch.
    3. Repeat for the next ${Math.max(0, adapt - 1)} match(es) listed above. RENDER each to a PNG in ${folder}/.`
    : `  No STRONG library match — the matches above are tangential (best ${top ? (top.relevance != null ? top.relevance + "% relevance" : top.score + " hits") : 0}). Lane A is OPTIONAL here. You MUST still make an explicit decision and state it: (a) re-run with --archetype "<name>" to pull design-relevant matches, (b) adapt the closest anyway (note it's a stretch), or (c) skip Lane A with reason. NEVER silently drop it.`;

  const doneWhen = strongA
    ? `you've produced ${adapt} Lane-A adaptation(s) AND ${fresh} Lane-B fresh concept(s), RENDERED each to a PNG in ${folder}/, written ${folder}/manifest.json, and run \`v1design gallery ${folder}\` so the user can pick one in their browser.`
    : `you've produced ${fresh} Lane-B fresh concept(s) rendered to PNGs in ${folder}/ + an explicit Lane-A decision, written ${folder}/manifest.json, and run \`v1design gallery ${folder}\`. A silent Lane-A drop = explore NOT done.`;

  const text =
`v1design explore — "${idea}"${archetype ? `  (Lane A archetype: ${archetype})` : ""}

▶ WORK IN A FRESH FOLDER (never muddle an existing one):
  ${folder}/      — mkdir -p it; EVERY concept HTML, PNG render, and manifest.json goes here.

▶ GROUND IT in the USER's context first: skim their repo (README, package.json, what they're building,
  who their end-users are). BOTH lanes must fit THEIR product AND their users — not just the idea string.

DELIVERABLES — explore is NOT done until BOTH lanes are handled AND shown to the user:
  [ ] Lane A — adapt ${adapt} existing LIBRARY design(s) onto this idea   (${strongA ? "REQUIRED" : "OPTIONAL — no strong fit; decision still required"})
  [ ] Lane B — generate ${fresh} FRESH design(s) from your recipe          (REQUIRED)
  [ ] RENDER every concept to a PNG in ${folder}/ (your headless browser — playwright / puppeteer)
  [ ] Write ${folder}/manifest.json  →  [{file,name,style,source,pitch,lane:"A"|"B",palette,fonts}]
  [ ] OPEN the gallery for the user:  v1design gallery ${folder}
      (assembles a browser page of all options — Lane A vs Lane B — and opens it; the user picks one)

━━━ LANE A · adapt ${adapt} existing LIBRARY design(s) (searched via ${searchedBy}) ━━━
${laneAList}${archHint}
${laneADo}

━━━ LANE B · GENERATE ${fresh} FRESH design(s) from your recipe ━━━
${laneB}

DONE WHEN: ${doneWhen}
  Then the user PICKS one in the gallery and builds their app from it.
Keep the lanes separate — never blend Lane A into Lane B. Default ${adapt} adapted + ${fresh} fresh unless the user asks for more.`;

  return {
    text,
    json: {
      idea, surface, archetype: archetype || null, folder, adapt, fresh,
      gallery: `v1design gallery ${folder}`,
      laneA: { required: strongA, searchedBy, topMatch: top?.card.slug ?? null, topScore: top?.score ?? 0, topRelevance: top?.relevance ?? null, designs: scored.map((e) => e.card.slug) },
      laneB: recipe.found ? { source: "recipe", dir: recipe.dir } : null,
    },
  };
}

/** CLI entry for `v1design explore "<idea>"`. */
export async function exploreCommand(idea, flags = {}) {
  if (!idea || !String(idea).trim()) {
    throw new Error('Usage: v1design explore "<idea>" [--surface web|mobile] [--adapt N] [--fresh N] [--archetype "<name>"] [--recipe <path>] [--json]\nThen render the concepts into the printed folder and run: v1design gallery <folder>  (opens a browser gallery to pick from).');
  }
  const { text, json } = await assembleExploration(idea, flags);
  if (flags.json) console.log(JSON.stringify(json, null, 2));
  else console.log(text);
  return json;
}
