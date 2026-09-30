/**
 * CLI device-flow start: login() registers {session, user_code} at
 * POST /auth/device/start before opening the browser, retries a 409
 * collision once with a fresh session, and surfaces 400/429 clearly.
 * Run with: npx tsx --test src/cli/__tests__/auth-device-start.test.ts
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

// Isolate credentials + browser before importing auth (CONFIG_PATH binds homedir() at import).
const TMP = await fs.mkdtemp(path.join(os.tmpdir(), "cli-auth-test-"));
process.env.HOME = TMP;
process.env.V1_DESIGN_API_URL = "https://engine.test";
process.env.V1_DESIGN_WEB_URL = "https://web.test";
delete process.env.V1_DESIGN_LOOPBACK;
await fs.mkdir(path.join(TMP, "bin"), { recursive: true });
await fs.writeFile(path.join(TMP, "bin", "xdg-open"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
process.env.PATH = `${path.join(TMP, "bin")}${path.delimiter}${process.env.PATH}`;

const auth = await import("../auth.ts");

const USER_CODE_RE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

type Route = { status: number; body: unknown };
let routes: Record<string, Route[]>;
let requests: { url: string; body: any }[];
let errLines: string[];
const origError = console.error;

beforeEach(() => {
  routes = {};
  requests = [];
  errLines = [];
  console.error = (...args: unknown[]) => { errLines.push(args.map(String).join(" ")); };
  globalThis.fetch = (async (url: string, init: any) => {
    const u = new URL(String(url));
    const q = routes[u.pathname] ?? [];
    const r = q.length > 1 ? q.shift()! : (q[0] ?? { status: 404, body: {} });
    requests.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
});

afterEach(() => {
  console.error = origError;
});

const startCalls = () => requests.filter((r) => r.url.endsWith("/auth/device/start"));
const printedCode = () => errLines.find((l) => l.includes("Verification code:")) ?? "";
const authorizeUrl = () => errLines.find((l) => l.startsWith("https://web.test/authorize")) ?? "";

function happyPollAndExchange() {
  routes["/auth/device/poll"] = [{ status: 200, body: { code: "v1ac_testcode" } }];
  routes["/auth/exchange"] = [{ status: 200, body: { key: "test-key" } }];
}

test("registers session + user code, prints it, and omits it from the authorize URL", async () => {
  routes["/auth/device/start"] = [{ status: 201, body: { status: "pending", expiresIn: 300 } }];
  happyPollAndExchange();
  await auth.login();
  const [first] = startCalls();
  assert.equal(startCalls().length, 1);
  assert.match(first.body.session, /^[A-Za-z0-9_-]{32,}$/);
  assert.match(first.body.user_code, USER_CODE_RE);
  assert.ok(printedCode().includes(first.body.user_code), "terminal shows the registered code");
  assert.ok(authorizeUrl().includes(`session=${encodeURIComponent(first.body.session)}`));
  assert.ok(!authorizeUrl().includes("user_code"), "code must not travel in the URL");
  const saved = JSON.parse(await fs.readFile(path.join(TMP, ".v1design", "credentials.json"), "utf8"));
  assert.equal(saved.key, "test-key");
});

test("a 409 collision retries once with a fresh session", async () => {
  routes["/auth/device/start"] = [
    { status: 409, body: { error: "session_exists" } },
    { status: 201, body: { status: "pending", expiresIn: 300 } },
  ];
  happyPollAndExchange();
  await auth.login();
  const calls = startCalls();
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0].body.session, calls[1].body.session);
  assert.equal(calls[0].body.user_code, calls[1].body.user_code);
});

test("two 409s fail with the server error", async () => {
  routes["/auth/device/start"] = [
    { status: 409, body: { error: "session_exists" } },
    { status: 409, body: { error: "session_exists" } },
  ];
  await assert.rejects(auth.login(), /session_exists/);
  assert.equal(startCalls().length, 2, "retries exactly once");
});

test("429 surfaces a rate-limit message", async () => {
  routes["/auth/device/start"] = [{ status: 429, body: { error: "rate_limited" } }];
  await assert.rejects(auth.login(), /rate-limited/);
});

test("400 surfaces the server error", async () => {
  routes["/auth/device/start"] = [{ status: 400, body: { error: "invalid_user_code" } }];
  await assert.rejects(auth.login(), /invalid_user_code/);
});
