import { Edit, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useMutation } from "@tanstack/react-query";
import { createTable, updateTable } from "@/lib/api";
import toast from "react-hot-toast";
import { useState } from "react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { SectionOptions, ShapeOptions, tableSchema } from "./schema";
import { CustomInput } from "@/components/global/CustomInput";
import { CustomSelect } from "@/components/global/CustomSelect";
import type { TablesProps } from "@/type";
import { cn } from "@/lib/utils";

const CreateEdit = ({
  table,
  isLoading,
}: {
  table?: TablesProps;
  isLoading: boolean;
}) => {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const isEditMode = !!table;

  const form = useForm({
    resolver: zodResolver(tableSchema),
    defaultValues: {
      name: "",
      seats: 4,
      section: "Outdoor",
      shape: "square",
    },
    values: table
      ? {
          name: table?.name,
          seats: table?.seats,
          section: table?.section as "Main Dining Room" | "Outdoor" | "Terrace",
          shape: table?.shape,
        }
      : undefined,
  });

  const mutation = useMutation({
    mutationFn: isEditMode ? updateTable : createTable,
    onSuccess: () => {
      setIsAddModalOpen(false); // Close modal on success
      toast.success("Table created successfully!");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to create table");
    },
  });

  const handleCreateTable = (data: z.infer<typeof tableSchema>) => {
    mutation.mutate({ ...data, id: table?.id! });
  };
  return (
    <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
      <DialogTrigger asChild>
        <Button
          className={cn(
            "",
            isEditMode
              ? "absolute -top-4 -left-2 hidden group-hover:flex w-8 h-8 rounded-full shadow-md z-20"
              : "shadow-sm py-5 text-white",
          )}
          disabled={mutation.isPending || isLoading}
        >
          {isEditMode ? (
            <Edit className="size-4" />
          ) : (
            <>
              <Plus className="w-4 h-4 mr-2" />
              Add New Table
            </>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-106.25">
        <DialogHeader>
          <DialogTitle>
            {isEditMode ? "Edit Table" : "Create New Table"}
          </DialogTitle>
        </DialogHeader>
        {/* Form content goes here */}
        <form
          onSubmit={form.handleSubmit(handleCreateTable)}
          className="space-y-4 mt-4"
        >
          <div className="space-y-2">
            <CustomInput
              control={form.control}
              label="Table Name"
              placeholder="Enter table name"
              {...form.register("name")}
              disabled={mutation.isPending || isLoading}
            />
          </div>
          <div className="space-y-2">
            <CustomInput
              control={form.control}
              label="Number of Seats"
              placeholder="Enter number of seats"
              {...form.register("seats", { valueAsNumber: true })}
              disabled={mutation.isPending || isLoading}
            />
          </div>

          <div className="space-y-2">
            <CustomSelect
              control={form.control}
              label="Section"
              options={SectionOptions}
              {...form.register("section")}
              disabled={mutation.isPending || isLoading}
            />
          </div>

          <div className="space-y-2">
            <CustomSelect
              control={form.control}
              label="Shape"
              options={ShapeOptions}
              {...form.register("shape")}
              disabled={mutation.isPending || isLoading}
            />
          </div>
          <Button
            type="submit"
            className="w-full mt-6 py-5"
            disabled={mutation.isPending || isLoading}
          >
            {isEditMode ? "Update Table" : "Create Table"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default CreateEdit;
