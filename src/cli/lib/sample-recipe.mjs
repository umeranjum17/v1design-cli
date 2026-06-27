// The SAMPLE recipe `v1design recipe init` scaffolds. A TEMPLATE only — it shows the
// FORMAT (what files a recipe has) with placeholder content for the user to replace
// with their OWN design pipeline. It is NOT anyone's real doctrine, and it prescribes
// no workflow — the CLI ships none. Embedded as strings so `recipe init` always works.

const recipeMd = `---
name: my-recipe
description: A starter design-exploration recipe. Replace the placeholders with your own.
version: 0.1.0
entry: explore
---

# My recipe (TEMPLATE)

This file shows the FORMAT of a v1design recipe. Replace everything with your own.

When you run \`v1design explore "<idea>"\`, the CLI pulls a few library designs as
inspiration and hands the agent THIS file. What happens next is entirely up to you —
the CLI has no design doctrine and no workflow of its own.

Reference whatever files you want (all optional):
- \`doctrine.md\`     — your design principles
- \`archetypes.md\`   — the styles you use
- \`jury.md\`         — how you judge a design
- \`inspiration.md\`  — how you pull references
- \`workflow.md\`     — your ops rules
- \`stages.md\`       — your ordered steps

## Flow: explore

Describe, step by step, what the agent should do with an idea plus the pulled library
designs. For example:

1. Pull a few references for the idea (see inspiration.md).
2. Pick a fitting style (see archetypes.md + doctrine.md).
3. Generate some concepts and judge them (see jury.md).
4. Show the results.

Replace these with your own steps. Stop wherever you like — it's your pipeline.
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
    "(Sample lines — replace with your actual rules.)",
  ]),
  "archetypes.md": placeholder("Archetypes", [
    "The named styles you use, and when to pick each. For example:",
    "- Editorial — magazine type, generous whitespace; for content/brand.",
    "- Swiss — grid, restraint; for tools/dashboards.",
    "",
    "(Sample list — replace with your own.)",
  ]),
  "jury.md": placeholder("Jury", [
    "How you judge a design and the bar it must clear. For example:",
    "- Look for a clear signature moment, real content, strong type hierarchy.",
    "",
    "(Sample — replace with your own scoring.)",
  ]),
  "inspiration.md": placeholder("Inspiration", [
    "How you pull references for a brief. For example:",
    "- Search by category + style; note 2-3 anchors per concept.",
    "",
    "(Sample — replace with your own method.)",
  ]),
  "workflow.md": placeholder("Workflow", [
    "Your operational rules. For example:",
    "- Render concepts first; only build the one that's chosen.",
    "- Surface results as you go.",
    "",
    "(Sample — replace with your own.)",
  ]),
  "stages.md": placeholder("Stages", [
    "Your ordered steps. For example:",
    "",
    "explore:  idea -> pull inspiration -> pick a style -> generate concepts -> judge -> show",
    "",
    "(Add whatever stages you want — the CLI doesn't prescribe any.)",
  ]),
};
