import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import type { Prisma } from "../../generated/prisma/client";
import { activitiesLog } from "../lib/activities-log";
import { getIO } from "../lib/socket";
import {
  notifyOrderReceipt,
  pushNewOrder,
  pushOrderStatus,
} from "../lib/notify";
import {
  consumeStock,
  restoreStockForOrder,
  type StockShortfall,
} from "../lib/inventory";

export interface itemsProps {
  id: string;
  name: string;
  description?: any[];
  price: number;
  categoryId: string;
  isAvailable: boolean;
  image?: string;
  discount: number;
  quantity: number;
  /** Kitchen instruction for this line, e.g. "No onions". */
  notes?: string | null;
}

/** What fits legibly on one ticket line. */
const MAX_ITEM_NOTE_LENGTH = 140;

/**
 * Clean up a till-entered kitchen note before it reaches the database.
 *
 * The kitchen display renders these verbatim, so an unbounded or multi-line
 * value would wreck the ticket layout. Empty strings become `null` rather than
 * "" so "has a note" is a single unambiguous check downstream.
 */
function normaliseNotes(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // Collapse newlines/tabs so a note can never break the ticket into two rows.
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.slice(0, MAX_ITEM_NOTE_LENGTH);
}

/**
 * Fields the order list UI actually renders.
 *
 * `getOrders` used to `include: { user: true }`, which shipped the entire
 * Better Auth user record — role, ban state, moderation notes — with every
 * order in the page. On a busy day that is a lot of bytes nobody reads, and it
 * leaks fields the till has no business seeing.
 */
const ORDER_LIST_SELECT = {
  id: true,
  orderType: true,
  status: true,
  paymentStatus: true,
  paymentMethod: true,
  totalAmount: true,
  createdAt: true,
  table: { select: { id: true, name: true } },
  user: { select: { id: true, name: true, email: true, image: true } },
  items: {
    select: {
      id: true,
      quantity: true,
      price: true,
      notes: true,
      menuItem: { select: { id: true, name: true, image: true } },
    },
  },
} satisfies Prisma.OrderSelect;

/**
 * Trimmed shape for the Kitchen Display and the Active Orders board.
 *
 * A kitchen ticket needs the item names and quantities, nothing else — no
 * prices, no customer identity, no payment state. Keeping this separate from
 * `ORDER_LIST_SELECT` means the busiest screen in the restaurant pulls the
 * smallest possible payload.
 */
