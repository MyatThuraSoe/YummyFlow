import FloorPlan from "@/components/pos/FloorPlan";
import type { Route } from "./+types/Tables";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Tables" },
    { name: "description", content: "Welcome to the Tables page!" },
  ];
}

const Tables = () => {
  return <FloorPlan />;
};

export default Tables;
