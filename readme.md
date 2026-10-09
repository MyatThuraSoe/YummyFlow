# 🍽️ DineFlow — Restaurant Management System

> Full-stack, AI-powered, real-time Restaurant Management System built with the MERN stack, TypeScript, and production-grade tooling.

Built by [TheScriptForger](https://youtube.com/@ScriptForger) · [Watch the full tutorial](https://youtube.com/@ScriptForger)

---

## ✅ Pro Features Included

This build ships the full core system **plus** all three Patreon-gated features, implemented end to end.

| Feature                       | Free version | Patreon version | This build |
| ----------------------------- | ------------ | --------------- | ---------- |
| Full core system              | ✅           | ✅              | ✅         |
| Stripe payments               | ✅           | ✅              | ✅         |
| AI menu generation            | ✅           | ✅              | ✅         |
| Smart Menu AI                 | ✅           | ✅              | ✅         |
| Real-time Socket.io           | ✅           | ✅              | ✅         |
| 📧 Email system + templates   | ❌           | ✅              | ✅         |
| 🔔 Browser push notifications | ❌           | ✅              | ✅         |
| 🤖 AI Briefings (dashboard)   | ❌           | ✅              | ✅         |

### What was added

- 📧 **Email system (Nodemailer)** — six branded, Outlook-safe HTML templates
  (welcome, order receipt, reservation confirmation, reservation status,
  account suspended/restored, test). Wired into real events: signup, order
  creation, reservation creation/status change, and admin ban/unban.
  Runs in **outbox mode** with zero credentials — every message is rendered to
  `backend/.mail-outbox/` so the whole pipeline is testable on a fresh clone.
- 🔔 **Browser push notifications (Web Push / VAPID)** — service worker,
  per-device subscriptions, role-targeted fan-out (new order → ADMIN/MANAGER/
  STAFF/KITCHEN, new booking → host desk, order status → the customer).
  Stale endpoints are pruned automatically on HTTP 404/410.
- 🤖 **AI Briefings** — an Executive digest and a 7-day Demand Forecast rendered
  on the dashboard. Numbers come from a deterministic analytics engine; Gemini
  adds narrative on top. **If the AI is unavailable the briefing still
  generates**, so the dashboard never breaks on a quota error.
- 🗂️ **Delivery log** — every email and push attempt is recorded in
  `NotificationLog` and shown on `/admin/notifications` with totals.

The three features are visible in the UI at:

| Where                | What                                                        |
| -------------------- | ----------------------------------------------------------- |
| `/dashboard`         | AI Briefing panel (Executive / Forecast tabs, regenerate)   |
| `/admin/notifications` | Push enable/disable per device, send test, delivery log   |

---

## ✨ Features

- ⚒️ Role-based auth — Admin, Manager, Staff, Customer (Better Auth)
- 🔐 Permission-protected Express routes per role
- 🛒 Stripe checkout with Better Auth webhooks
- 📡 Real-time updates across all devices via Socket.io
- 🤖 AI-generated menu items via Gemini + Inngest background jobs
- 🧠 Smart Menu AI — Spinoff, Improve, or Ignore any dish
- 🖥️ POS system — floor plan, table management, print receipts
- 📋 Reservations with live status updates
- 📊 Admin dashboard with charts and activity logs
- 👤 User management — roles, ban/unban, bulk actions
- 📝 Rich-text menu editor via PortableText
- 🖼️ Image uploads via EdgeStore
- 📧 Transactional email with branded templates (Nodemailer)
- 🔔 Browser push notifications with per-device subscriptions (Web Push / VAPID)
- 🤖 AI Briefings — executive digest + 7-day demand forecast, scheduled daily
- 🗂️ Notification delivery log with per-channel totals

---

## 🧰 Tech Stack

| Layer           | Technology                                                             |
| --------------- | ---------------------------------------------------------------------- |
| Frontend        | React, React Router, TanStack Query, Tailwind CSS, Shadcn UI, Recharts |
| Backend         | Node.js, Express, TypeScript (runs on Node; Bun optional)              |
| Database        | MongoDB via Prisma ORM                                                 |
| Auth            | Better Auth                                                            |
| Payments        | Stripe                                                                 |
| AI              | Gemini AI                                                              |
| Background Jobs | Inngest                                                                |
| Real-time       | Socket.io                                                              |
| Email           | Nodemailer (SMTP, or outbox mode with no credentials)                  |
| Push            | Web Push / VAPID (`web-push`) + service worker                         |
| File Uploads    | EdgeStore                                                              |
| Rich Text       | PortableText                                                           |
| Language        | TypeScript (full stack)                                                |

---

## 📁 Project Structure

```
dineflow/
├── frontend/                  # React frontend
│   ├── app/
│   │   ├── components/
│   │   │   └── dashboard/
│   │   │       └── AiBriefing.tsx      # PRO: executive + forecast panel
│   │   ├── routes/
│   │   │   └── protected/admin/
│   │   │       └── Notifications.tsx   # PRO: push toggle + delivery log
│   │   ├── hooks/
│   │   └── lib/
│   │       └── push.ts                 # PRO: service worker + subscribe flow
│   └── public/
│       └── sw.js                       # PRO: push/notificationclick handler
├── backend/                   # Express backend
│   ├── src/
│   │   ├── routes/
│   │   │   ├── notifications.ts        # PRO
│   │   │   └── briefing.ts             # PRO
│   │   ├── controllers/
│   │   │   ├── notification.ts         # PRO
│   │   │   └── briefing.ts             # PRO
│   │   ├── emails/                     # PRO: layout.ts + templates.ts
│   │   ├── lib/
│   │   │   ├── mailer.ts               # PRO: Nodemailer (SMTP / outbox)
│   │   │   ├── push.ts                 # PRO: VAPID delivery
│   │   │   ├── notify.ts               # PRO: event orchestrator
│   │   │   └── briefing.ts             # PRO: metrics + Gemini + heuristics
│   │   ├── middleware/
│   │   └── inngest/
│   │       └── briefing.ts             # PRO: scheduled briefings
│   └── prisma/                # Prisma schema
└── README.md
```

---

## 🚀 Getting Started

### Prerequisites

Make sure you have the following installed:

- [Node.js](https://nodejs.org) >= 20 (22 LTS recommended)
- [MongoDB](https://mongodb.com) database (local **replica set** or Atlas)
- [Git](https://git-scm.com)
- [Bun](https://bun.sh) >= 1.0 — *optional*, the project runs on Node too

---

### 1. Clone the repository

```bash
git clone https://github.com/BensonRaro/realtime-restaurant-management-system-pos-booking.git
cd realtime-restaurant-management-system-pos-booking
```

### 2. Install dependencies

```bash
# Install server dependencies
cd backend && npm install

# Install client dependencies
cd ../frontend && npm install
```

> Bun also works (`bun install`) if you have it installed. The commands below use
> `npm` because it is available everywhere.

### 3. Set up environment variables

Copy the example env files:

```bash
# Server
cp backend/.env.example backend/.env

# Client
cp frontend/.env.example frontend/.env
```

Then fill in the values as described below.

---

## 🔐 Environment Variables

### Server — `backend/.env`

```env
# ── App ──────────────────────────────────────────────
PORT=5000
CLIENT_URL=http://localhost:5173

# ── Database ─────────────────────────────────────────
# Get from MongoDB Atlas → https://cloud.mongodb.com
# Create a free cluster → Connect → Drivers → copy the URI
DATABASE_URL=mongodb+srv://<user>:<password>@cluster.mongodb.net/dineflow

# ── Better Auth ───────────────────────────────────────
# Generate a random 32+ character secret — run in terminal:
# openssl rand -base64 32
BETTER_AUTH_SECRET=your_secret_here
BETTER_AUTH_URL=http://localhost:5000

# ── Google OAuth (for Google sign-in) ─────────────────
# 1. Go to https://console.cloud.google.com
# 2. Create a project → APIs & Services → Credentials
# 3. Create OAuth 2.0 Client ID (Web application)
# 4. Add http://localhost:5000/api/auth/callback/google to redirect URIs
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret

# ── Stripe ────────────────────────────────────────────
# 1. Go to https://dashboard.stripe.com
# 2. Developers → API Keys → copy Secret Key
# 3. Developers → Webhooks → Add endpoint:
#    URL: http://localhost:5000/api/webhooks/stripe
#    Events: checkout.session.completed
# 4. Copy the Webhook Signing Secret
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# ── Gemini AI ─────────────────────────────────────────
# 1. Go to https://aistudio.google.com
# 2. Get API Key → Create API Key
GEMINI_API_KEY=your_gemini_api_key

# ── Inngest ───────────────────────────────────────────
# 1. Go to https://inngest.com → Sign up free
# 2. Create an app → copy Event Key and Signing Key
# For local dev the defaults below work with the Inngest Dev Server
INNGEST_EVENT_KEY=local
INNGEST_SIGNING_KEY=local

# ── EdgeStore ─────────────────────────────────────────
# 1. Go to https://edgestore.dev → Sign up
# 2. Create a project → copy Access Key and Secret Key
EDGE_STORE_ACCESS_KEY=your_access_key
EDGE_STORE_SECRET_KEY=your_secret_key

# ── Email (Nodemailer) — PRO ──────────────────────────
# Leave SMTP_HOST and SMTP_PORT EMPTY to run in "outbox mode": every email is
# fully rendered and written to backend/.mail-outbox/<timestamp>-<tpl>-<to>.html
# instead of being delivered. The entire pipeline (templates, wiring, logging)
# works with zero credentials — useful for development.
# Fill these in to deliver for real. Gmail example: smtp.gmail.com / 587 +
# a 16-character App Password (not your account password).
SMTP_HOST=
SMTP_PORT=
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
MAIL_FROM=no-reply@dineflow.local
MAIL_FROM_NAME=DineFlow

# ── Browser push (Web Push / VAPID) — PRO ─────────────
# Generate a key pair once:
#   node -e "console.log(require('web-push').generateVAPIDKeys())"
# VITE_VAPID_PUBLIC_KEY in frontend/.env MUST be the SAME public key, or the
# browser subscribes to a different key pair and every send fails with 401/403.
VAPID_PUBLIC_KEY=your_vapid_public_key
VAPID_PRIVATE_KEY=your_vapid_private_key
VAPID_SUBJECT=mailto:admin@dineflow.local
```

> **MongoDB note:** Prisma wraps writes in transactions, which MongoDB only
> supports on a **replica set**. A standalone `mongod` accepts reads but fails
> every write. For local development run a single-node replica set:
>
> ```bash
> mongod --replSet rs0 --port 27017 --dbpath /path/to/data
> # then, once:
> mongosh --eval "rs.initiate()"
> ```
>
> and point `DATABASE_URL` at it, e.g.
> `mongodb://127.0.0.1:27017/dineflow?replicaSet=rs0`.

### Client — `frontend/.env`

> ⚠️ These belong in **`frontend/.env`**, not `backend/.env`.

```env
# REQUIRED. Base URL of the backend API — used as the Better Auth client
# baseURL (app/lib/auth-client.ts). Without it, auth requests hit the frontend
# origin and sign-in silently fails.
VITE_BACKEND_URL=http://localhost:5000

# PRO: must equal VAPID_PUBLIC_KEY in backend/.env
VITE_VAPID_PUBLIC_KEY=your_vapid_public_key

# EdgeStore public access key (same project as backend)
VITE_EDGE_STORE_ACCESS_KEY=your_access_key
```

---

### 4. Set up the database

```bash
cd backend

# Push the Prisma schema to your MongoDB database
npx prisma db push

# (Optional) Open Prisma Studio to inspect your data
npx prisma studio
```

### 5. Run the development servers

Open two terminals:

```bash
# Terminal 1 — Backend (http://localhost:5000)
cd backend && npm run dev

# Terminal 2 — Frontend (http://localhost:5173)
cd frontend && npm run dev
```

### 6. Run Inngest Dev Server (for background jobs + AI)

Open a third terminal:

```bash
# Start the local Inngest dev server
npx inngest-cli@latest dev -u http://localhost:5000/api/inngest
```

Then open [http://localhost:8288](http://localhost:8288) to monitor your background jobs locally.

This is where the scheduled AI briefings appear:

| Function                      | Schedule            | Purpose                        |
| ----------------------------- | ------------------- | ------------------------------ |
| `ai-daily-executive-briefing` | `0 6 * * *`         | Executive digest every morning |
| `ai-weekly-demand-forecast`   | `30 6 * * 1`        | Forecast every Monday          |

You can also trigger a briefing instantly from the dashboard's **Regenerate**
button — no Inngest server required for that path.

---

## 🔔 Testing the pro features locally

**Email (no credentials needed).** Send yourself a test email from
`/admin/notifications` → **Send test**, then open the newest file in
`backend/.mail-outbox/`. Every transactional email (welcome, receipt,
reservation, account status) lands there when `SMTP_HOST` is empty.

**Push notifications.** Open `/admin/notifications` → **Enable on this device**,
grant the browser prompt, then **Send test**. Web Push requires
`https://` or `localhost` — a plain-IP dev URL will not work.

**AI Briefings.** Open `/dashboard` — the panel sits under the KPI cards. Click
**Regenerate** to produce a fresh briefing. With no `GEMINI_API_KEY` the
deterministic analytics engine still produces a complete briefing; the panel
shows `analytics engine` instead of the model name.

---

## 🧪 Verifying the pro features

Re-runnable test suites are included. Start the backend first
(`cd backend && npm run dev`), then:

```bash
# 27 assertions over the real HTTP API: signup -> welcome email,
# ban/unban -> account emails, push subscribe/send, delivery log,
# and every AI-briefing endpoint including its auth guards.
cd backend && npm run verify:notifications

# 8 assertions for the reservation email flow: an explicit guest address
# must win over the signed-in account address.
cd backend && npm run verify:reservations

# Removes the throwaway accounts those two scripts create.
cd backend && npm run verify:cleanup
```

```bash
# Renders AiBriefing + the Notifications page to HTML with seeded data,
# proving they render real content. No browser required.
cd frontend && npm run verify:components
```

---

## 🎭 Default Roles

Seed an initial admin user manually in Prisma Studio or via a seed script, then use the Users Management page in the admin dashboard to assign roles.

| Role       | Access                                |
| ---------- | ------------------------------------- |
| `ADMIN`    | Full access                           |
| `MANAGER`  | Dashboard, menu, reservations, orders |
| `STAFF`    | POS and order management              |
| `KITCHEN`  | POS view only                         |
| `CUSTOMER` | Public menu, ordering, reservations   |

---

## 🤝 Support the channel

If this project helped you, consider supporting on Patreon for exclusive source code features and early access to future projects.

👉 [patreon.com/bensonraro](https://patreon.com/bensonraro)

Subscribe on YouTube for weekly full stack tutorials:
👉 [youtube.com/@ScriptForger](https://youtube.com/@ScriptForger)

Follow on X for daily dev tips:
👉 [x.com/TheScriptForger](https://x.com/ScriptForger)

---

## 📄 License

This project is for educational purposes. Please do not republish or resell this source code.
