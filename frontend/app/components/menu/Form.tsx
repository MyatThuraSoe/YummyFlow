import type { categoryProps, itemsProps, PaginatedResponseProps } from "@/type";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import * as z from "zod";
import toast from "react-hot-toast";
import { itemSchema } from "./schema";
import { CustomInput } from "@/components/global/CustomInput";
import { Label } from "@/components/ui/label";
import { CustomSelect } from "@/components/global/CustomSelect";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import PortableTextEditorField from "@/components/global/text-editor/PortableTextEditorField";
import { CustomImageDropzone } from "@/components/global/CustomImageDropzone";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createMenuItem, customFetch, updateMenuItem } from "@/lib/api";
import { useNavigate, useParams } from "react-router";
import Loader from "@/components/global/Loader";
import { useEffect } from "react";

const Form = ({
  categories,
  setRecipe,
  setItemId,
  setAiSuggestion,
}: {
  categories: PaginatedResponseProps<categoryProps> | undefined;
  setRecipe: (value: string | null) => void;
  setItemId: (value: string | null) => void;
  setAiSuggestion: (value: string | null) => void;
}) => {
  // get Id => later use it for editing
  const { id } = useParams();
  const navigate = useNavigate();
  const isEditMode = id !== "create";

  // fetch Item
  const { data: item, isLoading } = useQuery({
    queryKey: ["item", id],
    queryFn: () => customFetch<itemsProps>(`/menu/${id}`),
    enabled: isEditMode, // Completely skips fetching if creating a new item
  });

  const form = useForm({
    resolver: zodResolver(itemSchema),
    defaultValues: {
      name: "",
      description: undefined, // PortableText expects undefined, not[]
      price: 0,
      discount: 0,
      categoryId: "",
      isAvailable: true,
      image: "",
    },
    // `values` will automatically inject and re-render the form the exact millisecond `item` finishes loading! => later to edit
    values: item
      ? {
          name: item.name,
          description: item.description?.length ? item.description : undefined, // Ensure valid PortableText structure
          price: item.price,
          discount: item.discount || 0,
          categoryId: item.categoryId,
          isAvailable: item.isAvailable,
          image: item.image || "",
        }
      : undefined,
  });

  const categoryOptions = categories
    ? categories.data.map((category) => ({
        label: category.name,
        value: category.id,
      }))
    : [];

  const createMutation = useMutation({
    mutationFn: isEditMode ? updateMenuItem : createMenuItem,
    onSuccess: () => {
      toast.success(
        `Menu item ${isEditMode ? "updated" : "created"} successfully`,
      );
      navigate("/admin/menu");
    },
    onError: (error: any) => {
      console.error("Mutation error:", error);
      toast.error(`Failed to ${isEditMode ? "update" : "create"} menu item`);
    },
  });

  async function onSubmit(data: z.infer<typeof itemSchema>) {
    // console.log("form data:", data);
    if (isEditMode) {
      createMutation.mutate({ id: id!, data });
    } else {
      createMutation.mutate({ id: "", data });
    }
  }

  useEffect(() => {
    if (item) {
      if (item.recipe) {
        setRecipe(item.recipe);
      }
      if (item.aiSuggestion) {
        setAiSuggestion(item.aiSuggestion);
      }
      setItemId(item.id);
    }
  }, [item, setRecipe, setItemId]);

  // console.log("form errors:", form.formState.errors);
  if (!categories && isEditMode && isLoading) {
    return <Loader title="Loading Item Details..." className="min-h-[50vh]" />;
  }
  const pending = createMutation.isPending || form.formState.isSubmitting;
  return (
    <div className="mt-4">
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
        <CustomInput
          control={form.control}
          name="name"
          label="Title"
          placeholder="E.g. Cheeseburger"
          type="text"
          disabled={pending}
        />
        <div className="space-y-1.5">
          <Label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest ml-1">
            Description
          </Label>
          <Controller
            name="description"
            control={form.control}
            render={({ field }) => (
              <PortableTextEditorField
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
        </div>
        <div className="flex gap-4">
          {/* select */}
          <CustomSelect
            control={form.control}
            label="Category"
            name="categoryId"
            options={categoryOptions}
            placeholder="Select Category"
            title="Category"
            disabled={pending || !categories}
            loading={pending}
          />
          <div className="flex flex-col space-y-3 w-1/2">
            <Label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest ml-1">
              Available
            </Label>
            <Controller
              name="isAvailable"
              control={form.control}
              render={({ field }) => (
                <div className="flex items-center space-x-2 border rounded-xl p-3.5 shadow-sm">
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={(checked) => field.onChange(checked)}
                    disabled={pending}
                  />
                  <Label
                    className="text-sm font-medium text-slate-600 dark:text-slate-300 cursor-pointer"
                    onClick={() => field.onChange(!field.value)}
                  >
                    Is this menu item available?
                  </Label>
                </div>
              )}
            />
          </div>
        </div>
        <div className="flex gap-4">
          <CustomInput
            control={form.control}
            name="price"
            label="Price"
            placeholder="0.00"
            type="number"
            step="1"
            disabled={pending}
          />
          <CustomInput
            control={form.control}
            name="discount"
            label="Discount"
            placeholder="0.00"
            type="number"
            step="1"
            disabled={pending}
          />
        </div>
        {/* Image Dropzone */}
        <CustomImageDropzone
          control={form.control}
          name="image"
          label="Item Image"
        />
        <Button
          type="submit"
          className="py-6 px-6 float-right mt-4"
          disabled={pending}
        >
          {isEditMode ? "Update Menu Item" : "Create Menu Item"}
        </Button>
      </form>
    </div>
  );
};

export default Form;
