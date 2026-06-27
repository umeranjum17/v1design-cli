// The SAMPLE recipe `v1design recipe init` scaffolds. This is a TEMPLATE only — it
// shows the FORMAT (what files a recipe has + a sample exploration flow) with
// placeholder content. It is NOT anyone's real doctrine; users replace the
// placeholders with their own. Embedded as strings so `recipe init` always works
// regardless of how the package is installed.

const recipeMd = `---
name: my-recipe
description: A starter design-exploration recipe. Replace the placeholders with your own doctrine.
version: 0.1.0
entry: explore
---

# My recipe (TEMPLATE)

This file shows the FORMAT of a v1design recipe. It is NOT real doctrine — replace
everything below with your own. A recipe declares one or more **flows** an agent runs.
\`v1design explore "<idea>"\` discovers this folder and runs the **explore** flow.

The referenced files are yours to fill in:
- \`doctrine.md\`     — your design principles (palette, type, layout, motion rules)
- \`archetypes.md\`   — the named styles you commit to (and when to use each)
- \`jury.md\`         — how you score a design / the bar it must clear
- \`inspiration.md\`  — how you pull references for a brief
- \`workflow.md\`     — operational rules (batching, tooling, cleanup)
- \`stages.md\`       — the ordered stages of each flow

## Flow: explore  (generate fresh + pull inspiration — NO seeding)

When the user says "explore designs for this idea / generate new ones":
1. Read \`inspiration.md\` and pull a few existing references for the idea.
2. Read \`archetypes.md\` + \`doctrine.md\` and pick a fitting style.
3. Generate N fresh **concepts** (concept-first — cheap render, not a full build).
4. Score each against \`jury.md\`. Keep the strong ones.
5. STOP here. Show the variety. Do NOT publish/seed anything — this is exploration.

## (Optional) Flow: ship  (your full pipeline, if you have one)

If you also have a "make it real / publish" pipeline, document its stages in
\`stages.md\` and reference it here. Keep any publish/seed step OUT of \`explore\`.
`;

const placeholder = (title, lines) => `# ${title} (TEMPLATE — replace with your own)\n\n${lines.join("\n")}\n`;

export const SAMPLE_RECIPE = {
  "recipe.md": recipeMd,
  "doctrine.md": placeholder("Doctrine", [
    "Your design principles go here. For example:",
    "- One rationed accent on a light ground; commit to a real type personality.",
    "- Real content, never placeholder data.",
    "- Each design commits to ONE named style (see archetypes.md), executed with polish.",
    "",
    "(These are sample lines — replace them with your actual rules.)",
  ]),
  "archetypes.md": placeholder("Archetypes", [
    "The named styles you commit to, and when to use each. For example:",
    "- Editorial — magazine type, generous whitespace; for content/brand.",
    "- Neobrutalism — hard edges, bold blocks; for playful/indie.",
    "- Swiss — grid, restraint; for tools/dashboards.",
    "",
    "(Sample list — replace with your own archetypes + selection rules.)",
  ]),
  "jury.md": placeholder("Jury", [
    "How you score a design and the bar it must clear. For example:",
    "- Dimensions: composition, type hierarchy, color restraint, content authenticity.",
    "- Ship bar: a clear signature moment + no obvious AI-slop tells.",
    "",
    "(Sample rubric — replace with your own scoring + thresholds.)",
  ]),
  "inspiration.md": placeholder("Inspiration", [
    "How you pull references for a brief. For example:",
    "- Search your library / corpus by category + archetype + palette.",
    "- Cite 2-3 craft anchors per concept.",
    "",
    "(Sample — replace with your own reference-pulling method.)",
  ]),
  "workflow.md": placeholder("Workflow", [
    "Operational rules. For example:",
    "- Render concepts first; only build the one that's chosen.",
    "- Batch heavy builds a few at a time.",
    "- Surface renders as you go.",
    "",
    "(Sample — replace with your own ops rules.)",
  ]),
  "stages.md": placeholder("Stages", [
    "The ordered stages of each flow.",
    "",
    "explore:  idea → pull inspiration → pick style → generate concepts → jury → STOP (no publish)",
    "ship:     (if you have one) … → verify → publish   (keep publish OUT of explore)",
    "",
    "(Sample — replace with your own stages.)",
  ]),
};
