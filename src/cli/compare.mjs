// compare — side-by-side decision aid for two or more designs. Prints appName,
// vibe, fonts, accent, surfaces, and screen list, and can open each in browser.
// Read-only; no engine changes.
import { fetchHandoff, openUrl, normalizeRef } from "./lib/engine.mjs";

function summarize(handoff) {
  const ds = handoff.designSystem || {};
  return {
    ref: handoff.id,
    appName: handoff.appName,
    vibe: ds.vibe || ds.name || "",
    fontDisplay: ds.typography?.fontDisplay || "",
    fontBody: ds.typography?.fontBody || "",
    accent: ds.seedHex || ds.semantic?.light?.accent || "",
    surfaces: [...new Set((handoff.screens || []).map((s) => s.surface || "mobile"))],
    screens: (handoff.screens || []).filter((s) => (s.kind ?? "screen") !== "specimen").map((s) => s.name),
  };
}

export async function compareCommand(refs, flags) {
  const list = (refs || []).filter(Boolean).map(normalizeRef);
  if (list.length < 2) throw new Error("Usage: v1design compare <refA> <refB> [..] [--surface web|mobile] [--open]");

  const cards = [];
  for (const ref of list) cards.push(summarize(await fetchHandoff(ref)));

  if (flags.open) {
    const web = (process.env.V1_DESIGN_WEB_URL || "https://v-1.design").replace(/\/+$/, "");
    for (const c of cards) openUrl(`${web}/library/${c.ref}`);
  }

  if (flags.json) { console.log(JSON.stringify(cards, null, 2)); return cards; }

  console.error("");
  for (const c of cards) {
    console.error(`▸ ${c.appName}  (${c.ref})`);
    console.error(`   vibe: ${c.vibe}`);
    console.error(`   type: ${c.fontDisplay} / ${c.fontBody}   accent: ${c.accent}`);
    console.error(`   surfaces: ${c.surfaces.join(", ")}`);
    console.error(`   screens: ${c.screens.join(", ")}`);
    console.error("");
  }
  const shared = cards.map((c) => new Set(c.screens.map((s) => s.toLowerCase())))
    .reduce((a, b) => new Set([...a].filter((x) => b.has(x))));
  if (shared.size) console.error(`Shared screen concepts: ${[...shared].join(", ")}`);
  console.error(`Tip: remix them → v1design remix ${list.join(" ")} --system ${list[0]}`);
  return cards;
}
