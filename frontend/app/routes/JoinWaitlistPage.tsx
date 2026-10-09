import JoinWaitlist from "@/components/waitlist/JoinWaitlist";
import type { Route } from "./+types/JoinWaitlistPage";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Join the waitlist" },
    {
      name: "description",
      content: "No reservation? Join the queue and we'll call you when a table frees up.",
    },
  ];
};

/**
 * Deliberately outside `routes/customer/layout.tsx`.
 *
 * Every other page in that layout assumes a signed-in customer. A walk-in at
 * the door has no account and no intention of making one, so this page must
 * not sit behind the customer session check.
 */
const JoinWaitlistPage = () => {
  return (
    <div className="min-h-dvh px-4 py-10">
      <JoinWaitlist />
    </div>
  );
};

export default JoinWaitlistPage;
