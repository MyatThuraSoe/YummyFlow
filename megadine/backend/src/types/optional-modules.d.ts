// Ambient declarations for optional runtime dependencies. These packages are
// declared as optionalDependencies; the socket layer loads them dynamically
// only when REDIS_URL is configured, so a missing install must not break the build.
declare module "@socket.io/redis-adapter" {
  import type { Server } from "socket.io";
  export function createAdapter(pubClient: unknown, subClient: unknown): unknown;
  export function createAdapter(pubClient: unknown, subClient: unknown, opts: unknown): unknown;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  export function createShardedAdapter(...args: unknown[]): unknown;
}
declare module "redis" {
  export function createClient(opts?: unknown): {
    connect: () => Promise<unknown>;
    duplicate: () => unknown;
    on: (event: string, cb: (...args: unknown[]) => void) => void;
  };
}
