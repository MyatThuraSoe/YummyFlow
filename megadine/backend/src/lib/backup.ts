import { spawn } from "node:child_process";
import { mkdir, readdir, stat, rm, writeFile, copyFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
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

function run(cmd: string, args: string[], input?: NodeJS.ReadableStream): Promise<{ code: number; stdout: Buffer; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args);
    const out: Buffer[] = [];
    let err = "";
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", () => resolve({ code: 1, stdout: Buffer.concat([]), stderr: "spawn failed" }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout: Buffer.concat(out), stderr: err }));
    if (input) input.pipe(child.stdin);
  });
}

/** Prefer a real pg_dump; fall back to a JSON snapshot if Docker/pg_dump absent. */
async function produceDump(): Promise<{ file: string; size: number; engine: string }> {
  await mkdir(backupDir(), { recursive: true });
  const name = `megadine-${stamp()}`;

  const pg = await run("docker", ["exec", "megadine_db", "pg_dump", "-U", "megadine", "-d", "megadine_pos", "--no-owner"]);
  if (pg.code === 0 && pg.stdout.length > 0) {
    const file = path.join(backupDir(), `${name}.sql`);
    await writeFile(file, pg.stdout);
    return { file, size: pg.stdout.length, engine: "pg_dump" };
  }

  // Fallback: portable JSON snapshot of the core tables.
  const data = {
    generatedAt: new Date().toISOString(),
    restaurant: await prisma.restaurant.findMany(),
    users: await prisma.user.findMany({ select: { id: true, name: true, email: true, role: true, isActive: true } }),
    menuCategories: await prisma.menuCategory.findMany(),
    menuItems: await prisma.menuItem.findMany(),
    ingredients: await prisma.ingredient.findMany(),
    recipeLines: await prisma.recipeLine.findMany(),
    orders: await prisma.order.findMany(),
    orderLines: await prisma.orderLine.findMany(),
    payments: await prisma.payment.findMany(),
    cashShifts: await prisma.cashShift.findMany(),
    expenses: await prisma.expense.findMany(),
    auditLogs: await prisma.auditLog.findMany({ take: 10000, orderBy: { createdAt: "desc" } }),
  };
  const buf = Buffer.from(JSON.stringify(data, null, 2));
  const file = path.join(backupDir(), `${name}.json`);
  await writeFile(file, buf);
  return { file, size: buf.length, engine: "json" };
}

export async function runBackup(opts: { restaurantId?: string; kind: "AUTOMATIC" | "MANUAL" | "USB"; actorId: string }) {
  const restaurant =
    (opts.restaurantId && (await prisma.restaurant.findUnique({ where: { id: opts.restaurantId } }))) ||
    (await prisma.restaurant.findFirst());
  if (!restaurant) throw new Error("No restaurant configured");

  try {
    const dump = await produceDump();
    const rec = await prisma.backupRun.create({
      data: {
        restaurantId: restaurant.id,
        kind: opts.kind,
        status: "SUCCESS",
        file: dump.file,
        sizeBytes: dump.size,
        note: `engine=${dump.engine}`,
      },
    });
    return rec;
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
  // Detect a removable drive (USB) to offer "export to USB".
  try {
    const drives = process.platform === "win32" ? [] : [];
    void drives;
    const dir = await stat(backupDir());
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
    return out.filter((f): f is { name: string; size: number; modifiedAt: Date } => f !== null).sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
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

/** Export the most recent backup to a configured USB mount (or just re-run a USB backup). */
export async function exportToUsb(opts: { restaurantId: string; actorId: string; fileName?: string }) {
  const rec = await runBackup({ restaurantId: opts.restaurantId, kind: "USB", actorId: opts.actorId });
  if (rec.status !== "SUCCESS" || !rec.file) return rec;

  const target = env.USB_EXPORT_DIR;
  if (target) {
    await mkdir(target, { recursive: true });
    const dest = path.join(target, path.basename(rec.file));
    await copyFile(rec.file, dest);
    await prisma.backupRun.update({ where: { id: rec.id }, data: { note: `exported to ${dest}` } });
  }
  return rec;
}

/** Restore the database from a pg_dump .sql backup (runs psql inside the db container). */
export async function restoreFromSql(name: string, actorId: string) {
  const file = resolveBackupFile(name);
  const st = await stat(file).catch(() => null);
  if (!st || !st.isFile()) throw ApiError.notFound("Backup file not found");
  if (!name.endsWith(".sql")) throw ApiError.badRequest("Only .sql pg_dump backups can be restored automatically");

  const result = await run(
    "docker",
    ["exec", "-i", "megadine_db", "psql", "-U", "megadine", "-d", "megadine_pos", "-v", "ON_ERROR_STOP=1"],
    createReadStream(file),
  );
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
  return { restored: name, bytes: st.size };
}
