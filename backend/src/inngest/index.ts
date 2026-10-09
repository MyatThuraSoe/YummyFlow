import { Inngest } from "inngest";

// Fail fast only in production: `INNGEST_EVENT_KEY`/`INNGEST_SIGNING_KEY` ship
// as "local" and the SDK skips signature checks on /api/inngest in that mode.
// In dev that is correct (the local CLI never signs), but a deployment that
// copies `.env` verbatim would (1) never deliver events to Inngest Cloud and
// (2) expose the AI trigger functions to anyone who can reach the server —
// a free way to burn the GEMINI_API_KEY budget. NODE_ENV is the same gate the
// global error handler uses, so this "local" check is only ever armed in prod.
if (
  process.env.NODE_ENV === "production" &&
  (!process.env.INNGEST_EVENT_KEY ||
    process.env.INNGEST_EVENT_KEY === "local" ||
    !process.env.INNGEST_SIGNING_KEY ||
    process.env.INNGEST_SIGNING_KEY === "local")
) {
  throw new Error(
    "Inngest keys not configured for production. Set INNGEST_EVENT_KEY and " +
      "INNGEST_SIGNING_KEY to real Inngest Cloud keys in backend/.env before " +
      "deploying — the local 'local' values skip signature verification.",
  );
}

// Create a client to send and receive events
export const inngest = new Inngest({ id: "restraunts-ms" });
