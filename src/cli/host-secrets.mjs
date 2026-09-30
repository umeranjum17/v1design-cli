// Sealed storage for the host key (Studio S3, firstmate review).
//
// The host key is a credential, so it goes through BYOKit (@byokit/secrets),
// never a plaintext file:
//   - on a machine with a keyring: osKeyringSeal (data key in the OS keyring,
//     sealed envelope in host-key.json);
//   - where there is none: the kit-documented hostKeySeal, with the 32-byte
//     host key from an app-owned 0600 file kept separate from the sealed data.
// The sealed file records which seal wrote it; a wrong seal fails closed
// (auth-failed). The key is never logged.
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { hostKeySeal, osKeyringSeal } from "@byokit/secrets";

export const SEAL_SERVICE = "v1design-host";
export const hostKeyFile = (home = homedir()) => join(home, ".v1design", "host-key.json");
export const hostMasterKeyFile = (home = homedir()) => join(home, ".v1design", "host-master.key");

const NO_KEYRING = new Set(["unavailable", "unsupported"]);

function isNoKeyring(e) {
  return Boolean(e && (NO_KEYRING.has(e.code) || /keyring|secret service/i.test(e.message || "")));
}

async function ensureSecureDir(dir) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
}

/** Raw 32-byte host key for the hostKeySeal fallback, generated once, 0600. */
export async function hostMasterKey(home = homedir()) {
  const path = hostMasterKeyFile(home);
  try {
    const raw = await readFile(path);
    if (raw.length === 32) return new Uint8Array(raw);
  } catch {
    // fall through to generate
  }
  const key = randomBytes(32);
  await ensureSecureDir(dirname(path));
  await writeFile(path, key, { mode: 0o600 });
  await chmod(path, 0o600);
  return new Uint8Array(key);
}

/**
 * Resolve the seal. Auto mode prefers the OS keyring and falls back to the
 * kit-documented host-key seal where there is none. `mode` forces
 * "os-keyring" or "host-key" (V1DESIGN_HOST_SEAL does the same).
 * `keyring` injects a fake backend (tests only — never the owner's keyring).
 */
export async function loadSeal(o = {}) {
  const home = o.home || homedir();
  const mode = o.mode || process.env.V1DESIGN_HOST_SEAL || "auto";
  const osSeal = () =>
    o.keyring
      ? osKeyringSeal({ service: SEAL_SERVICE, keyring: o.keyring })
      : osKeyringSeal({ service: SEAL_SERVICE });
  if (mode === "host-key") {
    return { seal: hostKeySeal({ key: await hostMasterKey(home), service: SEAL_SERVICE }), via: "host-key" };
  }
  if (mode !== "os-keyring" && mode !== "auto") {
    throw new Error(`bad seal mode ${mode} (want auto, os-keyring or host-key)`);
  }
  try {
    return { seal: osSeal(), via: "os-keyring" };
  } catch (e) {
    if (mode === "os-keyring" || !isNoKeyring(e)) throw e;
    return { seal: hostKeySeal({ key: await hostMasterKey(home), service: SEAL_SERVICE }), via: "host-key" };
  }
}

function encodeEnvelope(seal, key) {
  return Buffer.from(seal.encryptString(JSON.stringify({ key }))).toString("base64");
}

function decodeEnvelope(seal, encoded) {
  return JSON.parse(seal.decryptString(Buffer.from(encoded, "base64"))).key;
}

export async function writeHostKey(key, o = {}) {
  const home = o.home || homedir();
  const { seal, via } = await loadSeal({ ...o, home });
  const path = hostKeyFile(home);
  await ensureSecureDir(dirname(path));
  await writeFile(path, JSON.stringify({ v: 1, via, sealed: encodeEnvelope(seal, key) }) + "\n", {
    mode: 0o600,
  });
  await chmod(path, 0o600);
}

/** Returns "" when no key is stored yet. Migrates a legacy plaintext file by sealing it. */
export async function readHostKey(o = {}) {
  const home = o.home || homedir();
  let raw;
  try {
    raw = JSON.parse(await readFile(hostKeyFile(home), "utf8"));
  } catch {
    return "";
  }
  if (raw && typeof raw.sealed === "string") {
    // The recorded seal always wins; a wrong seal fails closed (auth-failed).
    const { seal } = await loadSeal({
      ...o,
      home,
      mode: raw.via === "host-key" || raw.via === "os-keyring" ? raw.via : undefined,
    });
    return decodeEnvelope(seal, raw.sealed);
  }
  if (raw && typeof raw.key === "string") {
    // Legacy plaintext (never shipped): seal it in place, then return it.
    await writeHostKey(raw.key, { ...o, home });
    return raw.key;
  }
  return "";
}
