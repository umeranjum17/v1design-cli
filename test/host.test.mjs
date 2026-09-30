// Studio S3: v1design host carrier on @byokit/openclaw 0.3.0.
// Pure checks plus fakeGateway integration: no engine install, no network, no account.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HOST_AUTH_CHOICE,
  HOST_MEMBER,
  buildKitOptions,
  checkNodeVersion,
  guardSocketPath,
  nodeSatisfies,
  signinFailureMessage,
  socketPathFor,
} from "../src/cli/host.mjs";
import { createHostClient } from "../src/cli/host-relay.ts";

test("host: node check accepts the kit engine range and rejects the rest", () => {
  for (const v of ["22.22.3", "22.30.0", "24.15.0", "24.20.1", "25.9.0", "25.10.2", "26.0.0"]) {
    assert.equal(nodeSatisfies(v), true, v);
    checkNodeVersion(v);
  }
  for (const v of ["20.19.0", "22.22.2", "22.0.0", "23.11.0", "24.14.9", "25.8.9", "18.20.4"]) {
    assert.equal(nodeSatisfies(v), false, v);
    assert.throws(() => checkNodeVersion(v), /needs Node/);
  }
});

test("host: short stateDir passes the socket guard, long ones fail fast", () => {
  const sock = guardSocketPath(join(tmpdir(), "v1h"));
  assert.equal(sock, socketPathFor(join(tmpdir(), "v1h")));
  assert.throws(
    () => guardSocketPath(join(tmpdir(), "x".repeat(120))),
    /too long for the engine socket/,
  );
});

test("host: kit options carry the openai allowlist fix and a deny-all gate", async () => {
  const o = buildKitOptions({ stateDir: "/tmp/v1h", engineDir: "/tmp/v1host" });
  assert.deepEqual(o.config, { plugins: { allow: ["openai"] } });
  assert.deepEqual(o.tools, []);
  const gate = await o.host.gate({}, "exec", {}, { builtin: true });
  assert.equal(gate.allow, false);
  await assert.rejects(o.host.call({}, "exec", {}, new AbortController().signal), /runs no tools/);
});

test("host: sign-in choice is the ChatGPT device-code route for member me", () => {
  assert.equal(HOST_MEMBER, "me");
  assert.equal(HOST_AUTH_CHOICE, "openai-device-code");
});

test("host: an expired device code reads as expirable with a retry", () => {
  assert.match(
    signinFailureMessage({ state: "failed", via: "code", why: "expired" }),
    /code expired/i,
  );
  assert.match(
    signinFailureMessage({ state: "failed", via: "code", why: "expired" }),
    /run `v1design host` again/i,
  );
  assert.match(signinFailureMessage({ state: "failed", via: "code", why: "declined" }), /cancelled/i);
});

test("host: the S2 client is offline-tolerant when the engine is unreachable", async () => {
  const client = createHostClient({ baseUrl: "http://127.0.0.1:9", hostKey: "k", hostId: "h", timeoutMs: 500 });
  assert.equal(await client.poll(), null);
  assert.equal(await client.heartbeat({ state: "signed-out" }), null);
  assert.equal(await client.claim("nope"), null);
  assert.equal(await client.submit("nope", { error: "x" }), false);
});

test("host: kit starts on the fake gateway with member me signed out", async () => {
  const { OpenClawKit } = await import("@byokit/openclaw");
  const { fakeGateway } = await import("@byokit/openclaw/testing");
  const stateDir = mkdtempSync(join(tmpdir(), "v1host-test-"));
  const fake = fakeGateway();
  const kit = new OpenClawKit({
    ...buildKitOptions({ stateDir, engineDir: join(stateDir, "engine") }),
    transport: fake.factory,
    spawnEngine: false,
  });
  await kit.prepare();
  await kit.start();
  try {
    await kit.ensureMember(HOST_MEMBER);
    assert.deepEqual(await kit.providers(HOST_MEMBER), []);
    assert.equal(await kit.signedIn(HOST_MEMBER, "openai"), false);
    assert.deepEqual(kit.toolNames(), []);
  } finally {
    await kit.stop();
  }
});
