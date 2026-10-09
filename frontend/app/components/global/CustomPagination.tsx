import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

const CustomPagination = ({
  loading,
  currentPage,
  setPage,
  totalPages,
}: {
  currentPage: number;
  setPage: (page: number) => void;
  totalPages: number;
  loading: boolean;
}) => {
  return (
    <div className="flex items-center justify-end space-x-2 py-4 px-6">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setPage(Math.max(1, currentPage - 1))}
        disabled={currentPage === 1 || loading}
      >
        <ChevronLeft className="h-4 w-4 mr-2" />
        Previous
      </Button>
      <div className="text-sm font-medium">
        Page {currentPage} of {totalPages}
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
        disabled={currentPage === totalPages || loading}
      >
        Next
        <ChevronRight className="h-4 w-4 ml-2" />
      </Button>
    </div>
  );
};

export default CustomPagination;
