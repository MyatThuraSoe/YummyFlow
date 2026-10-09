import { inngest } from ".";
import { generateBriefing } from "../lib/briefing";
import { getIO } from "../lib/socket";
import { sendToRoles } from "../lib/push";
import { prisma } from "../lib/prisma";

/**
 * Scheduled AI briefings (PRO).
 *
 * Cron schedules are declared inline so the whole feature works with no extra
 * event wiring. Inngest retries automatically; `generateBriefing` never throws
 * for AI reasons, so a bad Gemini response cannot poison the schedule.
 */

async function announce(kind: "EXECUTIVE" | "FORECAST", headline: string, summary: string) {
  try {
    getIO().emit("briefing-ready", { kind, headline });
  } catch {
    /* socket may not be initialised in a worker context */
  }

  try {
    await sendToRoles(["ADMIN", "MANAGER"], {
      title: kind === "EXECUTIVE" ? "📊 Daily executive briefing" : "📈 Weekly demand forecast",
      body: headline,
      url: "/admin/dashboard",
      tag: `briefing-${kind}`,
      template: `push-briefing-${kind.toLowerCase()}`,
    });
  } catch (e: any) {
    console.warn("[briefing] push announce failed:", e?.message);
  }

  try {
    await prisma.notificationLog.create({
      data: {
        channel: "PUSH",
        status: "SENT",
        template: `briefing-${kind.toLowerCase()}`,
        recipient: "ADMIN,MANAGER",
        subject: headline,
        meta: { kind, summary },
      },
    });
  } catch {
    /* log write is best-effort */
  }
}

/** Every morning at 06:00 — "what happened yesterday / this week". */
export const aiDailyExecutiveBriefing = inngest.createFunction(
  {
    id: "ai-daily-executive-briefing",
    triggers: [{ cron: "0 6 * * *" }],
  },
  async ({ step }) => {
    const briefing = await step.run("generate-executive-briefing", async () =>
      generateBriefing("EXECUTIVE"),
    );

    await step.run("announce", async () =>
      announce("EXECUTIVE", briefing.headline, briefing.summary),
    );

    return { id: briefing.id, headline: briefing.headline };
  },
);

/** Monday 06:30 — the week ahead. */
export const aiWeeklyDemandForecast = inngest.createFunction(
  {
    id: "ai-weekly-demand-forecast",
    triggers: [{ cron: "30 6 * * 1" }],
  },
  async ({ step }) => {
    const briefing = await step.run("generate-forecast-briefing", async () =>
      generateBriefing("FORECAST"),
    );

    await step.run("announce", async () =>
      announce("FORECAST", briefing.headline, briefing.summary),
    );

    return { id: briefing.id, headline: briefing.headline };
  },
);

/**
 * On-demand generation via event, so the UI can kick off a briefing and the
 * work survives a page refresh.
 * Event: { name: "admin/briefing.generate", data: { kind } }
 */
export const aiOnDemandBriefing = inngest.createFunction(
  {
    id: "ai-on-demand-briefing",
    triggers: [{ event: "admin/briefing.generate" }],
  },
  async ({ event, step }) => {
    const kind = event.data?.kind === "FORECAST" ? "FORECAST" : "EXECUTIVE";

    const briefing = await step.run("generate", async () => generateBriefing(kind));

    await step.run("announce", async () =>
      announce(kind as "EXECUTIVE" | "FORECAST", briefing.headline, briefing.summary),
    );

    return { id: briefing.id, kind, headline: briefing.headline };
  },
);
