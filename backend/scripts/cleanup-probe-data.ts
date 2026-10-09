/**
 * Removes the throwaway users and rows created by `verify:notifications` and
 * `verify:reservations`, and trims accumulated test briefings.
 *
 * Only touches accounts whose email matches the probe patterns
 * (e2e.probe.* / e2e.victim.* / resv.probe.* / guest.probe.*), so it is safe to
 * run against a development database that also holds real data.
 *
 *   cd backend && npm run verify:cleanup
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";

const PROBE = /^(e2e\.probe|e2e\.victim|resv\.probe|guest\.probe)\./;

const users = await prisma.user.findMany({ select: { id: true, email: true } });
const doomed = users.filter((u) => PROBE.test(u.email));
console.log(`probe users to remove: ${doomed.length}`);

const ids = doomed.map((u) => u.id);
if (ids.length) {
  await prisma.pushSubscription.deleteMany({ where: { userId: { in: ids } } });
  await prisma.notificationLog.deleteMany({ where: { userId: { in: ids } } });
  await prisma.reservation.deleteMany({ where: { userId: { in: ids } } });
  await prisma.activitiesLog.deleteMany({ where: { userId: { in: ids } } });
  await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  await prisma.account.deleteMany({ where: { userId: { in: ids } } });
  const del = await prisma.user.deleteMany({ where: { id: { in: ids } } });
  console.log(`deleted users: ${del.count}`);
}

// Notification logs addressed to probe emails (e.g. guest reservation mails)
const logDel = await prisma.notificationLog.deleteMany({
  where: { recipient: { contains: "probe." } },
});
console.log(`deleted probe notification logs: ${logDel.count}`);

// Keep only the two most recent briefings (one per kind is what the UI shows).
const briefings = await prisma.briefing.findMany({
  orderBy: { createdAt: "desc" },
  select: { id: true },
});
if (briefings.length > 2) {
  const trim = await prisma.briefing.deleteMany({
    where: { id: { in: briefings.slice(2).map((b) => b.id) } },
  });
  console.log(`trimmed briefings: ${trim.count}`);
}

// Drop stale reservation rows left over from probing
const staleResv = await prisma.reservation.deleteMany({
  where: { customerName: { in: ["Guest Probe", "Resv Probe"] } },
});
console.log(`deleted probe reservations: ${staleResv.count}`);

console.log("\n--- final counts ---");
console.log("users        :", await prisma.user.count());
console.log("reservations :", await prisma.reservation.count());
console.log("orders       :", await prisma.order.count());
console.log("briefings    :", await prisma.briefing.count());
console.log("notif logs   :", await prisma.notificationLog.count());
console.log("push subs    :", await prisma.pushSubscription.count());

await prisma.$disconnect();
process.exit(0);
