import type { Role } from "@prisma/client";

export interface AuthContext {
  userId: string;
  role: Role;
  restaurantId: string;
  name: string;
  sessionId: string;
  terminalId: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
      validated?: { body: unknown; query: unknown; params: unknown };
    }
  }
}

export {};
