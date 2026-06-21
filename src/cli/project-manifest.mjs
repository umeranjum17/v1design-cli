// The on-system manifest + theme lock. These let `compose`/extend refuse to
// add a screen under a different design system, so an app never drifts.
import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { EXPO_SDK } from "./scaffold/templates.mjs";

/** Stable hash of the design's token values (semantic light/dark + type + shape). */
export function tokensHash(designSystem) {
  const ds = designSystem || {};
  const material = { semantic: ds.semantic, typography: ds.typography, shape: ds.shape, seedHex: ds.seedHex };
  return createHash("sha256").update(JSON.stringify(material)).digest("hex").slice(0, 16);
}

export async function writeProjectManifest(projectDir, { handoff, surface, framework, screens }) {
  const dir = join(projectDir, ".v1design");
  await mkdir(dir, { recursive: true });
  const manifest = {
    designRef: handoff.id,
    appName: handoff.appName,
    surface,
    framework,
    screens: screens.map((s) => s.name),
    tokensHash: tokensHash(handoff.designSystem),
    expoSdk: framework === "expo" ? EXPO_SDK : null,
    createdWith: "@v1design/cli",
  };
  await writeFile(join(dir, "project.json"), JSON.stringify(manifest, null, 2) + "\n");

  // A human-readable lock of the token values this app is pinned to.
  const lock = `// v-1.design system lock — every screen here is built against these tokens.
// Do NOT add a screen under a different design system; use \`v1design compose\`.
export const TOKENS_HASH = ${JSON.stringify(manifest.tokensHash)};
export const DESIGN_REF = ${JSON.stringify(manifest.designRef)};
`;
  await writeFile(join(projectDir, "theme.lock.ts"), lock);
  return manifest;
}

export async function readProjectManifest(projectDir) {
  try {
    const raw = await readFile(join(projectDir, ".v1design", "project.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
