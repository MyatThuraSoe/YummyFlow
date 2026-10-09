import DayClose from "@/components/reports/DayClose";
import type { Route } from "./+types/DayClose";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Day Close" },
    {
      name: "description",
      content: "End-of-service Z report: takings, voids and what is still open.",
    },
  ];
}

/**
 * Service-day close.
 *
 * ADMIN / MANAGER only — the nav entry is gated the same way, and the API
 * refuses STAFF and KITCHEN outright, so hiding the link is convenience rather
 * than the actual control.
 */
const DayCloseRoute = () => {
  return <DayClose />;
};

export default DayCloseRoute;
