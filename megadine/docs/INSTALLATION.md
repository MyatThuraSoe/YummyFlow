# MegaDine POS — Installation & Operations

Offline-first, LAN-deployed restaurant POS (Basic tier). This document covers
installation, day-to-day operation, and the **backup / restore runbook**.

---

## 1. Requirements

- Docker Desktop (Windows/macOS) or Docker Engine + Compose v2 (Linux)
- One host machine ("server") on the restaurant LAN, e.g. `192.168.1.10`
- Terminals (tablets/PCs) on the same LAN with a modern browser

Everything (PostgreSQL, Redis, API, web app) runs via `docker compose`.

---

## 2. First-time install

```bash
git clone <repo> && cd megadine
cp .env.example .env        # then edit values (see below)
docker compose up -d --build
```

The backend container automatically runs `prisma migrate deploy` on start.
Then seed the database (roles, users, demo menu) once:

```bash
docker compose exec backend npm run seed
```

Default credentials (change immediately in **Admin → Staff**):

| Role    | Login                     | PIN  |
|---------|---------------------------|------|
| Owner   | owner@megadine.local      | 0000 |
| Admin   | admin@megadine.local      | 4444 |
| Cashier | (terminal user)           | 1111 |
| Waiter  | (terminal user)           | 2222 |
| Kitchen | (terminal user)           | 3333 |

### Key `.env` values

- `DATABASE_URL` — Postgres connection (compose overrides this internally)
- `ALLOWED_ORIGINS` — set to the URL staff open, e.g. `http://192.168.1.10:5173`
- `PRINTER_MODE` — `simulate` (default) or `tcp` for real thermal printers
- `RECEIPT_PRINTER_IP` / `KITCHEN_PRINTER_IP` — printer IPs when `PRINTER_MODE=tcp`
- `BACKUP_DIR` — host path for database dumps (default `./backups`)
- `USB_EXPORT_DIR` — path of a mounted USB stick for off-site exports (optional)
- `BACKUP_RETENTION_DAYS` — auto-prune backups older than N days
- `SESSION_TTL_HOURS` / `MAX_PIN_ATTEMPTS` / `LOCKOUT_MINUTES` — auth hardening
- `COOKIE_SECURE` — set `true` **only** behind HTTPS. Leave `false` (default) for plain-HTTP LAN installs, otherwise the browser drops the session cookie.
- `REDIS_URL` — enables multi-process socket fan-out (optional, single process otherwise)

Access the app:

- Staff terminals: `http://<server-ip>:5173`
- API health: `http://<server-ip>:3001/api/v1/health`

---

## 3. Daily operation

1. **Open shift** (Admin → Shifts & Z) with the drawer's starting cash.
2. Ring sales on the POS; send orders to the kitchen display.
3. Take payments (cash / card / split); receipts print automatically.
4. **Close shift** — enter counted cash; the variance is recorded.
5. **Z-report** (Admin → Shifts & Z) — review sales, then **Close business day**
   to lock the day into the `BusinessDayClose` ledger.

Business day rolls over at the configured cutoff (default 04:00), so late-night
sales count toward the previous day.

---

## 4. Backup

Backups are plain `pg_dump` SQL files written to `BACKUP_DIR` (mounted as
`/app/backups` in the container, `./backend/backups` on the host).

- **Manual backup UI:** Admin → Backup → *Create backup* (writes a timestamped `.sql`)
- **Export off-site:** with a USB stick mounted at `USB_EXPORT_DIR`, click
  *Export to USB* — the newest dump is copied to the stick.
- **Schedule (host cron / Task Scheduler):**

  ```bash
  docker compose exec -T backend node dist/scripts/backup.js   # or the API route
  ```

Recommended: copy the newest `.sql` to USB **daily** and keep at least the last
7 days off-site.

---

## 5. Restore runbook (MEGA-3.5.4)

> **Do not** restore over a running system blind. Follow every step in order.

### 5.1 Pick the dump

```bash
# On the host: list available dumps
ls -lh backend/backups/*.sql
```

Or use **Admin → Backup → Files on disk** and note the desired filename.

### 5.2 Put the app into maintenance mode

```bash
docker compose stop frontend backend
```

This prevents writes during the restore. PostgreSQL and Redis stay up.

### 5.3 Restore the database

**Option A — from the Admin UI** (fastest):
1. Start the backend only: `docker compose up -d backend`
2. Admin → Backup → *Files on disk* → **Restore** next to the target file,
   tick **confirm**. The API streams the `.sql` into `psql` inside the DB container.
3. Verify the success toast, then continue to 5.4.

**Option B — from the command line** (works when the app is down):

```bash
docker compose exec -T postgres \
  psql -U megadine -d megadine_pos \
  < backend/backups/megadine_2026-06-10_040000.sql
```

> The dump is created with `--clean --if-exists`, so it drops and recreates
> objects; existing data is replaced entirely.

### 5.4 Re-apply the schema and restart

```bash
docker compose run --rm backend npx prisma migrate deploy
docker compose up -d
```

### 5.5 Verify

1. Log in to `http://<server-ip>:5173`.
2. Check Admin → Reports (Dashboard) loads and recent orders/tables are visible.
3. Ring a test order and void it; confirm the shift cash total matches.
4. Confirm printers respond (POS reprint button).

### 5.6 Roll back if the restore is wrong

Keep the previous dump on hand — repeat 5.2–5.5 with that file. Because restores
are destructive, always export the *current* dump to USB **before** restoring.

---

## 6. Upgrades

```bash
git pull
docker compose build
docker compose up -d          # migrate deploy runs automatically
```

Take a backup first (§4). Migrations are additive; the new `BusinessDayClose`
table is created on first start after upgrading.

---

## 7. Development & testing

```bash
# Backend
cd backend
npm run typecheck      # TS typecheck
npm run lint           # ESLint (flat config) / Prettier via `npm run format`
npm test               # unit tests (money, totals, business-day, plan limits)
npm run verify         # full Basic exit-gate, needs seeded DB + Docker DB up

# Frontend
cd frontend
npm run typecheck
npm run lint
npm run build
npm run test:e2e       # Playwright UI smoke tests (boots `vite preview`)
```

Unit tests use Node's built-in test runner (no extra framework). CI (GitHub
Actions `.github/workflows/megadine-ci.yml`) runs the full gate on every push:
backend typecheck → lint → unit tests → build → migrate+seed → verify, and
frontend typecheck → lint → build → Playwright smoke tests.

---

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| `npipe ... cannot find the file` | Start Docker Desktop / daemon |
| Backend loops "can't reach database" | `docker compose ps`; wait for Postgres healthcheck |
| Terminals show **Offline** but LAN is up | Check `ALLOWED_ORIGINS` matches the URL staff use |
| Socket badge stuck on **Reconnecting** | Confirm `REDIS_URL` (if set) points to a running Redis, or unset it |
| Receipts print in the console | `PRINTER_MODE=simulate`; set `tcp` + printer IPs |
| Queued orders never sync | Terminal has no route to the server; check Wi-Fi/VLAN |
