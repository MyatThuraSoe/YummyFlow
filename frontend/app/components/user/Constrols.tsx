import { AVAILABLE_ROLES } from "@/components/user/contants";
import { Button } from "@/components/ui/button";
import { Download, Filter, Search } from "lucide-react";
import type { roles } from "@/type";
import ReusableSearch from "@/components/global/ReusableSearch";

const Constrols = ({
  searchQuery,
  selectedRole,
  setSearchQuery,
  setSelectedRole,
}: {
  setSearchQuery: (query: string) => void;
  searchQuery: string;
  selectedRole: roles | "ALL";
  setSelectedRole: (role: roles | "ALL") => void;
}) => {
  return (
    <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-white dark:bg-card p-4 rounded-lg shadow-sm border border-border">
      {/* Search */}
      <ReusableSearch
        search={searchQuery}
        setSearch={setSearchQuery}
        title="users"
        className="w-full lg:w-80"
      />
      {/* Role Badges Filter */}
      <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
        <Button
          variant={selectedRole === "ALL" ? "default" : "secondary"}
          size="sm"
          onClick={() => setSelectedRole("ALL")}
          className="rounded-full text-xs"
        >
          All
        </Button>
        {AVAILABLE_ROLES.map((role) => (
          <Button
            key={role}
            variant={selectedRole === role ? "default" : "outline"}
            size="sm"
            onClick={() => setSelectedRole(role)}
            className="rounded-full text-xs border-dashed"
          >
            {role}
          </Button>
        ))}

        <div className="hidden lg:block w-px h-6 bg-border mx-2" />

        {/* Extra Actions */}
        <Button variant="outline" size="sm" className="hidden sm:flex">
          <Filter className="mr-2 h-3 w-3" /> Filter
        </Button>
        <Button variant="outline" size="sm" className="hidden sm:flex">
          <Download className="mr-2 h-3 w-3" /> Export
        </Button>
      </div>
    </div>
  );
};

export default Constrols;
