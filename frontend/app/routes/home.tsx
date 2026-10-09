import Items from "@/components/global/Items";
import type { Route } from "./+types/home";
import Hero from "@/components/home/Hero";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Home" },
    { name: "description", content: "Welcome to the Home page" },
  ];
}

export default function Home() {
  return (
    <div className="space-y-2 p-3">
      <Hero />
      <div
        className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900"
        id="items"
      >
        <h1 className="font-bold text-xl text-primary mb-4 ml-5 mt-3">
          Choose Any Meal From Here
        </h1>
        <Items />
      </div>
    </div>
  );
}
