import { SidebarTrigger } from "@/components/ui/sidebar";
import type { Route } from "./+types/Dashboard";
import { Button } from "@/components/ui/button";
import Category from "@/components/category/Category";
import { useMutation, useQuery } from "@tanstack/react-query";
import Loader from "@/components/global/Loader";
import { customFetch } from "@/lib/api";
import type { categoryProps, PaginatedResponseProps } from "@/type";
import Form from "@/components/menu/Form";
import { useState } from "react";
import toast from "react-hot-toast";
import MarkdownDialog from "@/components/global/MarkdownDialog";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Categories & Create Item" },
    {
      name: "description",
      content: "Welcome to the Categories & Create Item page!",
    },
  ];
}

const CategoriesCreateItem = () => {
  const [recipe, setRecipe] = useState<null | string>(null);
  const [itemId, setItemId] = useState<null | string>(null);
  const [aiSuggestion, setAiSuggestion] = useState<null | string>(null);

  // fetch categories
  const {
    data: categories,
    isLoading: isDataLoading,
    refetch,
  } = useQuery({
    queryKey: ["categories"],
    queryFn: () =>
      customFetch<PaginatedResponseProps<categoryProps>>("/category"),
  });

  const aiMutation = useMutation({
    mutationFn: () =>
      customFetch("/menu/smart-menu", {
        method: "POST",
        body: JSON.stringify({ itemId }),
      }),
    onSuccess: () => {
      toast.success("AI is generating a smart menu in the background!");
    },
    onError: () => {
      toast.error("Failed to start AI task.");
    },
  });

  if (isDataLoading) {
    return <Loader title="Loading categories" className="min-h-screen" />;
  }
  // console.log(categories);
  return (
    <>
      <header className="border-b sticky w-full top-0 z-10 bg-card/80">
        <div className="px-4 py-2 flex items-center justify-between">
          <div className="flex gap-2">
            <SidebarTrigger className="-ml-1" />
            <h1 className="text-2xl font-bold text-foreground">
              Categories & Create Item
            </h1>
          </div>
          <div className="flex gap-2 items-center">
            <Button className="p-5" variant={"outline"}>
              Discard
            </Button>
            <Button className="p-5">Add</Button>
            {itemId !== null && (
              <Button
                className="p-5"
                onClick={() => aiMutation.mutate()}
                disabled={aiMutation.isPending}
              >
                Smart Menu
              </Button>
            )}
          </div>
        </div>
      </header>
      <main className="w-full lg:flex">
        <div className="lg:border-r p-4 lg:min-h-screen lg:w-[75%]">
          <div className="flex justify-between">
            <div className="flex w-full items-center justify-between gap-2">
              <h1 className="text-primary text-xl font-bold">Item</h1>
            </div>
            <div className="flex gap-2">
              {recipe && (
                <MarkdownDialog content={recipe} title="Chef's Recipe" />
              )}
              {aiSuggestion && (
                <MarkdownDialog content={aiSuggestion} title="AI Suggestion" />
              )}
            </div>
            <div className="lg:hidden">
              <Category categories={categories} refetch={refetch} />
            </div>
          </div>
          <Form
            categories={categories}
            setRecipe={setRecipe}
            setItemId={setItemId}
            setAiSuggestion={setAiSuggestion}
          />
        </div>
        <div className="hidden lg:block lg:w-[25%]">
          <Category categories={categories} refetch={refetch} />
        </div>
      </main>
    </>
  );
};

export default CategoriesCreateItem;
