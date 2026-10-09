import type { categoryProps, PaginatedResponseProps } from "@/type";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useSidebar } from "@/components/ui/sidebar";
import { ChevronRight } from "lucide-react";
import Content from "./Content";

const sheet = ({
  categories,
  refetch,
}: {
  categories: PaginatedResponseProps<categoryProps> | undefined;
  refetch: () => void;
}) => {
  return (
    <Sheet>
      <SheetTrigger className="flex gap-2 items-center">
        <p className="text-lg font-bold">Categories</p>
        <ChevronRight />
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <Content categories={categories} refetch={refetch} />
        </SheetHeader>
      </SheetContent>
    </Sheet>
  );
};

const Category = ({
  categories,
  refetch,
}: {
  categories: PaginatedResponseProps<categoryProps> | undefined;
  refetch: () => void;
}) => {
  const { isMobile } = useSidebar();
  return (
    <>
      {isMobile ? (
        sheet({ categories, refetch })
      ) : (
        <Content categories={categories} refetch={refetch} />
      )}
    </>
  );
};

export default Category;
