import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { env } from "./env.js";

let cached: string | null = null;

/**
 * Stable per-machine identifier used to hardware-bind the license key.
 *
 * Resolution order:
 *   1. `MACHINE_ID` env override (set this in Docker so containers don't
 *      regenerate a fresh id on every rebuild).
 *   2. Windows registry `MachineGuid` / Linux `/etc/machine-id`.
 *   3. Hostname + platform + arch + CPU model fallback.
 *
 * The raw value is hashed so the license never exposes the underlying id.
 */
export function getMachineId(): string {
  if (cached) return cached;
  if (env.MACHINE_ID) return (cached = env.MACHINE_ID.trim());

  let raw = "";
  try {
    if (process.platform === "win32") {
      const out = execFileSync(
        "reg",
        ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"],
        { encoding: "utf8" },
      );
      raw = (out.match(/MachineGuid\s+REG_SZ\s+([\w-]+)/i)?.[1] ?? "").trim();
    } else {
      for (const p of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
        if (fs.existsSync(p)) {
          raw = fs.readFileSync(p, "utf8").trim();
          if (raw) break;
        }
      }
    }
  } catch {
    // fall through to the hostname-based fingerprint
  }

  if (!raw) raw = `${os.hostname()}|${process.platform}|${process.arch}|${os.cpus()[0]?.model ?? ""}`;
  return (cached = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32));
}
