import { Control, useFieldArray, UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Plus, Trash2 } from "lucide-react";
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

interface RateHistoryColumn<T> {
  key: keyof T;
  label: string;
  type?: "text" | "number" | "date";
  step?: string;
  renderInput?: (params: {
    field: any;
    index: number;
    remove: (index: number) => void;
  }) => React.ReactNode;
}

interface RateHistorySectionProps<T extends Record<string, any>> {
  control: Control<any>;
  name: string;
  title?: string;
  columns: RateHistoryColumn<T>[];
  defaultEntry: T;
  testIdPrefix?: string;
}

/**
 * Reusable Rate History Section Component
 * 
 * Handles dynamic rate history entries with add/remove functionality.
 * Supports custom column configurations and render functions.
 * 
 * @example
 * ```tsx
 * <RateHistorySection
 *   control={form.control}
 *   name="rateHistory"
 *   title="Rate History"
 *   columns={[
 *     { key: "effectiveDate", label: "Effective Date", type: "date" },
 *     { key: "rate", label: "Rate", type: "number", step: "0.01" },
 *   ]}
 *   defaultEntry={{ effectiveDate: "", rate: 0 }}
 * />
 * ```
 */
export function RateHistorySection<T extends Record<string, any>>({
  control,
  name,
  title = "Rate History",
  columns,
  defaultEntry,
  testIdPrefix = "rate",
}: RateHistorySectionProps<T>) {
  const { fields, append, remove } = useFieldArray({
    control,
    name,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label className="text-base font-semibold">{title}</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => append(defaultEntry)}
          data-testid={`button-add-${testIdPrefix}`}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add Rate
        </Button>
      </div>

      <div className="space-y-3">
        {fields.map((field, index) => (
          <div
            key={field.id}
            className="grid gap-3 items-start p-3 border rounded-md"
            style={{
              gridTemplateColumns: `repeat(${columns.length}, 1fr) auto`,
            }}
          >
            {columns.map((column) => (
              <FormField
                key={`${field.id}-${String(column.key)}`}
                control={control}
                name={`${name}.${index}.${String(column.key)}`}
                render={({ field: inputField }) => (
                  <>
                    {column.renderInput ? (
                      column.renderInput({
                        field: inputField,
                        index,
                        remove,
                      })
                    ) : (
                      <FormItem>
                        <FormLabel>{column.label}</FormLabel>
                        <FormControl>
                          <Input
                            type={column.type || "text"}
                            step={column.step}
                            {...inputField}
                            onChange={(e) => {
                              if (column.type === "number") {
                                // Allow empty string for validation, otherwise parse to number
                                const value = e.target.value;
                                if (value === "") {
                                  inputField.onChange("");
                                } else {
                                  const parsed = parseFloat(value);
                                  inputField.onChange(isNaN(parsed) ? "" : parsed);
                                }
                              } else {
                                inputField.onChange(e.target.value);
                              }
                            }}
                            data-testid={`input-${testIdPrefix}-${String(column.key)}-${index}`}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  </>
                )}
              />
            ))}
            <div className="flex items-end h-full pb-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => remove(index)}
                disabled={fields.length === 1}
                data-testid={`button-remove-${testIdPrefix}-${index}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
