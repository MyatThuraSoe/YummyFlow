import { SidebarTrigger } from "@/components/ui/sidebar";
import type { Route } from "./+types/Tables";
import Orders from "@/components/global/Orders";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Order History" },
    { name: "description", content: "View your order history here!" },
  ];
}

const OrderHistory = () => {
  return (
    <div>
      <header className="border-b sticky w-full top-0 z-10 bg-card/80">
        <div className="px-4 py-2 flex items-center justify-between">
          <div className="flex gap-2">
            <SidebarTrigger className="-ml-1" />
            <h1 className="text-2xl font-bold text-foreground">
              Order History
            </h1>
          </div>
        </div>
      </header>
      <main className="px-10 mt-4">
        <Orders />
      </main>
    </div>
  );
};

export default OrderHistory;
