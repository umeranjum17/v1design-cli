// Studio S3: host client + job loop against a fake S2 engine, kit runs on fakeGateway.
// No engine install, no network beyond localhost, no account.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHostClient } from "../src/cli/host-relay.ts";
import {
  buildKitOptions,
  buildRunSpec,
  createLoopControl,
  describeRunEnd,
  mapKitViewToPost,
  runJobAndSubmit,
  serveJobs,
  signInIfNeeded,
  sleep,
  HOST_MEMBER,
} from "../src/cli/host.mjs";

const KEY = "test-host-key";
const HOST = "host-1";

// ---- fake S2 engine: the exact /host/* contract, single uid ----

function startFakeEngine() {
  let seq = 0;
  const jobs = [];
  const heartbeats = [];
  let startRequested = false;
  const seenAuth = [];
  const send = (res, status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      seenAuth.push(req.headers.authorization ?? null);
      if (req.headers.authorization !== `Bearer ${KEY}`) return send(res, 401, { error: "unauthorized" });
      let b = {};
      try {
        b = raw ? JSON.parse(raw) : {};
      } catch {
        return send(res, 400, { error: "bad_json" });
      }
      const u = new URL(req.url, "http://x");
      if (req.method === "GET" && u.pathname === "/host/jobs") {
        const hostId = u.searchParams.get("hostId") ?? undefined;
        const queued = jobs.filter((j) => j.status === "queued" && (!hostId || !j.hostId || j.hostId === hostId));
        if (!hostId) return send(res, 200, { jobs: queued });
        const flag = startRequested;
        startRequested = false;
        return send(res, 200, { jobs: queued, startRequested: flag });
      }
      const claim = u.pathname.match(/^\/host\/jobs\/([^/]+)\/claim$/);
      if (req.method === "POST" && claim) {
        const job = jobs.find((j) => j.id === claim[1]);
        if (!job) return send(res, 404, { error: "not_found" });
        if (job.status !== "queued" || (job.hostId && job.hostId !== b.hostId)) {
          return send(res, 409, { error: "not_claimable" });
        }
        job.status = "claimed";
        job.claimedBy = b.hostId;
        if (!job.hostId) job.hostId = b.hostId;
        return send(res, 200, { job });
      }
      const result = u.pathname.match(/^\/host\/jobs\/([^/]+)\/result$/);
      if (req.method === "POST" && result) {
        const job = jobs.find((j) => j.id === result[1]);
        if (!job) return send(res, 404, { error: "not_found" });
        if (job.status !== "claimed" || job.claimedBy !== b.hostId) {
          return send(res, 409, { error: "not_submittable" });
        }
        job.status = b.error ? "failed" : "done";
        if (b.error) job.error = b.error;
        else job.result = b.result ?? null;
        return send(res, 200, { job });
      }
      if (req.method === "POST" && u.pathname === "/host/heartbeat") {
        heartbeats.push(b);
        const flag = startRequested;
        startRequested = false;
        return send(res, 200, { ok: true, host: { hostId: b.hostId, lastSeen: Date.now() }, startRequested: flag });
      }
      return send(res, 404, { error: "not_found" });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const url = `http://127.0.0.1:${server.address().port}`;
      resolve({
        url,
        jobs,
        heartbeats,
        seenAuth,
        close: () => server.close(),
        enqueue: (input, hostId) => {
          const job = { id: `job-${++seq}`, uid: "test-uid", status: "queued", input, ...(hostId ? { hostId } : {}) };
          jobs.push(job);
          return job;
        },
        requestStart: () => (startRequested = true),
      });
    });
  });
}

let engine = null;
const clientFor = () => createHostClient({ baseUrl: engine.url, hostKey: KEY, hostId: HOST });

beforeEach(async () => {
  engine = await startFakeEngine();
});

afterEach(async () => {
  engine.close();
  engine = null;
});

// ---- client: poll / claim / result ----

test("host client: poll/claim/result round-trips the S2 contract with the sealed key", async () => {
  const client = clientFor();
  engine.enqueue({ message: "draft a hero", model: "gpt-x" });
  engine.enqueue({ message: "second" }, "other-host");
  const polled = await client.poll();
  assert.ok(polled);
  assert.equal(polled.startRequested, false);
  assert.deepEqual(
    polled.jobs.map((j) => j.input.message),
    ["draft a hero"],
  );
  assert.ok(engine.seenAuth.every((h) => h === `Bearer ${KEY}`));

  const claimed = await client.claim(polled.jobs[0].id);
  assert.equal(claimed?.status, "claimed");
  assert.equal(await client.submit(claimed.id, { result: { screens: 1 } }), true);
  assert.equal(engine.jobs[0].status, "done");
  assert.deepEqual(engine.jobs[0].result, { screens: 1 });

  // A foreign-host job is not claimable for us.
  const foreign = await client.claim(engine.jobs[1].id);
  assert.equal(foreign, null);
});

