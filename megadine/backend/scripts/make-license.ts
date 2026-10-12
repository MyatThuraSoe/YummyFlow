/**
 * Mint a hardware-bound MegaDine license key.
 *
 * Usage:
 *   npx tsx scripts/make-license.ts [--edition ENTERPRISE] [--name "Bistro"]
 *                                   [--days 3650] [--machine <id>]
 *
 * The signing keypair is written once to backend/.license-keys/ (gitignored).
 * Keep private.pem secret — it is what lets you issue valid keys. The public
 * key is safe to ship and must be set as MEGACODE_LICENSE_PUBLIC_KEY so the
 * server can verify the signature.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getMachineId } from "../src/lib/machine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ALL_FEATURES = [
  "pos", "kds", "reservations", "inventory", "reports", "loyalty", "qr_ordering",
  "multi_language", "customer_display", "multi_branch", "accounting", "api_access", "cloud_sync",
];

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const edition = arg("edition", "ENTERPRISE").toUpperCase();
const restaurantName = arg("name", "MegaDine Restaurant");
const days = Number(arg("days", "3650"));
const machineId = arg("machine", "") || getMachineId();

const keyDir = path.resolve(__dirname, "../.license-keys");
const privPath = path.join(keyDir, "private.pem");
const pubPath = path.join(keyDir, "public.pem");

let privatePem: string;
let publicPem: string;
if (fs.existsSync(privPath) && fs.existsSync(pubPath)) {
  privatePem = fs.readFileSync(privPath, "utf8");
  publicPem = fs.readFileSync(pubPath, "utf8");
} else {
  fs.mkdirSync(keyDir, { recursive: true });
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  privatePem = privateKey as string;
  publicPem = publicKey as string;
  fs.writeFileSync(privPath, privatePem, { mode: 0o600 });
  fs.writeFileSync(pubPath, publicPem);
  console.log(`Generated new signing keypair in ${keyDir}`);
}

const max = Number.MAX_SAFE_INTEGER;
const payload = {
  restaurantName,
  edition,
  maxTerminals: max,
  maxTables: max,
  maxMenuItems: max,
  features: ALL_FEATURES,
  issuedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + days * 86_400_000).toISOString(),
  hardwareFingerprint: machineId,
};

const signature = crypto
  .sign("RSA-SHA256", Buffer.from(JSON.stringify(payload)), privatePem)
  .toString("base64");

const licenseKey = Buffer.from(JSON.stringify({ ...payload, signature })).toString("base64");

console.log("");
console.log("Machine id :", machineId);
console.log("Edition    :", edition);
console.log("Expires    :", payload.expiresAt);
console.log("");
console.log("LICENSE_KEY=" + licenseKey);
console.log("");
const pubDer = crypto.createPublicKey(publicPem).export({ type: "spki", format: "der" }).toString("base64");
console.log("MEGACODE_LICENSE_PUBLIC_KEY=" + pubDer);
