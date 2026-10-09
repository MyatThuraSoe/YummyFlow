# DineFlow — Pro Features Implementation

This document describes the three features the README gates behind Patreon
(**email system**, **browser push notifications**, **AI briefings**) — now
implemented end to end, and how to configure and verify each one.

---

## 1. At a glance

| Feature | Backend | Frontend | Verified |
| --- | --- | --- | --- |
| 📧 Email system + templates | Nodemailer, 6 templates, outbox fallback | — (delivery log UI) | ✅ 27/27 API checks |
| 🔔 Browser push notifications | Web Push / VAPID, role fan-out | Service worker + settings page | ✅ subscribe/send/prune |
| 🤖 AI Briefings | Metrics engine + Gemini + Inngest cron | Dashboard panel | ✅ generate/list/auth |

**Design principle:** every pro feature degrades gracefully. No SMTP credentials
→ emails render to disk. No VAPID keys → push is logged as `SKIPPED`. No Gemini
key → briefings still generate from the deterministic analytics engine. The app
never breaks because a third-party service is unconfigured.

---

## 2. Email system

### Files
```
backend/src/lib/mailer.ts          transport (SMTP or outbox) + html->text
backend/src/emails/layout.ts       table-based, inline-styled shell (Outlook-safe)
backend/src/emails/templates.ts    6 branded templates
backend/src/lib/notify.ts          event orchestrator + NotificationLog writes
```

### Templates
| Template | Trigger |
| --- | --- |
| `welcome` | user signup (`databaseHooks.user.create.after`) |
| `order-receipt` | order created (POS or Stripe) |
| `reservation-confirmation` | reservation created |
| `reservation-<status>` | reservation status changed |
| `account-suspended` / `account-restored` | admin ban / unban |
| `test` | "Send test email" button |

### Two modes
- **SMTP** — used when `SMTP_HOST` and `SMTP_PORT` are set. Real delivery.
- **Outbox** (default) — `nodemailer.createTransport({ jsonTransport: true })`.
  The message is fully rendered and written to
  `backend/.mail-outbox/<timestamp>-<template>-<to>.html`, and the path is
  recorded in `NotificationLog.meta.preview`.

Outbox mode means the complete pipeline — templates, event wiring, logging,
retries — is exercised with zero credentials, which is exactly what was missing.

### Recipient precedence
For reservations, an address the guest typed in explicitly wins over the
account email (`r.email || r.user?.email`), because a signed-in user may be
booking on someone else's behalf.

---

## 3. Browser push notifications

### Files
```
frontend/public/sw.js                    push + notificationclick handlers
frontend/app/lib/push.ts                 SSR-safe subscribe/unsubscribe helpers
frontend/app/routes/protected/admin/Notifications.tsx   settings + delivery log
backend/src/lib/push.ts                  VAPID delivery, stale-endpoint pruning
backend/src/routes/notifications.ts      /api/notifications/*
```

### Fan-out rules
| Event | Recipients |
| --- | --- |
| New order | ADMIN, MANAGER, STAFF, KITCHEN |
| New reservation | ADMIN, MANAGER, STAFF |
| Order status change | the customer who placed the order |
| Briefing ready | ADMIN, MANAGER |

### Setup
```bash
node -e "console.log(require('web-push').generateVAPIDKeys())"
```
Put the public/private pair in `backend/.env` as `VAPID_PUBLIC_KEY` /
`VAPID_PRIVATE_KEY`, and put the **same public key** in `frontend/.env` as
`VITE_VAPID_PUBLIC_KEY`. A mismatch causes every send to fail with 401/403.

### Requirements
Web Push only works on a **secure context** — `https://` or `localhost`. A
plain-IP dev URL will not work. The settings page reports this explicitly
instead of failing silently.

Stale subscriptions (HTTP 404/410) are deleted automatically on send.

---

## 4. AI Briefings

### Files
```
backend/src/lib/briefing.ts              metrics + forecast + Gemini + heuristics
backend/src/controllers/briefing.ts      generate / latest / list / metrics
backend/src/routes/briefing.ts           /api/briefings/*  (ADMIN, MANAGER)
backend/src/inngest/briefing.ts          scheduled + on-demand
frontend/app/components/dashboard/AiBriefing.tsx
```

