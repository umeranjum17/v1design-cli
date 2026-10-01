// Typed client for the S2 host contract (Studio plan §2, S2), on /host/*.
//
//   GET  /host/jobs?hostId=          -> { jobs, startRequested? }
//   POST /host/jobs/:id/claim  {hostId}            -> { job } | 404 | 409
//   POST /host/jobs/:id/result {hostId, result?|error?} -> { job } | 404 | 409
//   POST /host/heartbeat {hostId, meta?, signIn?}  -> { ok, host, startRequested }
//
// Auth: the sealed host key as a Bearer token (host- or full-scope key on the
// engine). The device code is a bearer secret: whoever enters it first binds
// the host, so views are only readable by the owning uid and expire with the
// code (S2 enforces; this client just sends). All posts are best-effort from
// the TTY's point of view — failures surface to the caller, never throw
// uncaught into the sign-in callback.
import { readCredentials, DEFAULT_API_URL } from "./auth.ts";

export type HostJob = {
  id: string;
  uid: string;
  hostId?: string;
  status: "queued" | "claimed" | "done" | "failed" | "cancelled";
  input: unknown;
  result?: unknown;
  error?: string;
};

export type HostSignInPost = {
  /** Engine states: "code" (code viewable by owner) | "signed-in" | anything else = signed-out. */
  state: "code" | "signed-in" | "signed-out";
  via?: string;
  url?: string;
  code?: string;
  account?: { email?: string; plan?: string };
};

export type HostPoll = { jobs: HostJob[]; startRequested: boolean };
export type HostHeartbeat = { startRequested: boolean };

/** Engine lane names on the wire (X3): the host only runs its own lane. */
export type HostLaneName = "chatgpt" | "claude-plan";

export type HostHeartbeatPresence = {
  lane?: HostLaneName;
  signedIn?: boolean;
};

export type HostClientOptions = {
  baseUrl?: string;
  hostKey?: string;
  hostId?: string;
  timeoutMs?: number;
};

async function defaultBaseUrl(): Promise<string> {
  const env = process.env.V1_DESIGN_API_URL;
  if (env) return env.replace(/\/$/, "");
  try {
    return ((await readCredentials())?.apiUrl || DEFAULT_API_URL).replace(/\/$/, "");
  } catch {
    return DEFAULT_API_URL;
  }
}

const req = (client: { key: string; timeoutMs: number }, path: string, init?: RequestInit) =>
  fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(client.key ? { authorization: `Bearer ${client.key}` } : {}),
    },
    signal: init?.signal ?? AbortSignal.timeout(client.timeoutMs),
  });

/** Null when the engine is unreachable or S2 is not deployed: the host works TTY-only. */
export function createHostClient(o: HostClientOptions = {}) {
  const state = { key: o.hostKey ?? "", id: o.hostId ?? "", timeoutMs: o.timeoutMs ?? 8000 };
  let base: string | null = null;
  const url = async (path: string) => {
    base ??= (o.baseUrl ?? (await defaultBaseUrl())).replace(/\/$/, "");
    return `${base}${path}`;
  };

  return {
    setHostKey(key: string) {
      state.key = key;
    },
    setHostId(id: string) {
      state.id = id;
    },

    /** Host poll: queued jobs for this uid plus any web start-request flag. */
    async poll(hostId = state.id): Promise<HostPoll | null> {
      try {
        const res = await req(state, await url(`/host/jobs?hostId=${encodeURIComponent(hostId)}`));
        if (!res.ok) return null;
        const data = (await res.json()) as Partial<HostPoll>;
        return { jobs: Array.isArray(data.jobs) ? data.jobs : [], startRequested: data.startRequested === true };
      } catch {
        return null;
      }
    },

    /** Claim one queued job for this host. Null when missing/foreign or not claimable. */
    async claim(id: string, hostId = state.id): Promise<HostJob | null> {
      try {
        const res = await req(state, await url(`/host/jobs/${encodeURIComponent(id)}/claim`), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ hostId }),
        });
        if (!res.ok) return null;
        return ((await res.json()) as { job?: HostJob }).job ?? null;
      } catch {
        return null;
      }
    },

    /** Submit the result (claiming host only). True when the engine accepted it. */
    async submit(id: string, body: { result: unknown } | { error: string }, hostId = state.id): Promise<boolean> {
      try {
        const res = await req(state, await url(`/host/jobs/${encodeURIComponent(id)}/result`), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ hostId, ...body }),
        });
        return res.ok;
      } catch {
        return false;
      }
    },

    /**
     * Heartbeat: presence + the current SignInView. Returns the web
     * start-request flag (a web start is honoured only while signed out).
     * `presence` carries the engine lane and the sign-in flag (X3).
     */
    async heartbeat(
      signIn?: HostSignInPost,
      meta?: Record<string, unknown>,
      presence?: HostHeartbeatPresence,
      hostId = state.id,
    ): Promise<HostHeartbeat | null> {
      try {
        const res = await req(state, await url("/host/heartbeat"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            hostId,
            ...(meta ? { meta } : {}),
            ...(signIn ? { signIn } : {}),
            ...(presence?.lane ? { lane: presence.lane } : {}),
            ...(presence?.signedIn !== undefined ? { signedIn: presence.signedIn } : {}),
          }),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as Partial<HostHeartbeat>;
        return { startRequested: data.startRequested === true };
      } catch {
        return null;
      }
    },
  };
}

/**
 * Mint a host-scoped key for one hostId (X3; raw shown once). Auth is the
 * owner's full-scope user key, never the host key. Null when the engine is
 * unreachable or refuses: the host keeps working TTY-only.
 */
export async function mintHostKey(
  hostId: string,
  userKey: string,
  o: { baseUrl?: string; timeoutMs?: number } = {},
): Promise<string | null> {
  try {
    const base = (o.baseUrl ?? (await defaultBaseUrl())).replace(/\/$/, "");
    const res = await fetch(`${base}/host/keys`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${userKey}` },
      body: JSON.stringify({ hostId }),
      signal: AbortSignal.timeout(o.timeoutMs ?? 8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { key?: unknown };
    return typeof data.key === "string" && data.key ? data.key : null;
  } catch {
    return null;
  }
}

export type HostClient = ReturnType<typeof createHostClient>;
