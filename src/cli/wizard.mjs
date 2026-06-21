// `v1design new` — the flagship. One sentence in: an idea OR a specific design.
// Idea → search the library, present candidates, pick → scaffold → verify → run.
// Explicit design (URL/slug/--design) → scaffold it as-is. Interactive when a TTY
// is present and clack is installed; otherwise fully non-interactive (top match).
import { fetchLibrary, normalizeRef } from "./lib/engine.mjs";
import { scaffoldFromRef } from "./scaffold.mjs";

const STOP = new Set(["app", "apps", "design", "designs", "ui", "ux", "a", "an", "the", "for", "with", "of", "to", "build", "make", "create"]);

function looksLikeRef(s) {
  const t = String(s || "").trim();
  return /^https?:\/\//.test(t) || /-[0-9a-f]{6,}$/i.test(t) || (/^[a-z0-9-]+$/i.test(t) && t.includes("-") && t.split(/\s+/).length === 1);
}

function scoreCard(card, tokens, surface) {
  if (surface) {
    const surfs = (card.surfaces || []).map((s) => String(s).toLowerCase());
    if (!surfs.includes(surface)) return -1;
  }
  const text = [card.appName, card.summary, card.category, ...(card.tags || [])].join(" ").toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if ((card.tags || []).some((tag) => String(tag).toLowerCase() === t)) score += 8;
    else if (text.includes(t)) score += 3;
  }
  if (card.verified?.status === "pass") score += 0.5;
  if (card.tier === "free") score += 0.2;
  if (card.beta) score -= 1;
  return score;
}

async function searchCandidates(idea, surface, limit = 6) {
  const cards = await fetchLibrary();
  const tokens = String(idea).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t && !STOP.has(t));
  return cards
    .map((c) => ({ c, score: scoreCard(c, tokens, surface) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.c);
}

async function loadClack() {
  if (!process.stdin.isTTY) return null;
  try { return await import("@clack/prompts"); } catch { return null; }
}

export async function newCommand(idea, flags) {
  const surface = flags.surface || null;

  // 1. Explicit design? Scaffold as-is.
  const explicit = flags.design || (looksLikeRef(idea) ? idea : null);
  if (explicit) {
    const ref = normalizeRef(explicit);
    console.error(`Building "${ref}" as-is…`);
    return runScaffold(ref, flags);
  }

  if (!idea) throw new Error('Usage: v1design new "your idea" [--surface web|mobile] [--design <ref>] [--install] [--run]');

  // 2. Idea → discover.
  const clack = await loadClack();
  if (clack) clack.intro("v1design — let's build something awesome");

  const candidates = await searchCandidates(idea, surface);
  if (!candidates.length) {
    throw new Error(`No library matches for "${idea}". Try different words, or pass a specific --design <ref>.`);
  }

  let chosenRef;
  if (clack && !flags.yes) {
    const pick = await clack.select({
      message: `Pick a direction for "${idea}"`,
      options: candidates.map((c) => ({
        value: c.slug || c.id,
        label: `${c.appName} — ${c.summary || c.category || ""}`.slice(0, 80),
        hint: [(c.surfaces || []).join("/"), c.tier].filter(Boolean).join(" · "),
      })),
    });
    if (clack.isCancel(pick)) { clack.cancel("Cancelled."); return; }
    chosenRef = pick;
  } else {
    chosenRef = candidates[0].slug || candidates[0].id;
    console.error(`Selected: ${candidates[0].appName} (${chosenRef})`);
    if (candidates.length > 1) {
      console.error(`  Other options: ${candidates.slice(1, 4).map((c) => c.appName).join(", ")}`);
    }
  }

  if (clack) clack.outro(`Building ${chosenRef}…`);
  return runScaffold(chosenRef, flags);
}

async function runScaffold(ref, flags) {
  // Default to install so the app is runnable; auto-open when --run.
  const scaffoldFlags = { ...flags, install: flags.install ?? true };
  const result = await scaffoldFromRef(ref, scaffoldFlags);

  // Verify unless skipped or we're about to hand off to a long-running dev.
  if (!flags["no-verify"] && !flags.run) {
    try {
      const { verifyProject } = await import("./verify.mjs");
      result.verify = await verifyProject(result.projectDir, { against: result.ref, surface: result.surface });
    } catch (e) {
      console.error(`Verify skipped: ${e instanceof Error ? e.message : e}`);
    }
  }

  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.error("");
    console.error(`✓ ${result.framework === "next" ? "Next.js" : "Expo"} app ready at ${result.projectDir}`);
    console.error(`  Routes: ${result.routes.map((r) => r.path).join("  ")}`);
    if (result.verify) console.error(`  Verify: ${result.verify.pass ? "PASSED" : "see issues above"}`);
    console.error(`  Run: cd ${result.projectDir} && ${result.runCommand}`);
  }
  return result;
}
