// Typed client stub for the S2 host sign-in relay contract (Studio plan §2, S2).
//
// S2 (built in parallel on the engine) owns these endpoints; this file only
// types them so the host compiles and runs against the plan's contract today:
//   GET  /api/host/signin?hostId=        -> { intent, consent }
//   POST /api/host/signin/start  {hostId}  (web asks this computer to sign in)
//   POST /api/host/signin/cancel {hostId}  (web cancels a pending sign-in)
//   POST /api/host/signin/view   {hostId, view} (host posts its SignInView)
//
// Auth: the owning member's session for GET/start/cancel (handled by the web),
// the host's host-scoped key for view posts. The device code is a bearer secret:
// whoever enters it first binds the host, so views are only readable by the
// owning uid and expire with the code (S2 enforces; this stub just sends).
import { readCredentials, DEFAULT_API_URL } from "./auth.ts";

export type HostIntent = "none" | "start" | "cancel";
export type HostSignInView = {
  state: "waiting" | "done" | "failed";
  via: "browser" | "code";
  url?: string;
  code?: string;
  error?: string;
  why?: "busy" | "declined" | "expired" | "failed";
};
export type HostConsent = { route: string; terms: string; at: number } | null;

export type RelaySnapshot = { intent: HostIntent; consent: HostConsent };

export type RelayClient = {
  /** Null when the relay is unreachable (S2 not deployed): the host works TTY-only. */
  snapshot(hostId: string): Promise<RelaySnapshot | null>;
  postView(hostId: string, hostKey: string, view: HostSignInView): Promise<void>;
};

async function baseUrl(): Promise<string> {
  const env = process.env.V1_DESIGN_API_URL;
  if (env) return env.replace(/\/$/, "");
  try {
    return ((await readCredentials())?.apiUrl || DEFAULT_API_URL).replace(/\/$/, "");
  } catch {
    return DEFAULT_API_URL;
  }
}

export function createRelayClient(): RelayClient {
  return {
    async snapshot(hostId: string): Promise<RelaySnapshot | null> {
      try {
        const res = await fetch(`${await baseUrl()}/api/host/signin?hostId=${encodeURIComponent(hostId)}`, {
          headers: { "cache-control": "no-store" },
          signal: AbortSignal.timeout(8000),
        });
        if (res.status === 404) return null; // S2 not deployed yet
        if (!res.ok) return null;
        const data = (await res.json()) as Partial<RelaySnapshot>;
        return {
          intent: data.intent === "start" || data.intent === "cancel" ? data.intent : "none",
          consent: data.consent ?? null,
        };
      } catch {
        return null;
      }
    },
    async postView(hostId: string, hostKey: string, view: HostSignInView): Promise<void> {
      try {
        await fetch(`${await baseUrl()}/api/host/signin/view`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-v1-host-key": hostKey },
          body: JSON.stringify({ hostId, view }),
          signal: AbortSignal.timeout(8000),
        });
      } catch {
        // Relay posts are best-effort: the TTY always shows the view.
      }
    },
  };
}
