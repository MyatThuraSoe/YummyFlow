import ActiveOrders from "@/components/pos/ActiveOrders";
import type { Route } from "./+types/ActiveOrders";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Active Orders" },
    {
      name: "description",
      content: "Every order currently in flight, with payment status.",
    },
  ];
}

const ActiveOrdersRoute = () => {
  return <ActiveOrders />;
};

export default ActiveOrdersRoute;
