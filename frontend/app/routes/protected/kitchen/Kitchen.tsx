import KitchenBoard from "@/components/kitchen/KitchenBoard";
import type { Route } from "./+types/Kitchen";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Kitchen Display" },
    {
      name: "description",
      content: "Live kitchen tickets and order queue.",
    },
  ];
}

/**
 * Kitchen Display System.
 *
 * Replaces the old workflow where chefs had to open the admin order history,
 * expand a card and use a dropdown to move a ticket along.
 */
const Kitchen = () => {
  return (
    <div className="h-[calc(100svh-1rem)]">
      <KitchenBoard />
    </div>
  );
};

export default Kitchen;
