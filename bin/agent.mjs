#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const tsxLoader = require.resolve("tsx");
const entry = join(root, "src", "cli", "agent-main.mjs");
const result = spawnSync(process.execPath, ["--import", tsxLoader, entry, ...process.argv.slice(2)], { stdio: "inherit" });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
