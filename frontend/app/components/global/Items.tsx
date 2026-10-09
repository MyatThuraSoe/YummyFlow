import { customFetch } from "@/lib/api";
import type { itemsProps, PaginatedResponseProps } from "@/type";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import Loader from "./Loader";
import ItemCard from "./ItemCard";
import Empty from "./Empty";
import ReusableSearch from "./ReusableSearch";
import FilterCategory from "../menu/FilterCategory";
import CustomPagination from "./CustomPagination";

const Items = () => {
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
    null,
  );
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  // Fetch categories & menus
  const { data: menus, isLoading } = useQuery({
    queryKey: ["menus", page],
    queryFn: () =>
      customFetch<PaginatedResponseProps<itemsProps>>(`/menu?page=${page}`),
  });

  if (isLoading) {
    return <Loader title="Loading Items" className="min-h-screen" />;
  }

  // Filter using BOTH category and search
  const filteredMenus = menus?.data.filter((menu) => {
    // 1. Check if it matches the category (if one is selected)
    const matchesCategory = selectedCategoryId
      ? menu.categoryId === selectedCategoryId
      : true;

    // 2. Check if it matches the search query (if user typed something)
    const matchesSearch = search
      ? menu.name.toLowerCase().includes(search.toLowerCase())
      : true;

    // 3. Keep the item only if it matches BOTH conditions
    return matchesCategory && matchesSearch;
  });

  // out of stock
  const notAvailble = filteredMenus?.filter(
    (menu) => menu.isAvailable === false,
  ).length;
  return (
    <div>
      <div className="items-center px-4 mt-2">
        <ReusableSearch
          search={search}
          setSearch={setSearch}
          title="Item"
          className="w-full"
        />
        <p className="text-primary font-bold float-right mx-2">
          {notAvailble} items unavailable
        </p>
      </div>
      <FilterCategory
        selectedCategoryId={selectedCategoryId}
        setSelectedCategoryId={setSelectedCategoryId}
      />
      {/* empty */}
      {filteredMenus?.length === 0 && (
        <Empty
          title="No Menu Items"
          description="There are no menu items to display."
          to="/admin/menu"
        />
      )}
      <main className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-6 gap-y-12 px-8 lg:px-12 mt-6 mb-20">
        {filteredMenus?.map((item) => (
          <ItemCard item={item} />
        ))}
      </main>
      {filteredMenus?.length && filteredMenus?.length > 10 && (
        <CustomPagination
          currentPage={menus?.currentPage || 1}
          totalPages={menus?.totalPages || 1}
          loading={isLoading}
          setPage={setPage}
        />
      )}
    </div>
  );
};

export default Items;
