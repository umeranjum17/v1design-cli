// v1design host — the member-computer carrier for the ChatGPT-plan lane (Studio S3).
//
// Strictly additive: nothing here touches library, auth, billing or credits.
// The host runs the pinned OpenClaw engine on the member's own computer via
// @byokit/openclaw only — every AI/account/pairing path goes through the kit.
//
// Layout: engine install lives in ~/.v1design/host/ (lazy: the kit's prepare()
// installs it on first run, never at CLI install time). Engine *state* lives
// in the short ~/.v1design/h so the bridge socket path stays under the
// unix-domain limit (A21 guard below).
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import { OpenClawKit } from "@byokit/openclaw";
import { createHostClient } from "./host-relay.ts";
import { readHostKey } from "./host-secrets.mjs";

export const HOST_MEMBER = "me";
export const HOST_AUTH_CHOICE = "openai-device-code";
export const HOST_PROVIDER = "openai";

/** Kit engine requirement (pinned OpenClaw engine): keep in sync with the kit. */
export const HOST_NODE_REQUIREMENT = ">=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0";

export const hostRoot = (home = homedir()) => join(home, ".v1design", "host");
export const hostStateDir = (home = homedir()) =>
  process.env.V1DESIGN_STATE_DIR || join(home, ".v1design", "h");
export const hostIdPath = (home = homedir()) => join(home, ".v1design", "host-id");

/** Unix-domain socket ceiling is 108 chars; refuse well before it (BYOKit A21). */
export const MAX_SOCK_PATH = 100;
export const socketPathFor = (stateDir) => join(stateDir, "openclaw", "bridge.sock");

export function guardSocketPath(stateDir) {
  const sock = socketPathFor(stateDir);
  if (sock.length > MAX_SOCK_PATH) {
    throw new Error(
      `host state path too long for the engine socket (${sock.length} > ${MAX_SOCK_PATH} chars). ` +
        `Set V1DESIGN_STATE_DIR to a short path (e.g. /tmp/v1h).`,
    );
  }
  return sock;
}

export function nodeSatisfies(version = process.versions.node) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  if (major === 22) return minor > 22 || (minor === 22 && Number(m[3]) >= 3);
  if (major === 24) return minor >= 15;
  return major > 25 || (major === 25 && minor >= 9);
}

export function checkNodeVersion(version = process.versions.node) {
  if (!nodeSatisfies(version)) {
    throw new Error(
      `v1design host needs Node ${HOST_NODE_REQUIREMENT} (running ${version}). ` +
        `Use the same Node the kit engine requires.`,
    );
  }
}

/** Credentials dir and files: 0700 / 0600 (the folder now holds a host key). */
export async function ensureSecureDir(dir) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
}

async function readSecureJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function writeSecureJson(path, value) {
  await ensureSecureDir(dirname(path));
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await chmod(path, 0o600);
}

export async function hostId(home = homedir()) {
  const path = hostIdPath(home);
  const existing = await readSecureJson(path);
  if (existing?.id) return existing.id;
  const id = randomBytes(16).toString("hex");
  await writeSecureJson(path, { id });
  return id;
}

export function buildKitOptions(o) {
  return {
    stateDir: o.stateDir,
    engineDir: o.engineDir,
    // BYOKit bug (@byokit/openclaw 0.3.2; fixed in 0.3.3): the kit writes openclaw.json
    // plugins.allow = ["byokit"], which blocks OpenClaw's "openai" provider
    // plugin, so ChatGPT device pairing fails "blocked by allowlist". The kit
    // deep-merges KitOptions.config, so this merges to ["openai", "byokit"].
    // Handle only through the kit's own options — never patch kit code.
    config: { plugins: { allow: ["openai"] } },
    tools: [],
    // Deny-all gate: the host runs no tools and no engine builtins.
    host: {
      gate: async () => ({ allow: false, reason: "v1design host runs no tools" }),
      call: async () => {
        throw new Error("v1design host runs no tools");
      },
    },
  };
}

export function signinFailureMessage(view) {
  if (view.why === "expired") {
    // BYOKit bug (@byokit/openclaw 0.3.0): sign-in fails if the member takes
    // longer than 120 s to approve the device code (hardcoded wizard pull
    // timeout). Surface it as expirable and let the member retry.
    return "Code expired — approval took too long. Run `v1design host` again for a fresh code.";
  }
  if (view.why === "declined") return "Sign-in cancelled.";
  if (view.why === "busy") return "Another sign-in is already in progress. Wait for it or run again.";
  return view.error ? `ChatGPT sign-in failed: ${view.error}` : "ChatGPT sign-in failed. Run again.";
}

function askYesNo(question) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

const CONSENT_WORDS =
  "v1design host uses your own ChatGPT plan on this computer. " +
  "Generations run here; v1 never sees your ChatGPT login.";

async function showView(view) {
  if (view.url) {
    let host = "";
    try {
      host = new URL(view.url).hostname;
    } catch {
      host = "";
    }
    if (host !== "auth.openai.com") {
      console.error("Ignoring sign-in URL outside auth.openai.com.");
      return;
    }
  }
  if (view.code) console.error(`\n  Device code:  ${view.code}`);
  if (view.url) console.error(`  Approve at:   ${view.url}\n`);
}

