import { SidebarTrigger } from "@/components/ui/sidebar";
import WaitlistBoard from "@/components/waitlist/WaitlistBoard";
import type { Route } from "./+types/Waitlist";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Waitlist" },
    {
      name: "description",
      content: "Walk-in queue: seat parties, mark no-shows, keep the door moving.",
    },
  ];
}

const Waitlist = () => {
  return (
    <div>
      <header className="border-b sticky w-full top-0 z-10 bg-card/80">
        <div className="px-4 py-2 flex items-center justify-between">
          <div className="flex gap-2">
            <SidebarTrigger className="-ml-1" />
            <h1 className="text-2xl font-bold text-foreground">Waitlist</h1>
          </div>
        </div>
      </header>
      <main className="px-10 mt-4">
        <WaitlistBoard />
      </main>
    </div>
  );
};

export default Waitlist;
