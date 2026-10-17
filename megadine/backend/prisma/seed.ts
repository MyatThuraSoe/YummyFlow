import { prisma } from "../src/lib/prisma.js";
import { hashPin, hashPassword } from "../src/lib/auth.js";
import { env } from "../src/lib/env.js";

async function main() {
  const force = process.argv.includes("--force");
  const existing = await prisma.restaurant.findFirst();

  if (existing && !force) {
    const userCount = await prisma.user.count({ where: { restaurantId: existing.id } });
    if (userCount > 0) {
      console.log(`Restaurant "${existing.name}" already seeded (${userCount} users). Use --force to reset.`);
      return;
    }
  }

  if (force && existing) {
    console.log("Resetting data...");
    const rid = existing.id;
    await prisma.$transaction([
      prisma.refund.deleteMany({}),
      prisma.payment.deleteMany({}),
      prisma.kitchenTicketLine.deleteMany({}),
      prisma.kitchenTicket.deleteMany({}),
      prisma.orderLineModifier.deleteMany({}),
      prisma.orderLine.deleteMany({}),
      prisma.order.deleteMany({}),
      prisma.tableSession.deleteMany({}),
      prisma.cashMovement.deleteMany({}),
      prisma.cashShift.deleteMany({}),
      prisma.stockMovement.deleteMany({}),
      prisma.recipeLine.deleteMany({}),
      prisma.ingredient.deleteMany({ where: { restaurantId: rid } }),
      prisma.modifierOption.deleteMany({}),
      prisma.modifierGroup.deleteMany({}),
      prisma.menuVariant.deleteMany({}),
      prisma.menuItem.deleteMany({}),
      prisma.menuCategory.deleteMany({ where: { restaurantId: rid } }),
      prisma.restaurantTable.deleteMany({ where: { restaurantId: rid } }),
      prisma.expense.deleteMany({ where: { restaurantId: rid } }),
      prisma.auditLog.deleteMany({ where: { restaurantId: rid } }),
      prisma.backupRun.deleteMany({ where: { restaurantId: rid } }),
      prisma.businessDayClose.deleteMany({ where: { restaurantId: rid } }),
      prisma.terminal.deleteMany({ where: { restaurantId: rid } }),
      prisma.session.deleteMany({}),
      prisma.user.deleteMany({ where: { restaurantId: rid } }),
      prisma.restaurant.deleteMany({ where: { id: rid } }),
    ]);
  }

  const restaurant = await prisma.restaurant.create({
    data: {
      name: "MegaDine Demo Bistro",
      currency: env.DEFAULT_CURRENCY,
      timezone: "Asia/Yangon",
      businessDayCutoff: env.DEFAULT_BUSINESS_DAY_CUTOFF,
      taxRate: env.DEFAULT_TAX_RATE.toFixed(4),
      taxInclusive: false,
      serviceChargePct: env.DEFAULT_SERVICE_CHARGE.toFixed(4),
      receiptHeader: "123 Main Street · Tel 09-123456789",
      receiptFooter: "Thank you for dining with us!",
      trialExpiresAt: new Date(Date.now() + 14 * 86_400_000),
    },
  });

  // ── Staff (PINs default to the demo values; override with PIN_<ROLE>) ──
  const pins = {
    OWNER: process.env.PIN_OWNER ?? "0000",
    ADMIN: process.env.PIN_ADMIN ?? "4444",
    CASHIER: process.env.PIN_CASHIER ?? "1111",
    WAITER: process.env.PIN_WAITER ?? "2222",
    KITCHEN: process.env.PIN_KITCHEN ?? "3333",
  };
  const ownerPin = await hashPin(pins.OWNER);
  const adminPin = await hashPin(pins.ADMIN);
  const cashierPin = await hashPin(pins.CASHIER);
  const waiterPin = await hashPin(pins.WAITER);
  const kitchenPin = await hashPin(pins.KITCHEN);

  await prisma.user.createMany({
    data: [
      { restaurantId: restaurant.id, name: "Olivia Owner", username: "owner", firstName: "Olivia", lastName: "Owner", email: "owner@megadine.local", role: "OWNER", pinHash: ownerPin, passwordHash: await hashPassword("owner123") },
      { restaurantId: restaurant.id, name: "Adam Admin", username: "admin", firstName: "Adam", lastName: "Admin", email: "admin@megadine.local", role: "ADMIN", pinHash: adminPin, passwordHash: await hashPassword("admin123") },
      { restaurantId: restaurant.id, name: "Cara Cashier", username: "cashier", firstName: "Cara", lastName: "Cashier", role: "CASHIER", pinHash: cashierPin },
      { restaurantId: restaurant.id, name: "Will Waiter", username: "waiter", firstName: "Will", lastName: "Waiter", role: "WAITER", pinHash: waiterPin },
      { restaurantId: restaurant.id, name: "Ken Kitchen", username: "kitchen", firstName: "Ken", lastName: "Kitchen", role: "KITCHEN", pinHash: kitchenPin },
    ],
  });

  // ── Terminals ──────────────────────────────────────────
  await prisma.terminal.createMany({
    data: [
      { restaurantId: restaurant.id, name: "POS-1", type: "POS", drawerEnabled: true },
      { restaurantId: restaurant.id, name: "KDS-1", type: "KDS" },
    ],
  });

  // ── Menu ───────────────────────────────────────────────
  const starters = await prisma.menuCategory.create({ data: { restaurantId: restaurant.id, name: "Starters", displayOrder: 1 } });
  const mains = await prisma.menuCategory.create({ data: { restaurantId: restaurant.id, name: "Mains", displayOrder: 2 } });
  const drinks = await prisma.menuCategory.create({ data: { restaurantId: restaurant.id, name: "Drinks", displayOrder: 3 } });
  const desserts = await prisma.menuCategory.create({ data: { restaurantId: restaurant.id, name: "Desserts", displayOrder: 4 } });

  const burger = await prisma.menuItem.create({
    data: {
      categoryId: mains.id,
      name: "Classic Burger",
      description: "Beef patty, cheddar, lettuce, house sauce",
      price: "8.50",
      station: "GRILL",
      modifiers: undefined,
      variants: { createMany: { data: [
        { name: "Single", priceAdjust: "0" },
        { name: "Double", priceAdjust: "3.00" },
      ] } },
      modifierGroups: {
        create: [{
          name: "Extras", minSelect: 0, maxSelect: 4,
          options: { createMany: { data: [
            { name: "Extra Cheese", price: "1.00" },
            { name: "Bacon", price: "1.50" },
            { name: "Fried Egg", price: "1.00" },
          ] } },
        }, {
          name: "Doneness", required: true, minSelect: 1, maxSelect: 1,
          options: { createMany: { data: [
            { name: "Medium", price: "0" },
            { name: "Well Done", price: "0" },
          ] } },
        }],
      },
    },
  });

  const pizza = await prisma.menuItem.create({
    data: { categoryId: mains.id, name: "Margherita Pizza", description: "Tomato, mozzarella, basil", price: "11.00", station: "FRYER",
      variants: { createMany: { data: [{ name: '10"', priceAdjust: "0" }, { name: '14"', priceAdjust: "4.00" }] } } },
  });
  const steak = await prisma.menuItem.create({ data: { categoryId: mains.id, name: "Grilled Steak", price: "18.00", station: "GRILL" } });
  const salad = await prisma.menuItem.create({ data: { categoryId: starters.id, name: "Caesar Salad", price: "6.00", station: "SALAD" } });
  const soup = await prisma.menuItem.create({ data: { categoryId: starters.id, name: "Tomato Soup", price: "5.00", station: "KITCHEN" } });
  const wings = await prisma.menuItem.create({ data: { categoryId: starters.id, name: "Buffalo Wings", price: "7.50", station: "FRYER" } });
  const coke = await prisma.menuItem.create({ data: { categoryId: drinks.id, name: "Coca-Cola", price: "2.00", station: "BAR" } });
  const beer = await prisma.menuItem.create({ data: { categoryId: drinks.id, name: "Draft Beer", price: "4.00", station: "BAR" } });
  const water = await prisma.menuItem.create({ data: { categoryId: drinks.id, name: "Mineral Water", price: "1.00", station: "BAR" } });
  const lava = await prisma.menuItem.create({ data: { categoryId: desserts.id, name: "Chocolate Lava Cake", price: "5.50", station: "DESSERT" } });
  const icecream = await prisma.menuItem.create({ data: { categoryId: desserts.id, name: "Vanilla Ice Cream", price: "3.50", station: "DESSERT" } });

  // ── Tables ─────────────────────────────────────────────
  const tableData = Array.from({ length: 12 }, (_, i) => ({
    restaurantId: restaurant.id,
    number: i + 1,
    capacity: i < 6 ? 4 : 2,
    zone: i < 6 ? "Main" : i < 10 ? "Window" : "Patio",
    positionX: (i % 4) * 120,
    positionY: Math.floor(i / 4) * 120,
  }));
  await prisma.restaurantTable.createMany({ data: tableData });

  // ── Ingredients + Recipes ──────────────────────────────
  const ing = async (name: string, stockUnit: string, stock: number, cost: number, reorder?: number) =>
    prisma.ingredient.create({
      data: {
        restaurantId: restaurant.id, name, stockUnit,
        currentStock: stock.toFixed(4), costPerUnit: cost.toFixed(4),
        reorderLevel: reorder !== undefined ? reorder.toFixed(4) : null,
      },
    });

  const beef = await ing("Beef Patty", "pc", 40, 2.2, 15);
  const bun = await ing("Burger Bun", "pc", 60, 0.5, 20);
  const cheese = await ing("Cheddar Slice", "pc", 80, 0.4, 25);
  const bacon = await ing("Bacon Strip", "pc", 50, 0.6, 20);
  const lettuce = await ing("Lettuce", "g", 3000, 0.01, 800);
  const tomato = await ing("Tomato", "g", 4000, 0.008, 1000);
  const mozzarella = await ing("Mozzarella", "g", 2500, 0.012, 800);
  const dough = await ing("Pizza Dough", "pc", 30, 1.2, 10);
  const steakMeat = await ing("Sirloin Steak", "g", 5000, 0.028, 1500);
  const potato = await ing("Potato", "g", 8000, 0.003, 2000);
  const wingsRaw = await ing("Chicken Wings", "g", 4000, 0.009, 1200);
  const tomatoSauce = await ing("Tomato Sauce", "g", 3000, 0.006, 900);
  const coca = await ing("Cola Syrup", "ml", 5000, 0.004, 1500);
  const chocolate = await ing("Chocolate", "g", 2000, 0.02, 600);

  const recipes: [string, [typeof beef, number][]][] = [
    [burger.id, [[beef, 1], [bun, 1], [cheese, 1], [lettuce, 30], [tomato, 20]]],
    [pizza.id, [[dough, 1], [mozzarella, 150], [tomatoSauce, 100]]],
    [steak.id, [[steakMeat, 250], [potato, 200]]],
    [wings.id, [[wingsRaw, 200]]],
    [salad.id, [[lettuce, 100], [cheese, 2]]],
    [soup.id, [[tomato, 150], [tomatoSauce, 80]]],
    [coke.id, [[coca, 300]]],
    [lava.id, [[chocolate, 80]]],
  ];
  for (const [menuItemId, lines] of recipes) {
    for (const [ingredient, qty] of lines) {
      await prisma.recipeLine.create({ data: { menuItemId, ingredientId: ingredient.id, quantity: qty.toFixed(4) } });
    }
  }

  // ── Sample expenses ────────────────────────────────────
  await prisma.expense.createMany({
    data: [
      { restaurantId: restaurant.id, category: "Utilities", amount: "120.00", payee: "City Power", actorId: (await prisma.user.findFirstOrThrow({ where: { restaurantId: restaurant.id, role: "OWNER" } })).id },
      { restaurantId: restaurant.id, category: "Supplies", amount: "85.50", payee: "Fresh Foods Co", actorId: (await prisma.user.findFirstOrThrow({ where: { restaurantId: restaurant.id, role: "OWNER" } })).id },
    ],
  });

  void soup; void water; void icecream; void beer; void bacon;

  console.log("Seed complete.");
  console.log(`  Owner   PIN ${pins.OWNER} (password owner123)`);
  console.log(`  Admin   PIN ${pins.ADMIN} (password admin123)`);
  console.log(`  Cashier PIN ${pins.CASHIER}`);
  console.log(`  Waiter  PIN ${pins.WAITER}`);
  console.log(`  Kitchen PIN ${pins.KITCHEN}`);
  console.log(`  Menu items: ${[burger, pizza, steak, salad, soup, wings, coke, beer, water, lava, icecream].length}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
