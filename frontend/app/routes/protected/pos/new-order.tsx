import { SidebarTrigger } from "@/components/ui/sidebar";
import type { Route } from "./+types/new-order";
import Items from "@/components/global/Items";
import OrderSummary, { CartSheet } from "@/components/global/OrderSummary";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "New Order" },
    { name: "description", content: "Welcome to the New Order page!" },
  ];
}

const NewOrder = () => {
  return (
    <div>
      <header className="border-b sticky w-full top-0 z-10 bg-card/80">
        <div className="px-4 py-2 flex items-center justify-between">
          <div className="flex gap-2">
            <SidebarTrigger className="-ml-1" />
            <h1 className="text-2xl font-bold text-foreground">New Order</h1>
          </div>
          <div className="xl:hidden">
            <CartSheet />
          </div>
        </div>
      </header>
      <main className="lg:flex">
        <div className="xl:w-[75%]">
          <Items />
        </div>
        <div className="hidden xl:block xl:w-[25%] lg:pl-4 w-full bg-background h-[90vh]">
          <OrderSummary />
        </div>
      </main>
    </div>
  );
};

export default NewOrder;
