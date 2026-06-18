/** stdio connector — for local agents configured by `v1design connect`. */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { buildServer, EngineHttpClient } from "./server";

const DEFAULT_API_URL = "https://engine.v-1.design";
const CREDENTIALS_PATH = join(homedir(), ".v1design", "credentials.json");

async function localCredentials(): Promise<{ apiUrl?: string; key?: string } | null> {
  try {
    return JSON.parse(await readFile(CREDENTIALS_PATH, "utf8")) as { apiUrl?: string; key?: string };
  } catch {
    return null;
  }
}

export async function startStdio(): Promise<void> {
  const creds = await localCredentials();
  const url = (process.env.V1_DESIGN_API_URL || creds?.apiUrl || DEFAULT_API_URL).replace(/\/$/, "");
  const key = process.env.V1_DESIGN_API_KEY || creds?.key || "";
  if (!key) console.error("[v1design] not connected. Run: v1design connect");
  const server = buildServer(new EngineHttpClient(url, key));
  await server.connect(new StdioServerTransport());
  console.error(`[v1design] local connector ready (engine: ${url})`);
}
