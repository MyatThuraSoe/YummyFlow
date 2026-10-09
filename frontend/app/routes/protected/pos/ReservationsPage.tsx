import { SidebarTrigger } from "@/components/ui/sidebar";
import Reservations from "@/components/profile/Reservations";
import type { Route } from "./+types/ReservationsPage";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Reservations" },
    { name: "description", content: "Welcome to the Reservations page!" },
  ];
}

const ReservationsPage = () => {
  return (
    <div>
      <header className="border-b sticky w-full top-0 z-10 bg-card/80">
        <div className="px-4 py-2 flex items-center justify-between">
          <div className="flex gap-2">
            <SidebarTrigger className="-ml-1" />
            <h1 className="text-2xl font-bold text-foreground">
              Reservations Management
            </h1>
          </div>
        </div>
      </header>
      <main className="px-10 mt-4">
        <Reservations />
      </main>
    </div>
  );
};

export default ReservationsPage;
