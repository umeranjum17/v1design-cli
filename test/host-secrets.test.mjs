// host-key.json goes through BYOKit (@byokit/secrets), never plaintext.
// The kit auto-selects the OS keyring or its owner-only host-key file.
// Fake backends and isolated state dirs only — never the owner's keyring.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSeal, readHostKey, writeHostKey } from "../src/cli/host-secrets.mjs";

function fakeKeyring() {
  const mem = new Map();
  return {
    get: (n) => (mem.has(n) ? mem.get(n) : null),
    set: (n, v) => void mem.set(n, v),
    delete: (n) => mem.delete(n),
  };
}

function freshHome() {
  const home = mkdtempSync(join(tmpdir(), "v1seal-test-"));
  return { home, stateDir: join(home, ".local", "state") };
}

test("secrets: os-keyring seal round-trips and the file holds no plaintext", async () => {
  const { home, stateDir } = freshHome();
  const keyring = fakeKeyring();
  await writeHostKey("host-secret-abc", { home, keyring, stateDir });
  assert.equal(await readHostKey({ home, keyring, stateDir }), "host-secret-abc");
  const raw = await readFile(join(home, ".v1design", "host-key.json"), "utf8");
  assert.doesNotMatch(raw, /host-secret-abc/);
  assert.match(raw, /"via":"keyring"/);
});

test("secrets: kit file seal round-trips where there is no keyring", async () => {
  const { home, stateDir } = freshHome();
  const failing = {
    get: () => {
      throw Object.assign(new Error("no secret service"), { code: "unavailable" });
    },
    set: () => {
      throw Object.assign(new Error("no secret service"), { code: "unavailable" });
    },
    delete: () => false,
  };
  const { via } = await loadSeal({ home, keyring: failing, stateDir });
  assert.equal(via, "host-key-file");
  await writeHostKey("host-secret-xyz", { home, keyring: failing, stateDir });
  assert.equal(await readHostKey({ home, keyring: failing, stateDir }), "host-secret-xyz");
  const raw = await readFile(join(home, ".v1design", "host-key.json"), "utf8");
  assert.doesNotMatch(raw, /host-secret-xyz/);
  assert.match(raw, /"via":"host-key-file"/);
});

test("secrets: a wrong seal fails closed, and absent means empty", async () => {
  const { home, stateDir } = freshHome();
  await writeHostKey("host-secret-1", { home, keyring: fakeKeyring(), stateDir, mode: "host-key" });
  // Same home opens fine; a copied file under a fresh key root must not.
  assert.equal(await readHostKey({ home, stateDir, mode: "host-key" }), "host-secret-1");
  const other = freshHome();
  const { mkdir, copyFile } = await import("node:fs/promises");
  await mkdir(join(other.home, ".v1design"), { recursive: true });
  await copyFile(join(home, ".v1design", "host-key.json"), join(other.home, ".v1design", "host-key.json"));
  await assert.rejects(
    readHostKey({ home: other.home, stateDir: other.stateDir, mode: "host-key" }),
    // Fails closed: auth-failed on tamper, unavailable with no key to try.
    (e) => e?.code === "auth-failed" || e?.code === "unavailable",
  );
  const empty = freshHome();
  assert.equal(
    await readHostKey({ home: empty.home, keyring: fakeKeyring(), stateDir: empty.stateDir }),
    "",
  );
});

test("secrets: the store dir is 0700", async () => {
  const { home, stateDir } = freshHome();
  await writeHostKey("host-secret-2", { home, keyring: fakeKeyring(), stateDir });
  assert.equal((await stat(join(home, ".v1design"))).mode & 0o777, 0o700);
});
