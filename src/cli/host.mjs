// v1design host — the member-computer carrier for the plan lanes (Studio S3).
//
// Strictly additive: nothing here touches library, auth, billing or credits.
// The host runs the pinned OpenClaw engine on the member's own computer via
// @byokit/openclaw only — every AI/account/pairing path goes through the kit.
// Default lane is the member's ChatGPT plan; `--lane claude` runs the same
// job loop on the member's Claude Pro/Max via the kit's native Claude Code
// subscription route (subscription billing, never an API key).
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
import { OpenClawKit, words } from "@byokit/openclaw";
import { createHostClient, mintHostKey } from "./host-relay.ts";
import { readHostKey, writeHostKey } from "./host-secrets.mjs";
import { readCredentials, DEFAULT_API_URL } from "./auth.ts";

export const HOST_MEMBER = "me";
export const HOST_AUTH_CHOICE = "openai-device-code";
export const HOST_PROVIDER = "openai";

/** Claude-plan lane (additive, behind `--lane claude`): the member's own
 *  Claude Pro/Max via the kit's native Claude Code subscription route. */
export const HOST_CLAUDE_AUTH_CHOICE = "anthropic-cli";
export const HOST_CLAUDE_PROVIDER = "claude-cli";

export const HOST_LANES = {
  chatgpt: {
    authChoice: HOST_AUTH_CHOICE,
    provider: HOST_PROVIDER,
    modelPrefix: "openai/",
    heartbeatVia: "code",
    label: "ChatGPT plan",
  },
  claude: {
    authChoice: HOST_CLAUDE_AUTH_CHOICE,
    provider: HOST_CLAUDE_PROVIDER,
    modelPrefix: "claude-cli/",
    heartbeatVia: "browser",
    label: "Claude plan",
  },
};

export const laneConfig = (lane) => HOST_LANES[lane] ?? HOST_LANES.chatgpt;
export const laneOf = (flags = {}) => (flags.lane === "claude" ? "claude" : "chatgpt");

/** Engine lane names on the wire: the CLI flag says `claude`, the wire says `claude-plan` (X3). */
export const engineLaneOf = (lane) => (lane === "claude" ? "claude-plan" : "chatgpt");

/** Wire marker for "my plan is resting": mirrors the engine's host-job-contract (X1). */
export const HOST_RESTING_PREFIX = "resting_until:";
export const restingError = (untilMs) => `${HOST_RESTING_PREFIX}${untilMs}`;
export function parseRestingUntil(error) {
  if (typeof error !== "string" || !error.startsWith(HOST_RESTING_PREFIX)) return null;
  const until = Number(error.slice(HOST_RESTING_PREFIX.length));
  return Number.isFinite(until) ? until : null;
}

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

/**
 * The host key for this hostId, sealed via BYOKit (X3). Returns the stored
 * key when present; otherwise mints one from the engine's POST /host/keys
 * with the owner's user credential and seals it. Returns "" when there is
 * no credential or the engine refuses — the host keeps working TTY-only.
 * The key is never logged.
 */
export async function ensureHostKey({
  id = null,
  home = homedir(),
  sealOptions = {},
  readConnection = readCredentials,
  mintKey = mintHostKey,
} = {}) {
  const connection = await readConnection();
  if (!connection?.key) return "";
  const hostIdValue = id ?? (await hostId(home));
  const baseUrl = (process.env.V1_DESIGN_API_URL || connection.apiUrl || DEFAULT_API_URL).replace(/\/$/, "");
  const binding = JSON.stringify([baseUrl, connection.key, connection.authorizedAt ?? null, hostIdValue]);
  const storage = { ...sealOptions, home, binding };
  const existing = await readHostKey(storage);
  if (existing) return existing;
  const raw = await mintKey(hostIdValue, connection.key, { baseUrl });
  if (!raw) return "";
  await writeHostKey(raw, storage);
  return raw;
}

