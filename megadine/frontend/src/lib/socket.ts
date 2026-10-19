import { io, type Socket } from "socket.io-client";
import { getToken } from "./api";

let socket: Socket | null = null;

export function connectSocket(): Socket {
  if (socket && socket.connected) return socket;
  const url = import.meta.env.VITE_SOCKET_URL || window.location.origin;
  socket = io(url, {
    auth: { token: getToken() },
    transports: ["websocket", "polling"],
  });
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

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
