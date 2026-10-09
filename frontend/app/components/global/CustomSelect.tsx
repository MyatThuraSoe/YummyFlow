import {
  type Control,
  Controller,
  type FieldValues,
  type Path,
} from "react-hook-form";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";

export interface SelectOption {
  label: string;
  value: string;
}

interface CustomSelectProps<T extends FieldValues> {
  control: Control<T>;
  name: Path<T>;
  label: string;
  placeholder?: string;
  options: SelectOption[];
  disabled?: boolean;
  loading?: boolean;
  title?: string;
}

export function CustomSelect<T extends FieldValues>({
  control,
  name,
  label,
  placeholder = "Select...",
  options,
  disabled,
  loading = false,
  title,
}: CustomSelectProps<T>) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={name}>{label}</FieldLabel>
          <Select
            onValueChange={(value) => field.onChange(value)}
            // Handle empty strings gracefully so placeholder shows
            value={field.value || undefined}
            disabled={disabled}
          >
            <SelectTrigger id={name} className="py-6">
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent className="p-1">
              <SelectGroup>
                {title && <SelectLabel>{title}</SelectLabel>}
                {loading && <SelectItem value="loading">Loading...</SelectItem>}
                {options.map((option) => (
                  <SelectItem
                    key={option.value}
                    value={option.value}
                    className="p-2"
                  >
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
        </Field>
      )}
    />
  );
}
