import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import type { PluginConfigField } from "@shared/plugin-config";

interface OptionItem {
  id: string;
  name: string;
}

export interface PluginConfigFormProps {
  fields: PluginConfigField[];
  value: Record<string, unknown>;
  onChange: (newValue: Record<string, unknown>) => void;
  errors?: Record<string, string>;
  enabled?: boolean;
  testIdPrefix?: string;
}

export function PluginConfigForm({
  fields,
  value,
  onChange,
  errors,
  enabled = true,
  testIdPrefix,
}: PluginConfigFormProps) {
  const selectOptionsTypes = useMemo(
    () =>
      fields
        .filter((f) => f.inputType === "select-options" && f.selectOptionsType)
        .map((f) => f.selectOptionsType as string)
        .filter((v, i, arr) => arr.indexOf(v) === i),
    [fields],
  );

  const optionsQueries = useQueries({
    queries: selectOptionsTypes.map((type) => ({
      queryKey: ["/api/options", type],
      enabled,
    })),
  });

  const optionsData = useMemo(() => {
    const data: Record<string, OptionItem[]> = {};
    selectOptionsTypes.forEach((type, index) => {
      const result = optionsQueries[index]?.data;
      if (result) data[type] = result as OptionItem[];
    });
    return data;
  }, [selectOptionsTypes, optionsQueries]);

  const optionsLoading = optionsQueries.some((q) => q.isLoading);

  const setField = (name: string, fieldValue: unknown) => {
    onChange({ ...value, [name]: fieldValue });
  };

  const tid = (suffix: string) => (testIdPrefix ? `${testIdPrefix}-${suffix}` : suffix);

  const renderField = (field: PluginConfigField) => {
    const fieldValue = value[field.name];

    switch (field.inputType) {
      case "select-options": {
        const dynamicOptions = field.selectOptionsType
          ? optionsData[field.selectOptionsType] || []
          : [];
        const staticOptions: OptionItem[] = (field.options || []).map((o) => ({
          id: o.value,
          name: o.label,
        }));
        const options = field.selectOptionsType ? dynamicOptions : staticOptions;
        const isLoading = field.selectOptionsType && optionsLoading;

        if (isLoading) {
          return (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading options...
            </div>
          );
        }

        if (options.length === 0) {
          return (
            <p className="text-sm text-muted-foreground">
              No options available for this field.
            </p>
          );
        }

        if (field.multiSelect) {
          const selected = Array.isArray(fieldValue) ? (fieldValue as string[]) : [];
          const toggle = (optionId: string, checked: boolean) => {
            const current = Array.isArray(value[field.name])
              ? (value[field.name] as string[])
              : [];
            const updated = checked
              ? [...current, optionId]
              : current.filter((id) => id !== optionId);
            setField(field.name, updated);
          };

          return (
            <div className="space-y-2 max-h-48 overflow-y-auto border rounded-md p-2">
              {options.map((option) => (
                <div key={option.id} className="flex items-center space-x-2">
                  <Checkbox
                    id={`${field.name}-${option.id}`}
                    checked={selected.includes(option.id)}
                    onCheckedChange={(checked) => toggle(option.id, checked === true)}
                    data-testid={tid(`checkbox-${field.name}-${option.id}`)}
                  />
                  <Label
                    htmlFor={`${field.name}-${option.id}`}
                    className="text-sm font-normal cursor-pointer"
                  >
                    {option.name}
                  </Label>
                </div>
              ))}
            </div>
          );
        }

        const selectedValue = typeof fieldValue === "string" ? fieldValue : "";
        return (
          <Select
            value={selectedValue || "_none_"}
            onValueChange={(v) =>
              setField(field.name, v === "_none_" ? null : v)
            }
          >
            <SelectTrigger data-testid={tid(`select-${field.name}`)}>
              <SelectValue placeholder={`Select ${field.label.toLowerCase()}`} />
            </SelectTrigger>
            <SelectContent>
              {!field.required && <SelectItem value="_none_">None</SelectItem>}
              {options.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      }

      case "text":
        return (
          <Input
            value={typeof fieldValue === "string" ? fieldValue : ""}
            onChange={(e) => setField(field.name, e.target.value)}
            data-testid={tid(`input-${field.name}`)}
          />
        );

      case "number":
        return (
          <Input
            type="number"
            value={typeof fieldValue === "number" ? fieldValue : ""}
            onChange={(e) => {
              const v = e.target.value.trim();
              setField(field.name, v === "" ? null : parseInt(v));
            }}
            data-testid={tid(`input-${field.name}`)}
          />
        );

      case "checkbox":
        return (
          <Checkbox
            checked={!!fieldValue}
            onCheckedChange={(checked) => setField(field.name, checked === true)}
            data-testid={tid(`checkbox-${field.name}`)}
          />
        );

      default:
        return null;
    }
  };

  if (fields.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-2">
        This plugin has no configurable options.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {fields.map((field) => (
        <div key={field.name} className="space-y-2">
          <Label htmlFor={field.name}>
            {field.label}
            {field.required && <span className="text-destructive ml-1">*</span>}
          </Label>
          {renderField(field)}
          {errors?.[field.name] && (
            <p className="text-sm text-destructive">{errors[field.name]}</p>
          )}
          {field.helperText && !errors?.[field.name] && (
            <p className="text-sm text-muted-foreground">{field.helperText}</p>
          )}
        </div>
      ))}
    </div>
  );
}

export function validatePluginConfig(
  fields: PluginConfigField[],
  value: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    if (!field.required) continue;
    const v = value[field.name];
    if (field.inputType === "select-options" && field.multiSelect) {
      if (!Array.isArray(v) || v.length === 0) {
        errors[field.name] = `${field.label} is required`;
      }
    } else if (v === undefined || v === null || v === "") {
      errors[field.name] = `${field.label} is required`;
    }
  }
  return errors;
}
