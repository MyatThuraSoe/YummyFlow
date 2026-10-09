import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router"; // Update import to react-router-dom
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Carousel,
  type CarouselApi,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { customFetch } from "@/lib/api";
import type { categoryProps, PaginatedResponseProps } from "@/type";

const FilterCategory = ({
  selectedCategoryId,
  setSelectedCategoryId,
}: {
  selectedCategoryId: string | null;
  setSelectedCategoryId: (id: string | null) => void;
}) => {
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);
  const [count, setCount] = useState(0);

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Extract query to fix the undeclared variable error
  const query = searchParams.get("query") || "";

  // fetch categories with react-query
  const { data: categories, isLoading: isDataLoading } = useQuery({
    queryKey: ["categories"],
    queryFn: () =>
      customFetch<PaginatedResponseProps<categoryProps>>("/category"),
  });

  //useEffect to help with the carousel scroll snap and the current index of the carousel
  useEffect(() => {
    if (!api) {
      return;
    }

    setCount(api.scrollSnapList().length);
    setCurrent(api.selectedScrollSnap() + 1);

    api.on("select", () => {
      setCurrent(api.selectedScrollSnap() + 1);
    });
  }, [api]);

  if (isDataLoading) {
    return (
      <p className="text-sm font-medium text-muted-foreground p-4 text-center w-full">
        Loading categories...
      </p>
    );
  }

  // Handle category selection
  const handleCategorySelect = (categoryId: string, categoryName: string) => {
    setSelectedCategoryId(categoryId);

    // Sync selection to the URL (e.g., ?categoryId=123#items)
    const newParams = new URLSearchParams(searchParams);
    newParams.set("categoryId", categoryName);
    navigate(
      {
        hash: "items",
        search: newParams.toString(),
      },
      { replace: true }, // Use replace to avoid adding to history stack
    );
  };

  // handle clear filter
  const clearFilters = () => {
    setSelectedCategoryId(null);
    navigate(
      { hash: "items", search: "" },
      { replace: true }, // Moved to the options object
    );
  };

  return (
    <div className="gap-2 flex flex-col mx-auto px-2 lg:scrollbar-none w-full mt-4">
      <div className="relative w-full">
        {/* Left fade */}
        <div
          className={cn(
            "absolute left-12 top-0 bottom-0 w-12 z-10 bg-linear-to-r from-background to-transparent pointer-events-none",
            current === 1 && "hidden",
          )}
        />
        <Carousel
          setApi={setApi}
          opts={{
            align: "start",
            dragFree: true,
          }}
          className="w-full px-12"
        >
          <CarouselContent className="-ml-3">
            {/* "All" Button */}
            <CarouselItem className="pl-3 basis-auto">
              <Button
                variant="outline"
                className={cn(
                  "w-fit justify-start gap-2 cursor-pointer transition-colors p-4",
                  !query && !selectedCategoryId
                    ? "border-primary dark:border-primary text-primary bg-primary/10 hover:bg-primary/20 hover:text-primary"
                    : "text-muted-foreground bg-transparent hover:bg-accent hover:text-primary hover:border-primary dark:hover:border-primary",
                )}
                onClick={clearFilters}
              >
                All
              </Button>
            </CarouselItem>
            {/* Tag Buttons - Added optional chaining (?.) just in case data is empty */}
            {categories?.data?.map((category) => (
              <CarouselItem className="pl-3 basis-auto" key={category.id}>
                <Button
                  variant="outline"
                  className={cn(
                    "w-fit justify-start gap-2 cursor-pointer transition-colors p-4",
                    selectedCategoryId === category.id
                      ? "border-primary dark:border-primary text-primary bg-primary/10 hover:bg-primary/20 hover:text-primary"
                      : "text-muted-foreground bg-transparent hover:bg-accent hover:text-primary hover:border-primary dark:hover:border-primary",
                  )}
                  onClick={() =>
                    handleCategorySelect(category.id, category.name)
                  }
                >
                  {category.name}
                </Button>
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious className="left-0 z-20" />
          <CarouselNext className="right-0 z-20" />
        </Carousel>
        {/* Right fade */}
        <div
          className={cn(
            "absolute right-12 top-0 bottom-0 w-12 z-10 bg-linear-to-l from-background to-transparent pointer-events-none",
            current === count && "hidden",
          )}
        />
      </div>
    </div>
  );
};

export default FilterCategory;
