// Download a design's rendered reference PNGs (the public /shot route) so a
// plain CLI user can review the design visually without an agent/MCP.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchHandoff, fetchShot, assertSafeWritePath, workspaceDirFor, normalizeRef } from "./lib/engine.mjs";

export async function screenshotsCommand(ref, flags) {
  if (!ref) throw new Error("Usage: v1design screenshots <design-ref> [--out ./shots] [--screens A,B]");
  const handoff = await fetchHandoff(ref);
  const want = flags.screens ? String(flags.screens).split(",").map((s) => s.trim().toLowerCase()) : null;
  let screens = (handoff.screens || []).filter((s) => (s.kind ?? "screen") !== "specimen");
  if (want) screens = screens.filter((s) => want.includes(String(s.name).toLowerCase()));

  const outDir = await assertSafeWritePath(
    flags.out || join(workspaceDirFor(handoff.id || ref), "shots"),
    flags, "screenshots output"
  );
  await mkdir(outDir, { recursive: true });

  const written = [];
  for (const s of screens) {
    try {
      const png = await fetchShot(handoff.id, s.name);
      const file = join(outDir, `${s.name.replace(/[^a-zA-Z0-9]+/g, "-")}.png`);
      await writeFile(file, png);
      written.push({ name: s.name, file, bytes: png.length });
    } catch (e) {
      console.error(`  ! ${s.name}: ${e.message || e}`);
    }
  }

  if (flags.json) console.log(JSON.stringify({ ref: handoff.id, outDir, written }, null, 2));
  else {
    console.error(`Saved ${written.length} reference screenshot(s) to ${outDir}`);
    for (const w of written) console.error(`  ${w.name} → ${w.file}`);
  }
  return { outDir, written };
}
