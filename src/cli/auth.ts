import http from "node:http";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const CONFIG_PATH = join(homedir(), ".v1design", "credentials.json");
export const DEFAULT_WEB_URL = "https://v-1.design";
export const DEFAULT_API_URL = "https://engine.v-1.design";

export type Credentials = { apiUrl?: string; key?: string; authorizedAt?: number };

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function readCredentials(): Promise<Credentials | null> {
  try { return JSON.parse(await readFile(CONFIG_PATH, "utf8")) as Credentials; }
  catch { return null; }
}

async function saveCredentials(credentials: Credentials) {
  await mkdir(dirname(CONFIG_PATH), { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(credentials, null, 2) + "\n", { mode: 0o600 });
}

function openBrowser(url: string) {
  const cmd =
    process.platform === "darwin" ? "open" :
    process.platform === "win32" ? "cmd" :
    "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
  child.unref();
}

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 2000;

/** Thrown when the engine has no /auth/device/poll route (older deploy) so we can fall back to loopback. */
class DeviceUnsupported extends Error {}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Short, human-readable verification code shown in BOTH the terminal and the browser so the person
 *  approving can confirm the request came from their own machine (anti-phishing for the device flow). */
function makeUserCode(): string {
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Crockford base32, no ambiguous I/L/O/0/1
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

async function exchangeAndSave(apiUrl: string, code: string, codeVerifier: string): Promise<void> {
  const exchanged = await fetch(`${apiUrl}/auth/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, code_verifier: codeVerifier }),
  });
  if (!exchanged.ok) throw new Error((await exchanged.text()).slice(0, 500) || "authorization exchange failed");
  const { key } = await exchanged.json() as { key?: string };
  if (!key) throw new Error("authorization exchange returned no credential");
  await saveCredentials({ apiUrl, key, authorizedAt: Date.now() });
}

export async function login(): Promise<void> {
  const apiUrl = (process.env.V1_DESIGN_API_URL || DEFAULT_API_URL).replace(/\/$/, "");
  const webUrl = (process.env.V1_DESIGN_WEB_URL || DEFAULT_WEB_URL).replace(/\/$/, "");
  // Default to the device (polling) flow so authorization never depends on a reachable localhost
  // server — it works over SSH, in containers, and in sandboxed agents. Opt back into the old
  // same-machine loopback callback with V1_DESIGN_LOOPBACK=1.
  //
  // Deploy order matters: ship the web /authorize change BEFORE the engine. If the engine has the
  // /auth/device/poll route but the web bundle is still the old one (no `session` support), the
  // browser can't complete the flow and the poll never 404s, so the loopback fallback below can't
  // trigger. Web-first deploy avoids that window; the V1_DESIGN_LOOPBACK escape hatch covers the rest.
  if (process.env.V1_DESIGN_LOOPBACK === "1") {
    await loopbackLogin(apiUrl, webUrl);
  } else {
    try {
      await deviceLogin(apiUrl, webUrl);
    } catch (e) {
      if (e instanceof DeviceUnsupported) {
        console.error("This v-1.design deployment doesn't support the polling flow yet; falling back to a localhost callback.");
        await loopbackLogin(apiUrl, webUrl);
      } else {
        throw e;
      }
    }
  }
  console.error(`v-1.design connected. Credentials saved to ${CONFIG_PATH}`);
}

/**
 * Device (polling) flow — no localhost callback. The CLI mints a high-entropy session id, opens the
 * authorize page, and polls the engine until the user authorizes. The code the engine returns is
 * still PKCE-bound, so it is useless without the verifier that never leaves this process.
 */
async function deviceLogin(apiUrl: string, webUrl: string): Promise<void> {
  const sessionId = base64url(randomBytes(32));
  const userCode = makeUserCode();
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(createHash("sha256").update(codeVerifier).digest());
  const authorizeUrl =
    `${webUrl}/authorize?session=${encodeURIComponent(sessionId)}` +
    `&client=v1design` +
    `&user_code=${encodeURIComponent(userCode)}` +
    `&code_challenge=${encodeURIComponent(codeChallenge)}` +
    `&code_challenge_method=S256`;

  console.error("");
  console.error(`  Verification code:  ${userCode}`);
  console.error("  Approve in the browser ONLY if it shows this exact code and you just ran this yourself.");
  console.error("");
  console.error("Opening v-1.design to authorize this agent...");
  console.error(authorizeUrl);
  try { openBrowser(authorizeUrl); } catch { /* URL is printed as fallback */ }
  console.error("Waiting for you to authorize in the browser...");
  console.error("(If the page can't load, re-run with V1_DESIGN_LOOPBACK=1 to use a localhost callback instead.)");

  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    let data: { status?: string; code?: string } | null = null;
    try {
      const res = await fetch(`${apiUrl}/auth/device/poll`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session: sessionId }),
      });
      if (res.status === 404) throw new DeviceUnsupported();
      if (!res.ok) throw new Error((await res.text()).slice(0, 300) || "authorization poll failed");
      data = await res.json() as { status?: string; code?: string };
    } catch (e) {
      if (e instanceof DeviceUnsupported) throw e;
      // Transient network hiccup — keep polling until the deadline.
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    if (data?.code) {
      await exchangeAndSave(apiUrl, data.code, codeVerifier);
      return;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error("authorization timed out");
}

/** Legacy loopback flow — kept as a same-machine fallback. Requires a reachable 127.0.0.1 server. */
async function loopbackLogin(apiUrl: string, webUrl: string): Promise<void> {
  const state = randomBytes(18).toString("hex");
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(createHash("sha256").update(codeVerifier).digest());

  const server = http.createServer();
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port));
  });
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const authorizeUrl =
    `${webUrl}/authorize?redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(state)}` +
    `&client=v1design` +
    `&code_challenge=${encodeURIComponent(codeChallenge)}` +
    `&code_challenge_method=S256`;

  console.error("Opening v-1.design to authorize this agent...");
  console.error(authorizeUrl);
  try { openBrowser(authorizeUrl); } catch { /* URL is printed as fallback */ }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close();
      reject(new Error("authorization timed out"));
    }, LOGIN_TIMEOUT_MS);
    server.on("request", async (req, res) => {
      try {
        const url = new URL(req.url || "/", redirectUri);
        if (url.pathname !== "/callback") {
          res.writeHead(404).end("Not found");
          return;
        }
        if (url.searchParams.get("state") !== state) throw new Error("state mismatch");
        const code = url.searchParams.get("code");
        if (!code) throw new Error(url.searchParams.get("error") || "missing authorization code");
        await exchangeAndSave(apiUrl, code, codeVerifier);
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end("<h1>v-1.design connected</h1><p>You can close this tab and return to your agent.</p>");
        clearTimeout(timer);
        resolve();
      } catch (e) {
        res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
        res.end(e instanceof Error ? e.message : "authorization failed");
        clearTimeout(timer);
        reject(e);
      } finally {
        server.close();
      }
    });
  });
}

export async function status(): Promise<void> {
  const c = await readCredentials();
  if (!c?.key) {
    console.log("Not connected. Run: v1design connect");
    return;
  }
  console.log(`Connected to ${c.apiUrl || DEFAULT_API_URL}`);
}

export async function logout(): Promise<void> {
  await rm(CONFIG_PATH, { force: true });
  console.log("Removed v-1.design local credentials.");
}