/**
 * Map a kit SignInView to the engine heartbeat post. The engine keeps only
 * three states: "code" (code viewable by the owning uid, expiring),
 * "signed-in", and anything else as signed-out.
 */
export function mapKitViewToPost(view) {
  if (!view || typeof view !== "object") return { state: "signed-out" };
  if (view.state === "done") return { state: "signed-in", ...(view.via ? { via: view.via } : {}) };
  if (view.state === "waiting" && typeof view.code === "string" && view.code.trim()) {
    return {
      state: "code",
      ...(view.via ? { via: view.via } : {}),
      ...(view.url ? { url: view.url } : {}),
      code: view.code,
    };
  }
  return { state: "signed-out" };
}

/**
 * Build the kit RunSpec for a host job (member "me", the job's model).
 * Returns null when the job carries no message. When the job carries a
 * schema, the model is instructed to answer in JSON and the text is parsed
 * before submit (wantJson).
 */
export function buildRunSpec(job) {
  const input = job?.input && typeof job.input === "object" ? job.input : null;
  const message =
    (typeof input?.message === "string" && input.message) ||
    (typeof input?.prompt === "string" && input.prompt) ||
    (typeof input?.text === "string" && input.text) ||
    "";
  if (!message.trim()) return null;
  // The kit refuses any sessionKey outside agent:<member>:* and any model
  // outside provider/model. This host is the ChatGPT-plan lane, so a bare
  // model name means the member's own openai provider.
  const spec = { sessionKey: `agent:${HOST_MEMBER}:host-${job.id}`, member: HOST_MEMBER, message };
  if (typeof input.model === "string" && input.model) {
    spec.model = input.model.includes("/") ? input.model : `openai/${input.model}`;
  }
  const parts = [];
  if (typeof input.system === "string" && input.system) parts.push(input.system);
  const wantJson = input.schema !== undefined;
  if (wantJson) parts.push(`Respond with JSON only, matching this schema: ${JSON.stringify(input.schema)}`);
  if (parts.length) spec.system = parts.join("\n\n");
  return { spec, wantJson };
}

/**
 * Typed failure for a kit RunEnd. Resting / plan-exhausted runs become a
 * "resting until" failure with a backoff timestamp — never a retry storm.
 */
export function describeRunEnd(end) {
  if (!end || typeof end !== "object") return { error: "failed: empty run end" };
  if (end.ok) return { error: "" };
  if (end.aborted) return { error: "aborted: host stopped" };
  const kind = end.kind ?? "other";
  const message = end.message || kind;
  if ((kind === "resting" || kind === "plan") && typeof end.until === "number") {
    return { error: `resting until ${new Date(end.until).toISOString()}: ${message}`, restUntil: end.until };
  }
  if (kind === "resting" || kind === "plan") return { error: `resting: ${message}` };
  return { error: `${kind}: ${message}` };
}

