import { SidebarTrigger } from "@/components/ui/sidebar";
import Inventory from "@/components/inventory/Inventory";
import type { Route } from "./+types/Inventory";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Inventory" },
    {
      name: "description",
      content: "Track stock levels, set reorder points, and manage dish recipes.",
    },
  ];
}

const InventoryPage = () => {
  return (
    <div>
      <header className="border-b sticky w-full top-0 z-10 bg-card/80">
        <div className="px-4 py-2 flex items-center justify-between">
          <div className="flex gap-2">
            <SidebarTrigger className="-ml-1" />
            <h1 className="text-2xl font-bold text-foreground">Inventory</h1>
          </div>
        </div>
      </header>
      <main className="px-10 mt-4">
        <Inventory />
      </main>
    </div>
  );
};

export default InventoryPage;