test("host client: heartbeat carries presence + the SignInView and takes the start flag once", async () => {
  const client = clientFor();
  engine.requestStart();
  const first = await client.heartbeat({ state: "code", via: "code", url: "https://auth.openai.com/x", code: "ABCD-1234" });
  assert.equal(first?.startRequested, true);
  const second = await client.heartbeat({ state: "signed-in", via: "code" });
  assert.equal(second?.startRequested, false);
  assert.equal(engine.heartbeats.length, 2);
  assert.equal(engine.heartbeats[0].signIn.code, "ABCD-1234");
  assert.equal(engine.heartbeats[0].hostId, HOST);
});

test("host client: an unreachable engine reads as null, never throws", async () => {
  const client = createHostClient({ baseUrl: "http://127.0.0.1:9", hostKey: KEY, hostId: HOST, timeoutMs: 500 });
  assert.equal(await client.poll(), null);
  assert.equal(await client.heartbeat({ state: "signed-out" }), null);
  assert.equal(await client.claim("nope"), null);
  assert.equal(await client.submit("nope", { error: "x" }), false);
});

// ---- sign-in: web start honoured only while signed out ----

const stubKit = (o = {}) => {
  const kit = {
    signInCalls: 0,
    signedIn: async () => o.signedIn ?? false,
    providers: async () => (o.signedIn ? ["openai"] : []),
    signIn: (member, _opts, onView) => {
      kit.signInCalls += 1;
      assert.equal(member, HOST_MEMBER);
      onView({ state: "waiting", via: "code", url: "https://auth.openai.com/x", code: "ABCD-1234" });
      return { done: Promise.resolve({ state: "done", via: "code" }) };
    },
    run: o.run ?? (async () => ({ ok: true, text: "stub" })),
  };
  return kit;
};

test("sign-in: web start signs in while signed out without a TTY ask", async () => {
  const client = clientFor();
  engine.requestStart();
  const kit = stubKit({ signedIn: false });
  const ask = () => {
    throw new Error("TTY must not be asked on a web start");
  };
  assert.equal(await signInIfNeeded({ kit, client, ask }), "signed-in");
  assert.equal(kit.signInCalls, 1);
  const states = engine.heartbeats.map((h) => h.signIn?.state);
  assert.ok(states.includes("code"));
  assert.ok(states.includes("signed-in"));
});

test("sign-in: a web start is ignored while already signed in", async () => {
  const client = clientFor();
  engine.requestStart();
  const kit = stubKit({ signedIn: true });
  assert.equal(await signInIfNeeded({ kit, client, ask: async () => true }), "already");
  assert.equal(kit.signInCalls ?? 0, 0);
  assert.deepEqual(
    engine.heartbeats.map((h) => h.signIn?.state),
    ["signed-in"],
  );
});

test("sign-in: TTY consent still gates a plain start", async () => {
  const client = clientFor();
  const kit = stubKit({ signedIn: false });
  assert.equal(await signInIfNeeded({ kit, client, ask: async () => false }), "declined");
  assert.equal(kit.signInCalls ?? 0, 0);
  assert.equal(await signInIfNeeded({ kit, client, ask: async () => true }), "signed-in");
  assert.equal(kit.signInCalls, 1);
});

// ---- job loop ----

test("job loop: claim → kit run with the job model → submit, then drain", async () => {
  const client = clientFor();
  engine.enqueue({ message: "draft a hero", model: "gpt-x" });
  const seen = [];
  const kit = stubKit({
    run: async (spec) => {
      seen.push(spec);
      return { ok: true, text: '{"screens":1}' };
    },
  });
  const ctl = createLoopControl();
  const events = [];
  const done = serveJobs({ kit, client, pollMs: 5, heartbeatMs: 5, ctl, onEvent: (e) => events.push(e) });
  while (!events.some((e) => e.type === "settled")) await sleep(10);
  ctl.draining = true;
  await done;
  assert.equal(seen.length, 1);
  assert.equal(seen[0].member, HOST_MEMBER);
  assert.equal(seen[0].model, "openai/gpt-x"); // bare names mean the member's openai provider
  assert.ok(seen[0].sessionKey.startsWith(`agent:${HOST_MEMBER}:host-job-`));
  assert.equal(engine.jobs[0].status, "done");
  assert.equal(engine.jobs[0].result, '{"screens":1}');
  assert.ok(engine.heartbeats.length >= 1); // presence kept while serving
});

