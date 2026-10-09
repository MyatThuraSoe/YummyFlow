import { Edit, Trash2 } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useMutation } from "@tanstack/react-query";
import toast from "react-hot-toast";
import type { categoryProps, PaginatedResponseProps } from "@/type";
import { createCategory, deleteCategory, updateCategory } from "@/lib/api";

const Content = ({
  categories,
  refetch,
}: {
  categories: PaginatedResponseProps<categoryProps> | undefined;
  refetch: () => void;
}) => {
  const [name, setName] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(
    null,
  );

  const createMutation = useMutation({
    mutationFn: createCategory,
    onSuccess: () => {
      toast.success("Category created successfully");
      setName("");
      refetch();
    },
    onError: (error) => {
      toast.error((error as Error).message || "Failed to create category");
    },
  });

  const updateMutation = useMutation({
    mutationFn: updateCategory,
    onSuccess: () => {
      toast.success("Category updated successfully");
      setName("");
      setEditingCategoryId(null);
      refetch();
    },
    onError: (error) => {
      toast.error((error as Error).message || "Failed to update category");
    },
  });

  const handleCreate = () => {
    createMutation.mutate({ name });
  };

  const handleUpdate = () => {
    if (editingCategoryId && name) {
      updateMutation.mutate({ id: editingCategoryId, name });
    } else {
      toast.error("ID and name are required to update category");
    }
  };

  const onSubmit = (e: React.ChangeEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (editingCategoryId) {
      handleUpdate();
    } else {
      handleCreate();
    }
  };

  const deleteMutation = useMutation({
    mutationFn: deleteCategory,
    onSuccess: () => {
      toast.success("Category deleted successfully");
      refetch();
    },
    onError: (error) => {
      toast.error((error as Error).message || "Failed to delete category");
    },
  });

  const deleteCat = (id: string) => {
    if (id) {
      deleteMutation.mutate({ id });
    } else {
      toast.error("ID is required to delete category");
    }
  };

  const isLoading =
    createMutation.isPending ||
    deleteMutation.isPending ||
    updateMutation.isPending;
  return (
    <div className="p-4 w-full">
      <h1 className="text-primary text-xl font-bold">Category</h1>
      <form onSubmit={onSubmit} className="mt-3 flex gap-1">
        <div className="space-y-3 w-full">
          <Label>Name</Label>
          <Input
            type="text"
            placeholder="category"
            value={name}
            required
            onChange={(e) => setName(e.target.value)}
            className="py-6"
            disabled={isLoading}
          />
        </div>
        <Button className="py-6 mt-6" type="submit" disabled={isLoading}>
          {editingCategoryId ? "Update" : "Add"}
        </Button>
      </form>
      <div className="mt-6">
        <h2 className="text-lg font-bold">Existing Categories</h2>
        {categories?.data.length === 0 && (
          <p className="text-muted-foreground">No categories found.</p>
        )}
        <ul className="mt-2 space-y-1">
          {categories?.data.map((category) => (
            <li
              key={category.id}
              className="flex justify-between items-center border p-2 rounded-lg"
            >
              {category.name}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  disabled={isLoading}
                  onClick={() => {
                    setEditingCategoryId(category.id);
                    setName(category.name);
                  }}
                >
                  <Edit />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  disabled={isLoading}
                  onClick={() => deleteCat(category.id)}
                >
                  <Trash2 />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default Content;
