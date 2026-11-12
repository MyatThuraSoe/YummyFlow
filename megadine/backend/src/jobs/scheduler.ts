import { runBackup, pruneBackups } from "../lib/backup.js";
import { prisma } from "../lib/prisma.js";
import { getBusinessTimezone, zonedParts, zonedTimeToUtc } from "../lib/businessDay.js";

const NIGHTLY_HOUR = 3;
const NIGHTLY_MINUTE = 30;

/** The restaurant zone (falls back to the configured/server zone). */
async function currentTimezone(): Promise<string> {
  try {
    const restaurant = await prisma.restaurant.findFirst({ select: { timezone: true } });
    return restaurant?.timezone ?? getBusinessTimezone();
  } catch {
    return getBusinessTimezone();
  }
}

/** Milliseconds until the next 03:30 in the restaurant's own time zone. */
function msUntilNextRun(timezone: string): number {
  const now = new Date();
  const p = zonedParts(now, timezone);
  let target = zonedTimeToUtc(timezone, p.y, p.m, p.d, NIGHTLY_HOUR, NIGHTLY_MINUTE);
  if (target.getTime() <= now.getTime()) {
    const next = new Date(Date.UTC(p.y, p.m - 1, p.d));
    next.setUTCDate(next.getUTCDate() + 1);
    target = zonedTimeToUtc(timezone, next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), NIGHTLY_HOUR, NIGHTLY_MINUTE);
  }
  return target.getTime() - now.getTime();
}

/** Schedules the automated nightly backup (MEGA-3 backup requirement). */
export function startScheduler() {
  const schedule = () => {
    void currentTimezone().then((timezone) => {
      const delay = msUntilNextRun(timezone);
      setTimeout(async () => {
        try {
          const rec = await runBackup({ kind: "AUTOMATIC", actorId: "system" });
          console.log(`[backup] nightly backup ${rec.status} -> ${rec.file ?? rec.note}`);
          await pruneBackups();
          // Reset sold-out flags at the start of a new business day (F-29).
          await prisma.menuItem.updateMany({ data: { isAvailable: true } });
        } catch (err) {
          console.error("[backup] nightly backup failed", err);
        }
        schedule();
      }, delay).unref?.();
      console.log(`[backup] nightly scheduler armed for ${NIGHTLY_HOUR}:${String(NIGHTLY_MINUTE).padStart(2, "0")} ${timezone}`);
    });
  };
  schedule();
}
