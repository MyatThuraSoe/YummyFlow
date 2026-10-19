import type { Server as HttpServer } from "node:http";
import { Server as IOServer, type Socket } from "socket.io";
import { hashToken } from "./auth.js";
import { prisma } from "./prisma.js";
import { env } from "./env.js";
import type { Role } from "@prisma/client";

let io: IOServer | null = null;

export const EVENTS = {
  ORDER_CREATED: "order:created",
  ORDER_UPDATED: "order:updated",
  ORDER_COMPLETED: "order:completed",
  KITCHEN_NEW: "kitchen:new",
  KITCHEN_UPDATED: "kitchen:updated",
  KITCHEN_OVERDUE: "kitchen:overdue",
  ORDER_ALL_READY: "order:all-ready",
  TABLE_UPDATED: "table:updated",
  RESERVATION_UPDATED: "reservation:updated",
  RESERVATION_REMINDER: "reservation:reminder",
  MENU_ITEM_86: "menu:item86",
  SHIFT_UPDATED: "shift:updated",
  INVENTORY_LOW: "inventory:low",
} as const;

const roleRoom = (role: Role) => `role:${role}`;
export const WORKSPACE_ROOM = "workspace"; // all authenticated staff

export function initSocket(httpServer: HttpServer): IOServer {
  io = new IOServer(httpServer, {
    cors: { origin: env.ALLOWED_ORIGINS, credentials: true },
  });

  io.use(async (socket: Socket, next) => {
    try {
      const token =
        (socket.handshake.auth?.token as string | undefined) ||
        (socket.handshake.headers["x-session-token"] as string | undefined);
      if (!token) return next(new Error("unauthorized"));
      const session = await prisma.session.findUnique({
        where: { tokenHash: hashToken(token) },
        include: { user: true },
      });
      if (!session || session.expiresAt < new Date() || !session.user.isActive) {
        return next(new Error("unauthorized"));
      }
      socket.data.userId = session.userId;
      socket.data.role = session.user.role as Role;
      socket.data.restaurantId = session.user.restaurantId;
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const role = socket.data.role as Role;
    socket.join(WORKSPACE_ROOM);
    socket.join(roleRoom(role));
    socket.join(`restaurant:${socket.data.restaurantId}`);
  });

  void attachRedisAdapter(io);

  return io;
}

/**
 * Optional: fan out socket events across processes via Redis pub/sub. Enabled
 * only when REDIS_URL is set; silently skipped if the optional packages or the
 * Redis server are unavailable (single-process mode still works).
 */
async function attachRedisAdapter(server: IOServer): Promise<void> {
  if (!env.REDIS_URL) return;
  try {
    const { createClient } = await import("redis");
    const { createAdapter } = await import("@socket.io/redis-adapter");
    const pub = createClient({ url: env.REDIS_URL });
    const sub = pub.duplicate();
    pub.on("error", () => {});
    // @ts-expect-error duplicate() returns a client with the same API
    sub.on("error", () => {});
    await pub.connect();
    // @ts-expect-error duplicate() returns a client with the same API
    await sub.connect();
    server.adapter(createAdapter(pub as any, sub as any) as never);
    console.log("[socket] Redis adapter attached");
  } catch (e) {
    console.warn("[socket] Redis adapter unavailable, running single-process:", e instanceof Error ? e.message : e);
  }
}

export function emitToWorkspace(event: string, payload: unknown) {
  io?.to(WORKSPACE_ROOM).emit(event, payload);
}

export function emitToRole(role: Role, event: string, payload: unknown) {
  io?.to(roleRoom(role)).emit(event, payload);
}

export function getIO(): IOServer | null {
  return io;
}
