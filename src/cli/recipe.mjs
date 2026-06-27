// `v1design recipe` — manage the LOCAL recipe that `v1design explore` runs.
//   recipe init   scaffold a SAMPLE recipe into ./.v1design/recipe (a TEMPLATE showing
//                 the format + a sample flow — NOT anyone's real doctrine).
//   recipe path   print the resolved recipe dir (debug the discovery order).
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveRecipe } from "./lib/recipe.mjs";
import { SAMPLE_RECIPE } from "./lib/sample-recipe.mjs";

async function init(flags) {
  const dir = flags.out || join(process.cwd(), ".v1design", "recipe");
  if (existsSync(join(dir, "recipe.md")) && !flags.force) {
    throw new Error(`A recipe already exists at ${dir}. Pass --force to overwrite.`);
  }
  await mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(SAMPLE_RECIPE)) {
    await writeFile(join(dir, name), content);
  }
  console.error(`✓ Sample recipe scaffolded at ${dir}`);
  console.error(`  Files: ${Object.keys(SAMPLE_RECIPE).join(", ")}`);
  console.error(`  This is a TEMPLATE — replace the placeholders with your own doctrine.`);
  console.error(`  Then run:  v1design explore "<idea>"`);
}

async function path(flags) {
  const r = resolveRecipe(flags);
  if (!r.found) {
    console.error("No recipe found. Discovery order: --recipe → V1DESIGN_RECIPE_DIR → ./.v1design/recipe → ~/.v1design/recipe");
    console.error("Run `v1design recipe init` to create one.");
    process.exitCode = 1;
    return;
  }
  console.log(r.dir);
  console.error(`(via ${r.source})`);
}

export async function recipeCommand(sub, flags) {
  if (sub === "init") return init(flags);
  if (sub === "path") return path(flags);
  console.error("Usage:\n  v1design recipe init [--out <dir>] [--force]\n  v1design recipe path");
  if (sub) process.exitCode = 1;
}
