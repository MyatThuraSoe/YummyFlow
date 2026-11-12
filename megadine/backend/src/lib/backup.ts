import { spawn } from "node:child_process";
import { mkdir, readdir, stat, rm, copyFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "./prisma.js";
import { env } from "./env.js";
import { ApiError } from "./errors.js";

export function backupDir(): string {
  return path.isAbsolute(env.BACKUP_DIR) ? env.BACKUP_DIR : path.resolve(process.cwd(), env.BACKUP_DIR);
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function run(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args);
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", (e) => resolve({ code: 1, stdout: out, stderr: `${err}${e.message}` }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout: out, stderr: err }));
  });
}

function databaseUrl(): string {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  return env.DATABASE_URL;
}

/**
 * Produce a real, restorable plain-SQL dump with the postgresql client tools
 * talking straight to DATABASE_URL. No Docker socket, no JSON fallback: if
 * pg_dump fails the caller records a FAILED backup instead of a fake success.
 */
async function produceDump(prefix = "megadine"): Promise<{ file: string; size: number }> {
  await mkdir(backupDir(), { recursive: true });
  const file = path.join(backupDir(), `${prefix}-${stamp()}.sql`);

  const result = await run("pg_dump", [
    "--dbname",
    databaseUrl(),
    "--no-owner",
    "--no-privileges",
    "--clean",
    "--if-exists",
    "--format=plain",
    "--file",
    file,
  ]);
  if (result.code !== 0) {
    await rm(file, { force: true }).catch(() => {});
    throw new Error(`pg_dump failed: ${(result.stderr || "unknown error").slice(0, 400)}`);
  }
  const st = await stat(file).catch(() => null);
  if (!st || st.size === 0) {
    await rm(file, { force: true }).catch(() => {});
    throw new Error("pg_dump produced an empty file");
  }
  return { file, size: st.size };
}

export async function runBackup(opts: { restaurantId?: string; kind: "AUTOMATIC" | "MANUAL" | "USB"; actorId: string }) {
  const restaurant =
    (opts.restaurantId && (await prisma.restaurant.findUnique({ where: { id: opts.restaurantId } }))) ||
    (await prisma.restaurant.findFirst());
  if (!restaurant) throw new Error("No restaurant configured");

  try {
    const dump = await produceDump();
    return await prisma.backupRun.create({
      data: {
        restaurantId: restaurant.id,
        kind: opts.kind,
        status: "SUCCESS",
        file: dump.file,
        sizeBytes: dump.size,
        note: "engine=pg_dump",
      },
    });
  } catch (err) {
    return prisma.backupRun.create({
      data: {
        restaurantId: restaurant.id,
        kind: opts.kind,
        status: "FAILED",
        note: err instanceof Error ? err.message : "unknown error",
      },
    });
  }
}

export async function listBackups(restaurantId?: string) {
  return prisma.backupRun.findMany({
    where: restaurantId ? { restaurantId } : undefined,
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function pruneBackups() {
  const cutoff = new Date(Date.now() - env.BACKUP_RETENTION_DAYS * 86_400_000);
  const old = await prisma.backupRun.findMany({ where: { createdAt: { lt: cutoff }, file: { not: null } } });
  for (const b of old) {
    if (b.file) await rm(b.file, { force: true }).catch(() => {});
  }
  await prisma.backupRun.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return old.length;
}

export async function backupStatus() {
  const [dir, backups] = await Promise.all([backupDir(), listBackups()]);
  let files = 0;
  try {
    files = (await readdir(dir)).length;
  } catch {
    files = 0;
  }
  return { dir, files, last: backups[0] ?? null, count: backups.length };
}

export async function usbExportAvailable(): Promise<boolean> {
  // A USB export target is only "available" when a directory has been mounted.
  if (!env.USB_EXPORT_DIR) return false;
  try {
    const dir = await stat(env.USB_EXPORT_DIR);
    return dir.isDirectory();
  } catch {
    return false;
  }
}

/** List the backup files on disk (most recent first). */
export async function listBackupFiles(): Promise<{ name: string; size: number; modifiedAt: Date }[]> {
  try {
    const dir = backupDir();
    const names = await readdir(dir);
    const out = await Promise.all(
      names.map(async (name) => {
        const st = await stat(path.join(dir, name)).catch(() => null);
        return st && st.isFile() ? { name, size: st.size, modifiedAt: st.mtime } : null;
      }),
    );
    return out
      .filter((f): f is { name: string; size: number; modifiedAt: Date } => f !== null)
      .sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
  } catch {
    return [];
  }
}

/** Resolve a user-supplied file name to an absolute path, refusing traversal. */
export function resolveBackupFile(name: string): string {
  const dir = backupDir();
  const resolved = path.resolve(dir, name);
  if (resolved !== path.join(dir, path.basename(name))) {
    throw ApiError.badRequest("Invalid backup file name");
  }
  return resolved;
}

/** Export the most recent backup to the configured USB mount. */
export async function exportToUsb(opts: { restaurantId: string; actorId: string; fileName?: string }) {
  const rec = await runBackup({ restaurantId: opts.restaurantId, kind: "USB", actorId: opts.actorId });
  if (rec.status !== "SUCCESS" || !rec.file) return rec;

  const target = env.USB_EXPORT_DIR;
  if (!target) throw ApiError.badRequest("USB_EXPORT_DIR is not configured");
  await mkdir(target, { recursive: true });
  const dest = path.join(target, path.basename(rec.file));
  await copyFile(rec.file, dest);
  return prisma.backupRun.update({ where: { id: rec.id }, data: { note: `exported to ${dest}` } });
}

/**
 * Restore the database from a pg_dump .sql backup. A fresh dump is taken first
 * so a mistaken restore can itself be undone. The restore runs in a single
 * transaction; any SQL error rolls the whole thing back.
 */
export async function restoreFromSql(name: string, actorId: string) {
  const file = resolveBackupFile(name);
  const st = await stat(file).catch(() => null);
  if (!st || !st.isFile()) throw ApiError.notFound("Backup file not found");
  if (!name.endsWith(".sql")) throw ApiError.badRequest("Only .sql pg_dump backups can be restored automatically");

  const pre = await produceDump("pre-restore").catch(() => null);

  const result = await run("psql", [
    "--dbname",
    databaseUrl(),
    "--set",
    "ON_ERROR_STOP=1",
    "--single-transaction",
    "--file",
    file,
  ]);
  const ok = result.code === 0;
  await prisma.backupRun.create({
    data: {
      restaurantId: (await prisma.restaurant.findFirst())?.id ?? "",
      kind: "MANUAL",
      status: ok ? "SUCCESS" : "FAILED",
      file,
      note: ok ? `restored by ${actorId}` : `restore failed: ${result.stderr.slice(0, 400)}`,
    },
  });
  if (!ok) throw new ApiError(500, "RESTORE_FAILED", `Restore failed: ${result.stderr.slice(0, 400)}`);
  return { restored: name, bytes: st.size, preRestoreBackup: pre?.file ?? null };
}
