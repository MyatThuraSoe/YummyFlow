import {
  type Control,
  Controller,
  type FieldValues,
  type Path,
} from "react-hook-form";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface CustomInputProps<T extends FieldValues> extends Omit<
  ComponentProps<typeof Input>,
  "name"
> {
  control: Control<T>;
  name: Path<T>;
  label: string;
  description?: string;
  startIcon?: ReactNode;
}

export function CustomInput<T extends FieldValues>({
  control,
  name,
  label,
  description,
  disabled,
  startIcon,
  className,
  ...props
}: CustomInputProps<T>) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid} className="space-y-1.5">
          <FieldLabel
            htmlFor={name}
            className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest ml-1"
          >
            {label}
          </FieldLabel>

          <div className="relative group">
            {startIcon && (
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 group-focus-within:text-primary transition-colors pointer-events-none z-10">
                {startIcon}
              </div>
            )}

            <Input
              id={name}
              disabled={disabled}
              {...field}
              {...props}
              className={cn(
                // Base Layout
                "w-full rounded-xl py-6", // py-6 handles height better for this design
                startIcon ? "pl-12" : "pl-4",
                "pr-4 text-sm transition-all outline-none shadow-sm",

                // Error State
                fieldState.invalid &&
                  "border-red-300 focus:border-red-500 focus:ring-red-200 dark:border-red-900 dark:focus:ring-red-900/30",

                className,
              )}
            />
          </div>

          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}

          {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
        </Field>
      )}
    />
  );
}
