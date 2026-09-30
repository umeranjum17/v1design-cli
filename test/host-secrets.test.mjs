// host-key.json goes through BYOKit (@byokit/secrets), never plaintext.
// Fake backends only — never the owner's keyring.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  hostMasterKey,
  loadSeal,
  readHostKey,
  writeHostKey,
} from "../src/cli/host-secrets.mjs";

function fakeKeyring() {
  const mem = new Map();
  return {
    get: (n) => (mem.has(n) ? mem.get(n) : null),
    set: (n, v) => void mem.set(n, v),
    delete: (n) => mem.delete(n),
  };
}

function freshHome() {
  return mkdtempSync(join(tmpdir(), "v1seal-test-"));
}

test("secrets: os-keyring seal round-trips and the file holds no plaintext", async () => {
  const home = freshHome();
  const keyring = fakeKeyring();
  await writeHostKey("host-secret-abc", { home, keyring });
  assert.equal(await readHostKey({ home, keyring }), "host-secret-abc");
  const raw = await readFile(join(home, ".v1design", "host-key.json"), "utf8");
  assert.doesNotMatch(raw, /host-secret-abc/);
  assert.match(raw, /"via":"os-keyring"/);
});

test("secrets: host-key seal round-trips where there is no keyring", async () => {
  const home = freshHome();
  const failing = {
    get: () => {
      throw Object.assign(new Error("no secret service"), { code: "unavailable" });
    },
    set: () => {
      throw Object.assign(new Error("no secret service"), { code: "unavailable" });
    },
    delete: () => false,
  };
  const { via } = await loadSeal({ home, keyring: failing });
  assert.equal(via, "host-key");
  await writeHostKey("host-secret-xyz", { home, keyring: failing });
  assert.equal(await readHostKey({ home, keyring: failing }), "host-secret-xyz");
  const raw = await readFile(join(home, ".v1design", "host-key.json"), "utf8");
  assert.doesNotMatch(raw, /host-secret-xyz/);
  assert.match(raw, /"via":"host-key"/);
  const master = await readFile(join(home, ".v1design", "host-master.key"));
  assert.equal(master.length, 32);
  assert.equal((await stat(join(home, ".v1design", "host-master.key"))).mode & 0o777, 0o600);
});

test("secrets: a wrong seal fails closed, and absent means empty", async () => {
  const home = freshHome();
  await writeHostKey("host-secret-1", { home, keyring: fakeKeyring(), mode: "host-key" });
  // Same home opens fine; a copied file under a fresh master key must not.
  assert.equal(await readHostKey({ home, mode: "host-key" }), "host-secret-1");
  const other = freshHome();
  const { mkdir, copyFile } = await import("node:fs/promises");
  await mkdir(join(other, ".v1design"), { recursive: true });
  await copyFile(join(home, ".v1design", "host-key.json"), join(other, ".v1design", "host-key.json"));
  await assert.rejects(readHostKey({ home: other, mode: "host-key" }), (e) => e?.code === "auth-failed");
  assert.equal(await readHostKey({ home: freshHome(), keyring: fakeKeyring() }), "");
});

test("secrets: master key is stable and the dir is 0700", async () => {
  const home = freshHome();
  const a = await hostMasterKey(home);
  const b = await hostMasterKey(home);
  assert.deepEqual(Buffer.from(a), Buffer.from(b));
  assert.equal((await stat(join(home, ".v1design"))).mode & 0o777, 0o700);
});
