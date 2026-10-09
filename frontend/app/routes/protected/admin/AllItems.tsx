import { SidebarTrigger } from "@/components/ui/sidebar";
import type { Route } from "./+types/AllItems";
import { Button } from "@/components/ui/button";
import Items from "@/components/global/Items";
import { useMutation } from "@tanstack/react-query";
import { customFetch } from "@/lib/api";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "All Menu Items" },
    { name: "description", content: "Welcome to the Menu Items page!" },
  ];
}

const AllItems = () => {
  const aiMutation = useMutation({
    mutationFn: () =>
      customFetch("/menu/generate-menu-item", { method: "POST" }),
    onSuccess: () => {
      toast.success("AI is writing the recipe in the background!");
    },
    onError: () => {
      toast.error("Failed to start AI task.");
    },
  });
  return (
    <div>
      <header className="border-b sticky w-full top-0 z-10 bg-card/80">
        <div className="px-4 py-2 flex items-center justify-between">
          <div className="flex gap-2">
            <SidebarTrigger className="-ml-1" />
            <h1 className="text-2xl font-bold text-foreground">
              All Menu Items
            </h1>
          </div>
          <div className="flex gap-2 items-center">
            <Button
              className="p-5"
              onClick={() => aiMutation.mutate()}
              disabled={aiMutation.isPending}
            >
              {aiMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              Generate Menu with AI
            </Button>
          </div>
        </div>
      </header>
      <Items />
    </div>
  );
};

export default AllItems;