/** Claim one job, run it through the kit, submit the result or a typed failure. */
export async function runJobAndSubmit({ kit, client, job }) {
  const built = buildRunSpec(job);
  if (!built) {
    const error = "invalid-input: job carries no message";
    await client.submit(job.id, { error });
    return { error };
  }
  let end;
  try {
    end = await kit.run(built.spec);
  } catch (e) {
    const error = `failed: ${e?.message || String(e)}`;
    await client.submit(job.id, { error });
    return { error };
  }
  if (end.ok) {
    if (built.wantJson) {
      try {
        const result = JSON.parse(end.text);
        await client.submit(job.id, { result });
        return { result };
      } catch {
        const error = "invalid-result: model did not return JSON";
        await client.submit(job.id, { error });
        return { error };
      }
    }
    await client.submit(job.id, { result: end.text });
    return { result: end.text };
  }
  const { error, restUntil } = describeRunEnd(end);
  await client.submit(job.id, { error });
  return { error, restUntil };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const createLoopControl = () => ({ draining: false, restUntil: 0 });

/**
 * The job loop: heartbeat presence + the current SignInView, poll, claim one
 * job, run it, submit. While backing off (restUntil) the host still
 * heartbeats but claims nothing. SIGINT drains: the loop stops polling and
 * returns only after the in-flight job is submitted.
 */
export async function serveJobs({
  kit,
  client,
  pollMs = 5000,
  heartbeatMs = 30000,
  ctl = createLoopControl(),
  onEvent = () => {},
}) {
  let lastBeat = 0;
  while (!ctl.draining) {
    const now = Date.now();
    if (now - lastBeat >= heartbeatMs) {
      lastBeat = now;
      // Signed in here by construction; the start-request flag is honoured
      // only while signed out, so the loop ignores it.
      await client.heartbeat({ state: "signed-in", via: "code" });
    }
    if (Date.now() < ctl.restUntil) {
      await sleep(pollMs);
      continue;
    }
    const polled = await client.poll();
    if (!polled || ctl.draining) {
      if (!ctl.draining) await sleep(pollMs);
      continue;
    }
    const job = polled.jobs[0];
    if (!job) {
      await sleep(pollMs);
      continue;
    }
    const claimed = await client.claim(job.id);
    if (!claimed) continue; // lost the race; poll again immediately
    onEvent({ type: "claimed", job: claimed });
    const outcome = await runJobAndSubmit({ kit, client, job: claimed });
    if (outcome.restUntil) ctl.restUntil = outcome.restUntil;
    onEvent({ type: "settled", job: claimed, ...outcome });
  }
}

async function withKit(fn) {
  checkNodeVersion();
  const kit = new OpenClawKit(
    buildKitOptions({ stateDir: hostStateDir(), engineDir: hostRoot() }),
  );
  guardSocketPath(hostStateDir());
  await kit.prepare();
  await kit.start();
  try {
    await kit.ensureMember(HOST_MEMBER);
    return await fn(kit);
  } finally {
    await kit.stop();
  }
}

export async function hostStatus() {
  return withKit(async (kit) => {
    const providers = await kit.providers(HOST_MEMBER);
    console.log(
      providers.includes(HOST_PROVIDER)
        ? `Host ready: ${HOST_MEMBER} signed in (ChatGPT plan).`
        : "Host ready: not signed in. Run: v1design host",
    );
  });
}

export async function hostSignout() {
  return withKit(async (kit) => {
    await kit.signOut(HOST_MEMBER, HOST_PROVIDER);
    console.log("Host signed out of the ChatGPT plan.");
  });
}

/**
 * Sign in when needed. Returns "already" (signed in, start flag ignored),
 * "signed-in", or "declined". A web start-request is honoured only while
 * signed out and implies the owner consented on the web (TTY ask skipped).
 */
export async function signInIfNeeded({ kit, client, ask = askYesNo }) {
  if (await kit.signedIn(HOST_MEMBER, HOST_PROVIDER)) {
    await client.heartbeat({ state: "signed-in", via: "code" });
    return "already";
  }
  const polled = await client.poll();
  const webStart = polled?.startRequested === true;
  if (!webStart && !(await ask(CONSENT_WORDS))) return "declined";
  if (webStart) console.error("Web sign-in requested — continuing.");
  const signin = kit.signIn(
    HOST_MEMBER,
    { authChoice: HOST_AUTH_CHOICE },
    (view) => {
      void showView(view);
      void client.heartbeat(mapKitViewToPost(view));
    },
  );
  const done = await signin.done;
  if (done.state !== "done") throw new Error(signinFailureMessage(done));
  await client.heartbeat(mapKitViewToPost(done));
  return "signed-in";
}

export async function hostRun(client = null) {
  checkNodeVersion();
  const stateDir = hostStateDir();
  guardSocketPath(stateDir);
  await ensureSecureDir(join(homedir(), ".v1design"));
  const id = await hostId();
  const hostKey = await readHostKey(); // sealed via BYOKit; "" until S2 provisions one
  client ??= createHostClient({ hostKey, hostId: id });
  client.setHostKey(hostKey);
  client.setHostId(id);
  const kit = new OpenClawKit(buildKitOptions({ stateDir, engineDir: hostRoot() }));
  const ctl = createLoopControl();
  const onSigint = () => {
    if (ctl.draining) {
      console.error("\nForcing shutdown…");
      process.exit(130);
      return;
    }
    // Drain: stop polling; the in-flight job is submitted before exit.
    ctl.draining = true;
    console.error("\nShutting down the host… (in-flight job drains first)");
  };
  process.once("SIGINT", onSigint);
  await kit.prepare();
  await kit.start();
  try {
    await kit.ensureMember(HOST_MEMBER);
    const signinState = await signInIfNeeded({ kit, client });
    if (signinState === "declined") {
      console.error("Consent declined. Run `v1design host` again to continue.");
      return;
    }
    if (signinState === "signed-in") {
      const providers = await kit.providers(HOST_MEMBER);
      console.error(`Signed in (ChatGPT plan): ${providers.join(", ") || HOST_PROVIDER}.`);
    } else {
      console.error("Already signed in (ChatGPT plan).");
    }
    console.error("Host online. Press Ctrl-C to stop.");
    await serveJobs({ kit, client, ctl });
  } finally {
    process.removeListener("SIGINT", onSigint);
    await kit.stop();
  }
}

export async function hostCommand(sub, flags = {}) {
  if (sub === "status" || flags.status) return hostStatus();
  if (sub === "signout" || sub === "logout" || flags.signout) return hostSignout();
  if (sub === "help" || sub === "--help" || sub === "-h" || flags.help) {
    console.log(`v1design host

Run the member-computer carrier for the ChatGPT-plan lane (Studio, additive):

  v1design host            Sign in with your ChatGPT plan and stay online
  v1design host status     Show whether this computer is signed in
  v1design host signout    Sign out of the ChatGPT plan on this computer

Needs Node ${HOST_NODE_REQUIREMENT}. macOS/Linux only.`);
    return;
  }
  if (sub) throw new Error(`unknown host subcommand: ${sub} (see: v1design host help)`);
  return hostRun();
}