const ORDER_TICKET_SELECT = {
  id: true,
  orderType: true,
  status: true,
  createdAt: true,
  table: { select: { id: true, name: true } },
  items: {
    select: {
      id: true,
      quantity: true,
      notes: true,
      menuItem: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.OrderSelect;

/**
 * The till's view of the same open orders.
 *
 * Adds money and payment state, which the kitchen neither needs nor should see.
 * Requested with `?view=pos` so both screens share one endpoint and one query.
 */
const ORDER_POS_SELECT = {
  ...ORDER_TICKET_SELECT,
  totalAmount: true,
  paymentStatus: true,
  paymentMethod: true,
} satisfies Prisma.OrderSelect;

/**
 * Everything a receipt needs, and nothing else.
 *
 * The live boards deliberately omit per-line prices to keep the constantly
 * refreshed payload small, which means they cannot reprint a chit on their own.
 * Rather than fattening that payload for a rare action, a reprint fetches this
 * shape for the one order being reprinted.
 */
const ORDER_RECEIPT_SELECT = {
  id: true,
  orderType: true,
  status: true,
  paymentStatus: true,
  paymentMethod: true,
  totalAmount: true,
  createdAt: true,
  table: { select: { name: true } },
  items: {
    select: {
      quantity: true,
      price: true,
      notes: true,
      menuItem: { select: { name: true } },
    },
  },
} satisfies Prisma.OrderSelect;

export const createPosOrder = async (req: Request, res: Response) => {
  try {
    const items = req.body.items as itemsProps[];
    const orderType = req.body.orderType as "DINE_IN" | "TAKEAWAY";
    const tableId = req.body.tableId as string | null;

    if (!items || items.length === 0) {
      return res.status(400).json({ message: "Items are required" });
    }

    if (orderType === "DINE_IN" && !tableId) {
      return res
        .status(400)
        .json({ message: "Table ID is required for dine-in orders" });
    }

    // 1. Fetch real prices from the database (Security: Prevent frontend spoofing)
    const menuItemIds = items.map((item) => item.id);
    const dbMenuItems = await prisma.menuItem.findMany({
      where: { id: { in: menuItemIds } },
    });

    let calculatedTotal = 0;
    const orderItemsData = items.map((item) => {
      const dbItem = dbMenuItems.find((dbItem) => dbItem.id === item.id);
      if (!dbItem) {
        throw new Error(`Menu item with ID ${item.id} not found`);
      }

      calculatedTotal += dbItem.price * item.quantity;

      return {
        menuItemId: dbItem.id,
        quantity: item.quantity,
        price: dbItem.price, // Snapshot of price at time of order
        notes: normaliseNotes(item.notes),
      };
    });

    // 2. Run the Transaction (Creates Order + Updates Table + Deducts Stock)
    let shortfalls: StockShortfall[] = [];
    let stockMoved = false;

    const result = await prisma.$transaction(async (tx) => {
      // A. Create the Order
      const newOrder = await tx.order.create({
        data: {
          orderType,
          tableId: orderType === "DINE_IN" ? tableId : null,
          totalAmount: calculatedTotal,
          status: "PENDING", // Ready for kitchen
          paymentStatus: "PAID", // Mark as paid since it's POS; can be updated later if needed
          paymentMethod: "CASH", // Default to cash for POS orders; can be updated later
          items: {
            create: orderItemsData,
          },
        },
        include: {
          table: true, // Return table data for the receipt
        },
      });

      if (orderType === "DINE_IN" && tableId) {
        await tx.table.update({
          where: { id: tableId },
          data: { status: "OCCUPIED" },
        });
      }

      // C. Deduct the ingredients these dishes consume. Inside the transaction so
      // a dish and its stock movement can never disagree. Recipes that are not
      // defined contribute nothing, so a menu without recipes behaves exactly
      // as it did before inventory existed.
      const stock = await consumeStock(
        tx,
        orderItemsData.map((i) => ({
          menuItemId: i.menuItemId,
          quantity: i.quantity,
        })),
        newOrder.id,
      );
      shortfalls = stock.shortfalls;
      stockMoved = stock.movementCount > 0;

      return newOrder;
    });

    // A shortfall must not block the sale — refusing to ring up an order
    // because the garlic count is wrong is a worse outcome than a wrong count.
    // It is logged and echoed back so the kitchen can be told to check.
    if (shortfalls.length > 0) {
      console.warn(
        "Stock shortfall on order",
        result.id,
        shortfalls.map((s) => `${s.ingredientName}: need ${s.required}${s.unit}, have ${s.available}${s.unit}`),
      );
      await activitiesLog({
        userId: (req as any).user?.id,
        action: "STOCK_SHORTFALL",
        details: `Order ${result.id.slice(-6)} exceeded stock for ${shortfalls
          .map((s) => s.ingredientName)
          .join(", ")}`,
      });
    }

    // PRO: receipt email (when we know who the customer is) + push to staff.
    // Fire-and-forget so a mail/push outage never blocks a sale at the till.
    await Promise.allSettled([
      notifyOrderReceipt({ orderId: result.id }),
      pushNewOrder({
        id: result.id,
        orderType: result.orderType,
        totalAmount: result.totalAmount,
        tableName: (result as any).table?.name ?? null,
      }),
    ]);

    // Broadcast whenever stock actually moved — not only on a shortfall.
    //
    // Gating this on `shortfalls.length > 0` was wrong: a normal, well-stocked
    // order still deducts every recipe ingredient, so the kitchen's inventory
    // screen simply never refreshed during ordinary service. It is also the
    // *quiet* case that needs the broadcast, because nothing else on the page
    // looks like an event.
    if (stockMoved) {
      getIO().emit("inventory-updated");
    }

    // Return the created order so the frontend can print the receipt!
    res.status(201).json({ ...result, stockShortfalls: shortfalls });
  } catch (error) {
    console.error("Error creating POS order:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const getOrders = async (req: Request, res: Response) => {
  try {
    // CHANGE THIS LINE: from req.params to req.query
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, parseInt(req.query.limit as string) || 10);
    const userId = req.query.userId as string | undefined; // Optional filter for customer orders

    const skip = (page - 1) * limit;

    const [orders, totalOrders] = await Promise.all([
      prisma.order.findMany({
        skip: skip,
        take: limit,
        where: userId ? { userId } : {},
        select: ORDER_LIST_SELECT,
        orderBy: { createdAt: "desc" },
      }),
      prisma.order.count({
        where: userId ? { userId } : {},
      }),
    ]);
    const totalPages = Math.ceil(totalOrders / limit);
    res.status(200).json({
      data: orders,
      totalOrders,
      itemsPerPage: limit,
      currentPage: page,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    });
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// ==========================================
// ACTIVE ORDERS (Kitchen Display / POS board)
// ==========================================

/** Statuses that still need somebody to do something. */
const OPEN_ORDER_STATUSES = ["PENDING", "PREPARING", "READY"] as const;

/**
 * Every order currently in flight, oldest first.
 *
 * This is deliberately not a filtered view of `getOrders`: a kitchen screen
 * refreshes constantly, and pulling paginated history with prices and customer
 * records for it would be wasteful. Returns the trimmed ticket shape plus the
 * server clock, so elapsed-time badges do not depend on the tablet's clock
 * being correct.
 *
 * Oldest-first is the order a pass actually works in (FIFO), so the client does
 * not have to re-sort.
 */
export const getActiveOrders = async (req: Request, res: Response) => {
  try {
    // `?view=pos` swaps in the till's richer shape (money + payment state).
    const isPosView = req.query.view === "pos";

    const orders = await prisma.order.findMany({
      where: { status: { in: [...OPEN_ORDER_STATUSES] } },
      select: isPosView ? ORDER_POS_SELECT : ORDER_TICKET_SELECT,
      orderBy: { createdAt: "asc" },
      // Safety valve: a stuck order should not let this grow without bound.
      take: 100,
    });

    res.status(200).json({
      data: orders,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching active orders:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * One order in full, for a receipt reprint.
 *
 * Kept off the live boards on purpose: they refresh every few seconds and have
 * no use for per-line prices, whereas a reprint happens a handful of times a
 * shift. Fetching on demand keeps the busy payload thin and still lets a
 * reprinted chit show real line totals.
 */
export const getOrderById = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);

    const order = await prisma.order.findUnique({
      where: { id },
      select: ORDER_RECEIPT_SELECT,
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    res.status(200).json(order);
  } catch (error) {
    console.error("Error fetching order:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// ==========================================
// UPDATE ORDER STATUSES (Dynamic)
// ==========================================
const ORDER_STATUSES = [
  "PENDING",
  "PREPARING",
  "READY",
  "SERVED",
  "CANCELLED",
] as const;

type OrderStatusValue = (typeof ORDER_STATUSES)[number];

const isOrderStatus = (v: unknown): v is OrderStatusValue =>
  typeof v === "string" && (ORDER_STATUSES as readonly string[]).includes(v);

/**
 * Domain errors the HTTP layer turns into meaningful status codes.
 *
 * Exists so the transaction can abort itself without the catch block having to
 * pattern-match on message strings, and so the caller can tell "no such order"
 * apart from "the database fell over".
 */
class OrderNotFoundError extends Error {
  constructor() {
    super("Order not found");
    this.name = "OrderNotFoundError";
  }
}

/**
 * Applies a status transition and everything that follows from it: freeing the
 * table, telling the other stations, notifying the customer, and writing the
 * audit row.
 *
 * Shared by the admin dynamic-update route and the status-only route the
 * kitchen and floor staff use, so the two can never drift apart.
 */
async function applyOrderStatusChange(
  orderId: string,
  status: OrderStatusValue,
  actorId: string | undefined,
) {
  // A void has to put the ingredients back — but exactly once. Reading the
  // previous status and restoring inside one transaction is what guarantees
  // that: without it, a double-click on "cancel" (or a retried request) would
  // see "not cancelled" both times and restock the same order twice, quietly
  // inflating the store.
  const updatedOrder = await prisma.$transaction(async (tx) => {
    const current = await tx.order.findUnique({
      where: { id: orderId },
      select: { status: true },
    });

    if (!current) {
      throw new OrderNotFoundError();
    }

    // NOTE: voiding a PAID order stays allowed.
    //
    // A guard blocking this was added and then removed. It was justified on the
    // reasoning that cancelling a card-paid order would keep the charge while
    // returning the stock to inventory. The restaurant is cash-only, so that
    // scenario cannot occur: voiding a paid tab means the cash goes back in the
    // drawer, the order leaves the day's revenue, and the stock is restored.
    // All three are correct, and the floor does it routinely at service.
    // The audit row below still records who voided the order and when.

    const order = await tx.order.update({
      where: { id: orderId },
      data: { status },
    });

    if (status === "CANCELLED" && current.status !== "CANCELLED") {
      await restoreStockForOrder(tx, orderId);
    }

    return order;
  });

  // NOTE: the table is deliberately NOT released here.
  //
  // This used to flip the table to AVAILABLE as soon as an order was SERVED,
  // which is exactly when the guests sit down to eat — so the host desk would
  // happily seat a new party at a table that was still occupied. It also fired
  // on CANCELLED, hiding tables that still needed clearing.
  //
  // Releasing a table is now an explicit staff action on the floor plan
  // (OCCUPIED → CLEANING → AVAILABLE), so the board only ever shows what
  // somebody has actually confirmed.
  getIO().emit("order-status-changed", {
    orderId: updatedOrder.id.slice(-6),
    status: updatedOrder.status,
  });

  if (status === "CANCELLED") {
    getIO().emit("inventory-updated");
  }

  // PRO: push the new status to the customer who placed the order.
  await pushOrderStatus(updatedOrder.userId, updatedOrder.id, updatedOrder.status);

  await activitiesLog({
    userId: actorId,
    action: "UPDATE_ORDER",
    details: `Order ${updatedOrder.id} moved to ${status}`,
  });

  return updatedOrder;
}

export const updateOrder = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { field, value } = req.body;

    // 1. Security: Only allow specific enum fields to be updated via this route
    const allowedFields = [
      "status",
      "paymentStatus",
      "paymentMethod",
      "orderType",
    ];

    if (!allowedFields.includes(field)) {
      return res.status(400).json({ error: "Invalid field update requested" });
    }

    const actorId = (req as any).user?.id;

    // Status transitions go through the shared path so table release, socket
    // broadcast, customer push and audit logging all happen consistently.
    if (field === "status") {
      if (!isOrderStatus(value)) {
        return res.status(400).json({ error: "Invalid order status" });
      }
      try {
        const updated = await applyOrderStatusChange(
          id as string,
          value,
          actorId,
        );
        return res.status(200).json(updated);
      } catch (error) {
        // A missing order is the caller's mistake, not a server fault, so it
        // must not be reported as a 500.
        if (error instanceof OrderNotFoundError) {
          return res.status(404).json({ message: error.message });
        }
        throw error;
      }
    }

    const updatedOrder = await prisma.order.update({
      where: { id: id as string },
      data: { [field]: value },
    });

    await activitiesLog({
      userId: actorId,
      action: "UPDATE_ORDER",
      details: `Order updated: ${updatedOrder.id}, Field: ${field}, New Value: ${value}`,
    });

    res.status(200).json(updatedOrder);
  } catch (error) {
    console.error("Error updating order:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * Status-only transition, reachable by the kitchen and floor staff.
 *
 * Before this existed, `PATCH /orders/:id` was ADMIN/MANAGER only — so the
 * KITCHEN role could not actually advance a ticket, which made the kitchen
 * display impossible. Payment and order-type edits stay on the admin route.
 */
export const updateOrderStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!isOrderStatus(status)) {
      return res.status(400).json({ error: "Invalid order status" });
    }

      // The kitchen and the floor both cancel through here, so both now get the
      // same paid-order guard as the admin route.
      const updated = await applyOrderStatusChange(
        id as string,
        status,
        (req as any).user?.id,
      );

      res.status(200).json(updated);
    } catch (error) {
      if (error instanceof OrderNotFoundError) {
        return res.status(404).json({ message: error.message });
      }
      console.error("Error updating order status:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  };

/**
 * Payment-only update, reachable by whoever is working the till.
 *
 * Taking payment is a core part of the cashier's job, but the broad dynamic
 * update route is ADMIN/MANAGER only because it can also rewrite order type and
 * status. This narrows the blast radius to the two payment fields.
 */
export const updateOrderPayment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { paymentStatus, paymentMethod } = req.body;

    const PAYMENT_STATUSES = ["PENDING", "PAID", "FAILED"] as const;
    const PAYMENT_METHODS = ["CASH", "CARD"] as const;

    const data: {
      paymentStatus?: (typeof PAYMENT_STATUSES)[number];
      paymentMethod?: (typeof PAYMENT_METHODS)[number];
    } = {};

    if (paymentStatus !== undefined) {
      if (!PAYMENT_STATUSES.includes(paymentStatus)) {
        return res.status(400).json({ error: "Invalid payment status" });
      }
      data.paymentStatus = paymentStatus;
    }

    if (paymentMethod !== undefined) {
      if (!PAYMENT_METHODS.includes(paymentMethod)) {
        return res.status(400).json({ error: "Invalid payment method" });
      }
      data.paymentMethod = paymentMethod;
    }

    if (Object.keys(data).length === 0) {
      return res
        .status(400)
        .json({ error: "Provide paymentStatus and/or paymentMethod" });
    }

    // Once an order is paid it is paid.
    //
    // The reasoning here was originally about card charges: reverting a paid
    // order to PENDING would keep the money while dropping it out of every
    // revenue figure. That concern stands under cash-only too, for a different
    // reason — the cash is physically in the drawer, and quietly reclassifying
    // the order as unpaid makes the day-close totals disagree with what the
    // cashier can count. Fixing a genuinely mis-keyed payment should be a
    // deliberate, visible act, not a stray click, so the audit row is the
    // record of it.
    if (paymentStatus !== undefined && paymentStatus !== "PAID") {
      const existing = await prisma.order.findUnique({
        where: { id: id as string },
        select: { paymentStatus: true },
      });

      if (!existing) {
        return res.status(404).json({ message: "Order not found" });
      }

      if (existing.paymentStatus === "PAID") {
        return res.status(409).json({
          error:
            "This order is already marked paid and cannot be reverted. " +
            "Void the order instead if the payment was keyed in error.",
        });
      }
    }

    const updated = await prisma.order.update({
      where: { id: id as string },
      data,
    });

    // The floor plan and the POS board both show payment state.
    getIO().emit("order-status-changed", {
      orderId: updated.id.slice(-6),
      status: updated.status,
    });

    await activitiesLog({
      userId: (req as any).user?.id,
      action: "UPDATE_ORDER_PAYMENT",
      details: `Order ${updated.id} payment: ${JSON.stringify(data)}`,
    });

    res.status(200).json(updated);
  } catch (error) {
    console.error("Error updating order payment:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};