test("job loop: resting/plan-exhausted runs become a typed backoff, never a retry storm", async () => {
  const until = Date.now() + 60_000;
  assert.deepEqual(describeRunEnd({ ok: false, kind: "resting", until, message: "plan resting" }), {
    error: `resting until ${new Date(until).toISOString()}: plan resting`,
    restUntil: until,
  });
  assert.match(describeRunEnd({ ok: false, kind: "plan", message: "empty" }).error, /^resting: /);

  const client = clientFor();
  engine.enqueue({ message: "one" });
  engine.enqueue({ message: "two" });
  let claims = 0;
  const kit = stubKit({ run: async () => ({ ok: false, kind: "resting", until, message: "plan resting" }) });
  const ctl = createLoopControl();
  const counting = {
    ...client,
    claim: async (id) => {
      claims += 1;
      return client.claim(id);
    },
  };
  const events = [];
  const done = serveJobs({ kit, client: counting, pollMs: 5, heartbeatMs: 10_000, ctl, onEvent: (e) => events.push(e) });
  while (!events.some((e) => e.type === "settled")) await sleep(10);
  await sleep(30); // backing off: polls continue, claims must not
  ctl.draining = true;
  await done;
  assert.equal(claims, 1);
  assert.equal(ctl.restUntil, until);
  assert.match(engine.jobs[0].error, /^resting until .*plan resting/);
  assert.equal(engine.jobs[1].status, "queued"); // untouched during backoff
});

test("job loop: drain finishes the in-flight job before stopping", async () => {
  const client = clientFor();
  engine.enqueue({ message: "slow job" });
  let release;
  const gate = new Promise((r) => (release = r));
  const kit = stubKit({ run: () => gate.then(() => ({ ok: true, text: "late" })) });
  const ctl = createLoopControl();
  const done = serveJobs({ kit, client, pollMs: 5, heartbeatMs: 10_000, ctl });
  while (engine.jobs[0].status !== "claimed") await sleep(10);
  ctl.draining = true; // SIGINT equivalent
  await sleep(20);
  assert.equal(engine.jobs[0].status, "claimed"); // still in flight, not abandoned
  release();
  await done;
  assert.equal(engine.jobs[0].status, "done");
  assert.equal(engine.jobs[0].result, "late");
});

test("job loop: schema jobs submit parsed JSON; the kit's failure kinds stay typed", async () => {
  const job = { id: "job-9", input: { message: "x", schema: { type: "object" } } };
  const built = buildRunSpec(job);
  assert.equal(built.wantJson, true);
  assert.match(built.spec.system, /Respond with JSON only/);

  const submitted = [];
  const client = { submit: async (id, body) => void submitted.push([id, body]) };
  await runJobAndSubmit({ kit: stubKit({ run: async () => ({ ok: true, text: '{"a":1}' }) }), client, job });
  assert.deepEqual(submitted, [["job-9", { result: { a: 1 } }]]);
  await runJobAndSubmit({ kit: stubKit({ run: async () => ({ ok: true, text: "not json" }) }), client, job });
  assert.match(submitted[1][1].error, /^invalid-result/);
  await runJobAndSubmit({
    kit: stubKit({ run: async () => ({ ok: false, kind: "network", message: "down" }) }),
    client,
    job: { id: "job-10", input: { message: "y" } },
  });
  assert.deepEqual(submitted[2], ["job-10", { error: "network: down" }]);
  await runJobAndSubmit({ kit: stubKit(), client, job: { id: "job-11", input: {} } });
  assert.match(submitted[3][1].error, /^invalid-input/);
});

// ---- kit views and real kit.run on the fake gateway ----

test("host: kit views map to the engine heartbeat states", () => {
  assert.deepEqual(mapKitViewToPost(null), { state: "signed-out" });
  assert.deepEqual(mapKitViewToPost({ state: "failed", via: "code", why: "expired" }), { state: "signed-out" });
  assert.deepEqual(
    mapKitViewToPost({ state: "waiting", via: "code", url: "https://auth.openai.com/x", code: "AB-12" }),
    { state: "code", via: "code", url: "https://auth.openai.com/x", code: "AB-12" },
  );
  assert.deepEqual(mapKitViewToPost({ state: "done", via: "code" }), { state: "signed-in", via: "code" });
});

test("host: a real kit run on the fake gateway submits its text", async () => {
  const { OpenClawKit } = await import("@byokit/openclaw");
  const { fakeGateway } = await import("@byokit/openclaw/testing");
  const stateDir = mkdtempSync(join(tmpdir(), "v1host-loop-"));
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
    const submitted = [];
    const outcome = await runJobAndSubmit({
      kit,
      client: { submit: async (id, body) => void submitted.push([id, body]) },
      job: { id: "job-k", input: { message: "draft a hero" } },
    });
    assert.match(outcome.result, /draft a hero/);
    assert.equal(submitted.length, 1);
  } finally {
    await kit.stop();
  }
});
