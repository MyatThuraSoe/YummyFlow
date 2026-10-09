import {
  Controller,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { useState } from "react";
import Loader from "./Loader";
import { CloudUpload, X } from "lucide-react";
import { useEdgeStore } from "@/lib/useEdgestore";
import toast from "react-hot-toast";

interface CustomImageDropzoneProps<T extends FieldValues> {
  control: Control<T>;
  name: Path<T>;
  label: string;
  description?: string;
}

export function CustomImageDropzone<T extends FieldValues>({
  control,
  name,
  label,
  description,
}: CustomImageDropzoneProps<T>) {
  const { edgestore } = useEdgeStore();
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [progress, setProgress] = useState(0);

  // Handle the actual upload to EdgeStore
  const handleUpload = async (
    file: File | undefined,
    onChange: (url: string) => void,
  ) => {
    if (!file) return;

    try {
      setIsUploading(true);
      const res = await edgestore.publicFiles.upload({
        file,
        onProgressChange: (progress) => {
          setProgress(progress);
        },
      });
      toast.success("Image uploaded successfully");
      onChange(res.url); // Update the form with the new image URL
    } catch (error) {
      console.error("Failed to upload image:", error);
      toast.error("Failed to upload image");
    } finally {
      setIsUploading(false);
      setProgress(0);
    }
  };

  //   delete image function to remove the image from the form and edgestore
  const handleDeleteImage = async ({
    urlToDelete,
    onChange,
  }: {
    urlToDelete: string;
    onChange: (url: string) => void;
  }) => {
    setIsDeleting(true);
    await edgestore.publicFiles
      .delete({
        url: urlToDelete,
      })
      .then(() => {
        toast.success("Image deleted successfully");
        onChange(""); // Clear the image from the form
        setIsDeleting(false);
      })
      .catch((error) => {
        toast.error("Failed to delete image");
        console.error("Failed to delete image:", error);
        setIsDeleting(false);
      });
  };
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <Field
          data-invalid={fieldState.invalid}
          className={cn(
            "space-y-1.5",
            fieldState.invalid && "border-red-300 bg-red-50/50",
            field.value && "w-fit",
          )}
        >
          <FieldLabel
            htmlFor={name}
            className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest ml-1"
          >
            {label}
          </FieldLabel>

          {/*  */}
          {field.value ? (
            <div className="relative w-full h-48 rounded-2xl overflow-hidden border border-border mt-2">
              <img
                src={field.value}
                alt="image"
                className="w-full h-full object-cover"
              />
              <button
                type="button"
                onClick={() =>
                  handleDeleteImage({
                    urlToDelete: field.value,
                    onChange: field.onChange,
                  })
                } // Call the delete function
                disabled={isUploading || isDeleting}
                className="absolute top-2 right-2 bg-white/80 p-1.5 rounded-full hover:bg-white text-slate-800 transition-colors shadow-sm disabled:bg-white/50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <label
              className={`mt-2 relative w-full flex flex-col items-center justify-center border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl bg-transparent py-10 transition-colors cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/50 ${
                fieldState.invalid ? "border-red-300 bg-red-50/50" : ""
              } ${isUploading ? "pointer-events-none opacity-80" : ""}`}
              onDragOver={(e) => {
                e.preventDefault(); // Required to allow dropping
              }}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                handleUpload(file, field.onChange);
              }}
            >
              {/* Hidden HTML input */}
              <input
                type="file"
                className="hidden"
                accept="image/png, image/jpeg"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  handleUpload(file, field.onChange);
                }}
                disabled={isUploading || isDeleting}
              />

              {isUploading ? (
                // Loading State UI
                <div className="flex flex-col items-center text-slate-800 dark:text-slate-200">
                  <Loader title="Loading..." />
                  <span className="text-sm font-medium">
                    Uploading... {progress}%
                  </span>
                </div>
              ) : (
                // Idle State UI
                <div className="flex flex-col items-center text-center">
                  <CloudUpload className="w-8 h-8 text-slate-800 dark:text-slate-200 mb-4" />
                  <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                    Choose a file or drag & drop it here
                  </span>
                  <span className="text-xs text-slate-500 mt-1">
                    JPG or PNG formats, up to 5MB
                  </span>
                  <div className="mt-6 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 rounded-full px-8 py-2 text-sm font-medium shadow-sm transition-colors">
                    Browse File
                  </div>
                </div>
              )}
            </label>
          )}

          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}

          {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
        </Field>
      )}
    />
  );
}
