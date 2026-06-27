// Recipe discovery — the heart of v1design-as-a-RUNNER. The CLI ships ZERO doctrine;
// it discovers a LOCAL, user-owned recipe (a folder with `recipe.md` + optional
// doctrine/jury/inspiration/workflow/archetypes/stages `.md` files) and runs it. The
// recipe is BYO + portable + private — yours stays in your private repo, never shipped.
//
// Discovery order: --recipe flag → V1DESIGN_RECIPE_DIR → nearest ./.v1design/recipe up
// the tree → ~/.v1design/recipe. None found → the caller falls back to the remote library.
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve, parse as parsePath } from "node:path";
import { homedir } from "node:os";

/** A directory is a recipe iff it exists and holds a `recipe.md` manifest. */
function hasRecipe(dir) {
  return !!dir && existsSync(join(dir, "recipe.md"));
}

/** Walk up from a starting dir looking for a `.v1design/recipe/` with a manifest. */
function findUpProject(startDir) {
  let dir = resolve(startDir);
  const { root } = parsePath(dir);
  while (true) {
    const cand = join(dir, ".v1design", "recipe");
    if (hasRecipe(cand)) return cand;
    if (dir === root) break;
    dir = resolve(dir, "..");
  }
  return null;
}

/** Resolve the active recipe directory, or { found:false } → remote fallback. */
export function resolveRecipe(flags = {}, cwd = process.cwd()) {
  const candidates = [
    { dir: flags.recipe, source: "--recipe" },
    { dir: process.env.V1DESIGN_RECIPE_DIR, source: "V1DESIGN_RECIPE_DIR" },
    { dir: findUpProject(cwd), source: "./.v1design/recipe" },
    { dir: join(homedir(), ".v1design", "recipe"), source: "~/.v1design/recipe" },
  ];
  for (const c of candidates) {
    if (hasRecipe(c.dir)) return { found: true, dir: resolve(c.dir), source: c.source };
  }
  return { found: false, dir: null, source: null };
}

/** Read a recipe folder: the `recipe.md` manifest text + the names of its other `.md` files. */
export async function readRecipe(dir) {
  const manifest = await readFile(join(dir, "recipe.md"), "utf8");
  let files = [];
  try { files = (await readdir(dir)).filter((f) => f.endsWith(".md") && f !== "recipe.md").sort(); } catch {}
  return { manifest, files };
}
