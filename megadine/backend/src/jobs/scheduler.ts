import { runBackup, pruneBackups } from "../lib/backup.js";

const NIGHTLY_HOUR = 3;
const NIGHTLY_MINUTE = 30;

function msUntilNextRun(): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(NIGHTLY_HOUR, NIGHTLY_MINUTE, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

/** Schedules the automated nightly backup (PRD MEGA-3 backup requirement). */
export function startScheduler() {
  const schedule = () => {
    const delay = msUntilNextRun();
    setTimeout(async () => {
      try {
        const rec = await runBackup({ kind: "AUTOMATIC", actorId: "system" });
        console.log(`[backup] nightly backup ${rec.status} -> ${rec.file ?? rec.note}`);
        await pruneBackups();
      } catch (err) {
        console.error("[backup] nightly backup failed", err);
      }
      schedule();
    }, delay).unref?.();
  };
  schedule();
  console.log(`[backup] nightly scheduler armed for ${NIGHTLY_HOUR}:${String(NIGHTLY_MINUTE).padStart(2, "0")}`);
}