### Two kinds
- **EXECUTIVE** — "what just happened": revenue, orders, AOV, occupancy,
  top items, category mix, peak hours, reservations, menu health.
- **FORECAST** — "what is about to happen": next 7 days, using weekday
  seasonality (28-day history) multiplied by a **damped** trend factor clamped
  to ±25%, with a confidence band that widens with horizon.

### Why it cannot fail
The numbers always come from `collectMetrics()` — pure Prisma, no AI. Gemini is
asked only to write narrative on top of those verified figures. If the key is
missing, invalid, rate-limited, or the model returns garbage, the heuristic
narrative is used and `payload.generatedBy` is set to `"heuristic"`; the UI then
shows `analytics engine` instead of a model name.

### Schedule
| Function | Cron | Purpose |
| --- | --- | --- |
| `ai-daily-executive-briefing` | `0 6 * * *` | morning digest |
| `ai-weekly-demand-forecast` | `30 6 * * 1` | Monday forecast |

An on-demand event (`admin/briefing.generate`) also exists, and the dashboard's
**Regenerate** button calls the REST endpoint directly so it works without an
Inngest dev server.

---

## 5. Notification delivery log

Every email and push attempt writes a `NotificationLog` row:
`channel`, `status` (SENT / FAILED / SKIPPED), `template`, `recipient`,
`subject`, `error`, `userId`, `meta`.

The `/admin/notifications` page renders it with per-channel totals, so a
delivery problem is visible without reading server logs.

---

## 6. Verification performed

All of the following ran against the live stack (real HTTP, real MongoDB), and
the suites are checked in so they can be re-run:

```bash
cd backend  && npm run verify:notifications   # 27 assertions
cd backend  && npm run verify:reservations    #  8 assertions
cd backend  && npm run verify:cleanup         # removes probe accounts
cd frontend && npm run verify:components      # 15 assertions, no browser needed
```

**Backend — 27/27**
- signup → `welcome` email logged and rendered to `.mail-outbox`
- `POST /api/auth/admin/ban-user` → `account-suspended` email
- `POST /api/auth/admin/unban-user` → `account-restored` email
- push subscribe (201) → row persisted → real VAPID send attempted → unsubscribe
- `/api/notifications/status`, `/ping`, `/test-email`, `/log`
- anonymous access rejected (401) on all authed routes
- briefings: metrics, generate EXECUTIVE, generate FORECAST, latest, list,
  get-by-id, anonymous rejected

**Reservation email flow — 8/8**
- reservation created with an explicit guest email → confirmation delivered to
  that address (not the account address) → status change → status email

**Frontend — 15/15**
- all routes return HTTP 200
- 8/8 new modules transform cleanly through Vite
- SSR render test: `AiBriefing` renders headline, KPI tiles, insights, risks,
  actions and priorities; the Notifications page renders the delivery log,
  template list and totals

**Database state after the run:** 1 user (the admin), 14 seeded orders, 2
briefings, 0 push subscriptions — all probe accounts removed.

---

## 7. Known limitations

- **Push cannot be tested headlessly here.** The subscribe flow and the VAPID
  send path are exercised (a fake endpoint correctly logs `FAILED`), but a real
  browser permission grant is required for an end-to-end delivery.
- **Gemini is unconfigured** in this environment (`GEMINI_API_KEY` is a
  placeholder), so briefings are produced by the heuristic engine. Set a real
  key and the same endpoints return model-written narrative with
  `generatedBy: "gemini"`.
- **SMTP is unconfigured**, so mail lands in `backend/.mail-outbox/`.
- `lucide-react@1.48.0` was found in `node_modules` with roughly half of
  `dist/esm/icons/*.mjs` missing (a partial install). The Vite dev server is
  unaffected because it pre-bundles the package, but `vite-node` and production
  builds fail on the missing files. **This has been repaired in place** by
  re-extracting a clean tarball; a fresh `npm install` would also fix it.
- Two leftover directories from earlier dependency repair,
  `frontend/node_modules.corrupt-1` and `frontend/node_modules.partial-1`, are
  no longer referenced and can be deleted to reclaim disk space. They contain a
  very large number of files, so remove them with the OS file browser or a
  single `rm -rf` rather than a per-file walk.
