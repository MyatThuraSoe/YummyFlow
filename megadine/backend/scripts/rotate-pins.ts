/**
 * Rotate staff PINs on existing users from the PIN_<ROLE> env vars
 * (non-destructive — does not touch orders, menu, or shifts).
 *
 * Run:  npx tsx scripts/rotate-pins.ts
 * Reads PIN_OWNER / PIN_ADMIN / PIN_CASHIER / PIN_WAITER / PIN_KITCHEN.
 */
import { prisma } from "../src/lib/prisma.js";
import { hashPin } from "../src/lib/auth.js";

const roles = ["OWNER", "ADMIN", "CASHIER", "WAITER", "KITCHEN"] as const;

for (const role of roles) {
  const pin = process.env[`PIN_${role}`];
  if (!pin) {
    console.log(`${role}: no PIN_${role} set — skipped`);
    continue;
  }
  const user = await prisma.user.findFirst({ where: { role } });
  if (!user) {
    console.log(`${role}: no user found — skipped`);
    continue;
  }
  await prisma.user.update({ where: { id: user.id }, data: { pinHash: await hashPin(pin) } });
  console.log(`${role} (${user.name}) PIN updated`);
}

await prisma.$disconnect();
