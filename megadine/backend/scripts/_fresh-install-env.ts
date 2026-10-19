// Point the fresh-install verification at a throwaway PostgreSQL schema so the
// first-run setup path can be exercised without touching the seeded
// development data. Imported first so DATABASE_URL is primed before env.ts /
// Prisma are evaluated (dotenv never overrides already-set variables).
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, "../.env") });

const base = process.env.DATABASE_URL ?? "postgresql://megadine:megadine_secure_2026@localhost:5432/megadine_pos";
process.env.DATABASE_URL = `${base.split("?")[0]}?schema=fresh_install_verify`;

export {};
