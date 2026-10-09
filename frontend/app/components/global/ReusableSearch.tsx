import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SearchIcon } from "lucide-react";

const ReusableSearch = ({
  search,
  setSearch,
  title,
  className,
}: {
  search: string;
  setSearch: (search: string) => void;
  title: string;
  className?: string;
}) => {
  return (
    <div className={cn("relative", className)}>
      <SearchIcon className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input
        placeholder={`Search ${title}...`}
        className="py-4 pl-8"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
    </div>
  );
};

export default ReusableSearch;
