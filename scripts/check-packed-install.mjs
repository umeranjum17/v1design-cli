#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = new URL("..", import.meta.url).pathname;
const tmp = mkdtempSync(join(tmpdir(), "v1design-cli-pack-"));
const keep = process.env.V1DESIGN_KEEP_PACK_TEST === "1";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    env: { ...process.env, ...options.env },
    encoding: "utf8",
    stdio: options.stdio || "pipe",
  });
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`);
  }
  return result;
}

try {
  const packed = run("npm", ["pack", "--pack-destination", tmp]);
  const tarball = packed.stdout.trim().split(/\r?\n/).filter(Boolean).pop();
  if (!tarball) throw new Error("npm pack did not print a tarball name");

  const tarballPath = join(tmp, tarball);
  const app = join(tmp, "app");
  run("npm", ["init", "-y"], { cwd: tmp });
  run("npm", ["install", tarballPath], { cwd: tmp });

  const binDir = join(tmp, "node_modules", ".bin");
  run(join(binDir, "v1design"), ["help"], { cwd: tmp, stdio: "ignore" });
  run(join(binDir, "v1design"), ["library", "--help"], { cwd: tmp, stdio: "ignore" });
  run(join(binDir, "v1design"), ["--version"], { cwd: tmp, stdio: "ignore" });
  run(join(binDir, "v1design-agent"), ["help"], { cwd: tmp, stdio: "ignore" });
  run(join(binDir, "v1design-agent"), ["--version"], { cwd: tmp, stdio: "ignore" });

  const skillsTarget = join(app, "skills");
  run(join(binDir, "v1design"), ["skill", "install", "--target", skillsTarget], { cwd: tmp });
  const installedSkill = join(skillsTarget, "v1-design", "SKILL.md");
  if (!existsSync(installedSkill)) throw new Error(`missing installed skill: ${installedSkill}`);

  console.log(`Packed install smoke passed: ${tarball}`);
} finally {
  if (!keep) rmSync(tmp, { recursive: true, force: true });
  else console.log(`Kept packed install temp dir: ${tmp}`);
}
