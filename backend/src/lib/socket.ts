import { Server as SocketIOServer } from "socket.io";
import type { Server as HTTPServer } from "http";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "./auth";

let io: SocketIOServer;

export const initSocket = (server: HTTPServer) => {
  io = new SocketIOServer(server, {
    cors: {
      origin: process.env.CLIENT_URL || "http://localhost:5173",
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  /**
   * Reject any socket that cannot present a valid session.
   *
   * The CORS block above only constrains BROWSERS. A `curl`, a Python client or
   * a Node script ignores it completely, and because there were no rooms every
   * connected socket sat in every broadcast implicitly. That leaked live guest
   * names and booking times (`new-reservation`, `status-reservation`) and the
   * revenue headline from the AI briefing to anyone who could open a socket.
   *
   * `credentials: true` is only useful now that we actually check the cookie:
   * the browser is explicitly allowed to send it with the handshake.
   */
  io.use(async (socket, next) => {
    try {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(socket.handshake.headers),
      });

      if (!session?.user) {
        return next(new Error("Unauthorized: a valid session is required"));
      }

      socket.data.user = {
        id: session.user.id,
        // The admin plugin adds `role` to the session user; the cast mirrors
        // what checkRole does.
        role: (session.user as { role?: string }).role,
      };
      return next();
    } catch (error) {
      console.error("Socket auth error:", error);
      return next(new Error("Unauthorized: session check failed"));
    }
  });

  io.on("connection", (socket) => {
    console.log(`🔌 Client connected: ${socket.id}`);

    // You can add rooms here later (e.g., socket.join("kitchen"))

    socket.on("disconnect", () => {
      console.log(`❌ Client disconnected: ${socket.id}`);
    });
  });

  if (process.env.NODE_ENV === "development" && io) {
    console.log("✅ Socket.IO initialized");
  }
  return io;
};

export const getIO = () => {
  if (!io) {
    throw new Error(
      "Socket.IO not initialized. Call initSocket(server) first.",
    );
  }

  return io;
};
