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

export async function login(): Promise<void> {
  const apiUrl = (process.env.V1_DESIGN_API_URL || DEFAULT_API_URL).replace(/\/$/, "");
  const webUrl = (process.env.V1_DESIGN_WEB_URL || DEFAULT_WEB_URL).replace(/\/$/, "");
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
    }, 5 * 60 * 1000);
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
        const exchanged = await fetch(`${apiUrl}/auth/exchange`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code, code_verifier: codeVerifier }),
        });
        if (!exchanged.ok) throw new Error((await exchanged.text()).slice(0, 500) || "authorization exchange failed");
        const { key } = await exchanged.json() as { key?: string };
        if (!key) throw new Error("authorization exchange returned no credential");
        await saveCredentials({ apiUrl, key, authorizedAt: Date.now() });
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

  console.error(`v-1.design connected. Credentials saved to ${CONFIG_PATH}`);
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
