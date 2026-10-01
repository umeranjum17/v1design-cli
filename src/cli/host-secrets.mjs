// Sealed storage for the host key (Studio S3, firstmate review).
//
// The host key is a credential, so it goes through BYOKit (@byokit/secrets),
// never a plaintext file: osKeyringSeal auto-selects the OS keyring and falls
// back to the kit's persistent owner-only host-key file where no usable
// keyring exists (0700 dir, 0600 files). The sealed file records which seal
// wrote it; a wrong seal fails closed (auth-failed). The key is never logged.
//
// Backup warning: the kit's host-key directory holds the only copy of the
// file key — keep it OUT of sealed-store backups (a backup bundled with its
// key decrypts on its own), or losing it makes the stores unrecoverable.
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { hostKeyFileSeal, osKeyringSeal } from "@byokit/secrets";

export const SEAL_SERVICE = "v1design-host";
export const hostKeyFile = (home = homedir()) => join(home, ".v1design", "host-key.json");

async function ensureSecureDir(dir) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
}

/**
 * Resolve the seal. Auto mode is the kit default: OS keyring first, persistent
 * host-key file where there is none. `mode` forces "os-keyring" (no fallback)
 * or "host-key" (file seal directly); V1DESIGN_HOST_SEAL does the same.
 * `keyring` injects a fake backend and `stateDir` an app-owned key root
 * (tests only — never the owner's keyring or state dir).
 */
export async function loadSeal(o = {}) {
  const mode = o.mode || process.env.V1DESIGN_HOST_SEAL || "auto";
  const service = SEAL_SERVICE;
  const stateDir = o.stateDir;
  if (mode === "host-key") {
    const seal = hostKeyFileSeal({ service, ...(stateDir ? { stateDir } : {}) });
    return { seal, via: seal.mode };
  }
  if (mode !== "os-keyring" && mode !== "auto") {
    throw new Error(`bad seal mode ${mode} (want auto, os-keyring or host-key)`);
  }
  const seal = osKeyringSeal({
    service,
    ...(o.keyring ? { keyring: o.keyring } : {}),
    ...(stateDir ? { stateDir } : {}),
    ...(mode === "os-keyring" ? { fallback: false } : {}),
  });
  return { seal, via: seal.mode };
}

function encodeEnvelope(seal, key, binding) {
  return Buffer.from(seal.encryptString(JSON.stringify({ key, binding }))).toString("base64");
}

function decodeEnvelope(seal, encoded) {
  return JSON.parse(seal.decryptString(Buffer.from(encoded, "base64")));
}

export async function writeHostKey(key, o = {}) {
  const home = o.home || homedir();
  const { seal, via } = await loadSeal({ ...o, home });
  const path = hostKeyFile(home);
  await ensureSecureDir(dirname(path));
  await writeFile(path, JSON.stringify({ v: 1, via, sealed: encodeEnvelope(seal, key, o.binding) }) + "\n", {
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
      mode: raw.via === "host-key-file" ? "host-key" : raw.via === "keyring" ? "os-keyring" : undefined,
    });
    const envelope = decodeEnvelope(seal, raw.sealed);
    if (o.binding !== undefined && envelope.binding !== o.binding) return "";
    return envelope.key;
  }
  if (o.binding === undefined && raw && typeof raw.key === "string") {
    // Legacy plaintext (never shipped): seal it in place, then return it.
    await writeHostKey(raw.key, { ...o, home });
    return raw.key;
  }
  return "";
}