export function buildKitOptions(o) {
  return {
    stateDir: o.stateDir,
    engineDir: o.engineDir,
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
  // The kit types cancel/expiry itself: `why` plus a plain-words `error`.
  // Surface its sentence; fall back to its words only when the view has none.
  if (view?.error) return view.error;
  if (view?.why === "declined") return words("signin.cancelled");
  if (view?.why === "expired") return words("signin.expired");
  if (view?.why === "busy") return words("signin.busy");
  return "ChatGPT sign-in failed. Run again.";
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
 * Reads the X1 contract fields: model, role, system, messages (text and
 * image parts), the json flag and schema, plus lane. Text parts join in
 * order; image parts ride the kit's RunSpec.images. Legacy single-message
 * jobs ({message|prompt|text}) keep working. Returns null when the job
 * carries no message. When the job wants JSON, the model is instructed to
 * answer in JSON and the text is validated before submit (wantJson).
 */
export function buildRunSpec(job, lane = "chatgpt") {
  const cfg = laneConfig(lane);
  const input = job?.input && typeof job.input === "object" ? job.input : null;
  let message = "";
  let images = [];
  if (input && Array.isArray(input.messages)) {
    const texts = [];
    for (const m of input.messages) {
      if (!m || typeof m !== "object" || !Array.isArray(m.content)) continue;
      for (const p of m.content) {
        if (!p || typeof p !== "object") continue;
        if (p.type === "text" && typeof p.text === "string" && p.text) texts.push(p.text);
        else if (p.type === "image" && typeof p.data === "string" && p.data) {
          images.push({
            data: p.data,
            mimeType: typeof p.mediaType === "string" && p.mediaType ? p.mediaType : "image/png",
          });
        }
      }
    }
    message = texts.join("\n\n");
  } else {
    message =
      (typeof input?.message === "string" && input.message) ||
      (typeof input?.prompt === "string" && input.prompt) ||
      (typeof input?.text === "string" && input.text) ||
      "";
  }
  if (!message.trim()) return null;
  const spec = { sessionKey: `agent:${HOST_MEMBER}:host-${job.id}`, member: HOST_MEMBER, message };
  if (images.length) spec.images = images;
  if (typeof input.model === "string" && input.model) {
    spec.model = input.model.includes("/") ? input.model : `${cfg.modelPrefix}${input.model}`;
  }
  if (typeof input.role === "string" && input.role) spec.meta = { role: input.role };
  const parts = [];
  if (typeof input.system === "string" && input.system) parts.push(input.system);
  const wantJson = input.json === true || input.schema !== undefined;
  if (wantJson) {
    parts.push(
      input.schema !== undefined
        ? `Respond with JSON only, matching this schema: ${JSON.stringify(input.schema)}`
        : "Respond with JSON only.",
    );
  }
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
    // The engine maps `resting_until:<ms>` to a typed 429 (X1): never prose here.
    return { error: restingError(end.until), restUntil: end.until };
  }
  if (kind === "resting" || kind === "plan") return { error: `resting: ${message}` };
  return { error: `${kind}: ${message}` };
}

async function submitOutcome(client, job, outcome) {
  const body = outcome.result === undefined ? { error: outcome.error } : { result: outcome.result };
  if (!(await client.submit(job.id, body))) {
    throw Object.assign(new Error(`Host result acknowledgment failed for job ${job.id}`), {
      jobId: job.id,
      outcome,
    });
  }
  return outcome;
}

/** Claim one job, run it through the kit, submit the result or a typed failure.
 * Submits the X1 result shape {text, usage}; resting failures carry the
 * `resting_until:<ms>` marker. */
export async function runJobAndSubmit({ kit, client, job, lane = "chatgpt" }) {
  const built = buildRunSpec(job, lane);
  if (!built) {
    const error = "invalid-input: job carries no message";
    return submitOutcome(client, job, { error });
  }
  let end;
  try {
    end = await kit.run(built.spec);
  } catch (e) {
    const error = `failed: ${e?.message || String(e)}`;
    return submitOutcome(client, job, { error });
  }
  if (end.ok) {
    const result = { text: end.text, ...(end.usage === undefined ? {} : { usage: end.usage }) };
    if (built.wantJson) {
      try {
        JSON.parse(result.text);
      } catch {
        const error = "invalid-result: model did not return JSON";
        return submitOutcome(client, job, { error });
      }
    }
    return submitOutcome(client, job, { result });
  }
  const { error, restUntil } = describeRunEnd(end);
  return submitOutcome(client, job, { error, restUntil });
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
  lane = "chatgpt",
}) {
  const via = laneConfig(lane).heartbeatVia;
  const engineLane = engineLaneOf(lane);
  let lastBeat = 0;
  while (!ctl.draining) {
    const now = Date.now();
    if (now - lastBeat >= heartbeatMs) {
      lastBeat = now;
      // Signed in here by construction; the start-request flag is honoured
      // only while signed out, so the loop ignores it. The heartbeat carries
      // the engine lane and the sign-in flag (X3).
      await client.heartbeat({ state: "signed-in", via }, undefined, { lane: engineLane, signedIn: true });
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
    const outcome = await runJobAndSubmit({ kit, client, job: claimed, lane });
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

export async function hostStatus(lane = "chatgpt") {
  const cfg = laneConfig(lane);
  return withKit(async (kit) => {
    const providers = await kit.providers(HOST_MEMBER);
    console.log(
      providers.includes(cfg.provider)
        ? `Host ready: ${HOST_MEMBER} signed in (${cfg.label}).`
        : `Host ready: not signed in. Run: v1design host${lane === "chatgpt" ? "" : " --lane claude"}`,
    );
  });
}

export async function hostSignout(lane = "chatgpt") {
  const cfg = laneConfig(lane);
  return withKit(async (kit) => {
    await kit.signOut(HOST_MEMBER, cfg.provider);
    console.log(`Host signed out of the ${cfg.label}.`);
  });
}

/**
 * The Claude-lane consent + login instructions, built from the kit's own
 * route row (billing, prerequisite, terms URL) — never our own paraphrase.
 */
export function claudeRouteOf(kit) {
  try {
    return kit.routes().find((r) => r.choice === HOST_CLAUDE_AUTH_CHOICE) ?? null;
  } catch {
    return null;
  }
}

export function claudeConsentWords(route) {
  const billing = route?.billing ?? "subscription";
  const terms = route?.termsUrl ? ` Anthropic's terms apply: ${route.termsUrl}` : "";
  return (
    `v1design host uses your own Claude Pro/Max plan on this computer via your own Claude Code login ` +
    `(${billing} billing; never an API key).${terms}`
  );
}

export const claudeIsolatedHome = (stateDir) => join(stateDir, "openclaw", "home");

export function claudeLoginInstructions(stateDir, route) {
  const home = claudeIsolatedHome(stateDir);
  return [
    route?.prerequisite ?? "Sign in through unmodified Claude Code on this machine; the login stays in Claude Code.",
    "",
    "  " + `HOME=${home} CLAUDE_CONFIG_DIR=${join(home, ".claude")} claude auth login`,
    "",
    "Then run `v1design host --lane claude` again to activate.",
  ].join("\n");
}

/**
 * Sign in when needed. Returns "already" (signed in, start flag ignored),
 * "signed-in", or "declined". A web start-request is honoured only while
 * signed out and implies the owner consented on the web (TTY ask skipped).
 */
export async function signInIfNeeded({ kit, client, ask = askYesNo, lane = "chatgpt" }) {
  const cfg = laneConfig(lane);
  const engineLane = engineLaneOf(lane);
  if (await kit.signedIn(HOST_MEMBER, cfg.provider)) {
    await client.heartbeat({ state: "signed-in", via: cfg.heartbeatVia }, undefined, { lane: engineLane, signedIn: true });
    return "already";
  }
  const polled = await client.poll();
  const webStart = polled?.startRequested === true;
  if (lane === "claude") {
    // The native route keeps login in Claude Code under the kit's isolated
    // HOME: show the kit's Anthropic-terms caveat + login instructions, then
    // ask Y/N before the first sign-in (skipped on a web start).
    const route = claudeRouteOf(kit);
    if (!webStart) {
      console.error(claudeConsentWords(route));
      console.error("");
      console.error(claudeLoginInstructions(hostStateDir(), route));
      console.error("");
      if (!(await ask("Continue with your Claude Pro/Max plan?"))) return "declined";
    } else console.error("Web sign-in requested — continuing.");
  } else if (!webStart && !(await ask(CONSENT_WORDS))) return "declined";
  else if (webStart) console.error("Web sign-in requested — continuing.");
  const signin = kit.signIn(
    HOST_MEMBER,
    { authChoice: cfg.authChoice },
    (view) => {
      void showView(view);
      void client.heartbeat(mapKitViewToPost(view), undefined, {
        lane: engineLane,
        signedIn: view.state === "done",
      });
    },
  );
  const done = await signin.done;
  if (done.state !== "done") throw new Error(signinFailureMessage(done));
  await client.heartbeat(mapKitViewToPost(done), undefined, { lane: engineLane, signedIn: true });
  return "signed-in";
}

export async function hostRun(client = null, lane = "chatgpt") {
  const cfg = laneConfig(lane);
  checkNodeVersion();
  const stateDir = hostStateDir();
  guardSocketPath(stateDir);
  await ensureSecureDir(join(homedir(), ".v1design"));
  const id = await hostId();
  const hostKey = await ensureHostKey({ id }); // sealed via BYOKit; "" until the engine provisions one
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
    const signinState = await signInIfNeeded({ kit, client, lane });
    if (signinState === "declined") {
      console.error(`Consent declined. Run \`v1design host${lane === "chatgpt" ? "" : " --lane claude"}\` again to continue.`);
      return;
    }
    if (signinState === "signed-in") {
      const providers = await kit.providers(HOST_MEMBER);
      console.error(`Signed in (${cfg.label}): ${providers.join(", ") || cfg.provider}.`);
    } else {
      console.error(`Already signed in (${cfg.label}).`);
    }
    console.error("Host online. Press Ctrl-C to stop.");
    await serveJobs({ kit, client, ctl, lane });
  } finally {
    process.removeListener("SIGINT", onSigint);
    await kit.stop();
  }
}

/**
 * --fake: run the X1 contract fixture through the real runJobAndSubmit with
 * a stub kit and a capturing client (no sign-in, no engine, no network).
 * Any wire drift fails loudly here and in test/host-job-contract.test.mjs.
 */
export async function hostFakeCheck(lane = "chatgpt") {
  const fixture = JSON.parse(
    await readFile(new URL("./host-job-contract.fixture.json", import.meta.url), "utf8"),
  );
  const fail = (msg) => {
    throw new Error(`host --fake contract mismatch: ${msg}`);
  };
  const seen = [];
  const submitted = [];
  const kit = {
    async run(spec) {
      seen.push(spec);
      return { ok: true, text: fixture.result.text, usage: fixture.result.usage };
    },
  };
  const client = { submit: async (id, body) => { submitted.push([id, body]); return true; } };
  const job = { id: "fake-1", input: fixture.job };
  await runJobAndSubmit({ kit, client, job, lane });
  if (seen.length !== 1) fail("kit.run was not called exactly once");
  const [spec] = seen;
  if (spec.model !== fixture.job.model) fail(`model ${spec.model} !== ${fixture.job.model}`);
  if (typeof spec.system !== "string" || !spec.system.includes(fixture.job.system)) {
    fail("system prompt did not reach the kit");
  }
  if (!spec.system.includes(JSON.stringify(fixture.job.schema))) fail("schema did not reach the kit");
  const wantImages = fixture.job.messages.flatMap((m) => m.content).filter((p) => p.type === "image");
  const images = spec.images ?? [];
  if (images.length !== wantImages.length) {
    fail(`${images.length} images reached the kit, fixture has ${wantImages.length}`);
  }
  if (images.some((im, i) => im.data !== wantImages[i].data || im.mimeType !== wantImages[i].mediaType)) {
    fail("image payload did not round-trip to the kit");
  }
  if (JSON.stringify(submitted) !== JSON.stringify([["fake-1", { result: fixture.result }]])) {
    fail(`submitted ${JSON.stringify(submitted)} !== {text, usage}`);
  }
  // Resting reports as resting_until:<ms>.
  const restingKit = {
    run: async () => ({ ok: false, kind: "resting", until: 1788393600000, message: "plan resting" }),
  };
  const restingOut = await runJobAndSubmit({ kit: restingKit, client, job, lane });
  if (restingOut.error !== fixture.resting.error) fail(`resting ${restingOut.error} !== ${fixture.resting.error}`);
  if (parseRestingUntil(restingOut.error) !== 1788393600000) fail("resting marker does not parse");
  console.log("host --fake: contract ok (messages, images, {text, usage}, resting_until).");
}

export async function hostCommand(sub, flags = {}) {
  const lane = laneOf(flags);
  if (flags.fake) return hostFakeCheck(lane);
  if (sub === "status" || flags.status) return hostStatus(lane);
  if (sub === "signout" || sub === "logout" || flags.signout) return hostSignout(lane);
  if (sub === "help" || sub === "--help" || sub === "-h" || flags.help) {
    console.log(`Studio on your computer — v1design host

Run Studio jobs using your own plan through BYOKit. Keep this command running:
  v1design host                       Use your ChatGPT plan; sign in when needed
  v1design host --lane claude         Use your Claude Pro/Max plan
  v1design host [--lane claude] status  Show sign-in state for the selected plan
  v1design host [--lane claude] signout Sign out of the selected plan on this computer

The Claude option uses your own Claude Code login in BYOKit's isolated home
(subscription billing, never an API key). Follow the login instructions printed
at startup. Anthropic's terms apply:
https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use

Needs Node ${HOST_NODE_REQUIREMENT}. macOS/Linux only.
Keep the computer online. Ctrl+C finishes the current job before exiting.`);
    return;
  }
  if (sub) throw new Error(`unknown host subcommand: ${sub} (see: v1design host help)`);
  return hostRun(null, lane);
}
