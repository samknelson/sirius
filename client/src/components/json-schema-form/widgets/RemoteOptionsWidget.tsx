import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WidgetProps } from "@rjsf/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

interface OptionItem {
  id: string;
  name: string;
}

/**
 * Widget for fields tagged with `x-options-resource: "<options-type>"`.
 * Fetches /api/options/:type and renders either a single Select or a
 * checkbox list (when the underlying schema is an array of strings).
 */
export function RemoteOptionsWidget(props: WidgetProps) {
  const {
    id,
    schema,
    value,
    required,
    disabled,
    readonly,
    onChange,
    label,
    placeholder,
  } = props;

  const optionsType = (schema as Record<string, unknown>)["x-options-resource"] as string | undefined;
  const isMulti = (schema as { type?: string }).type === "array";

  const { data: options, isLoading } = useQuery<OptionItem[]>({
    queryKey: ["/api/options", optionsType],
    enabled: !!optionsType,
  });

  const selectedSet = useMemo(
    () => new Set(Array.isArray(value) ? (value as string[]) : []),
    [value],
  );

  if (!optionsType) {
    return (
      <p className="text-sm text-destructive">
        Missing x-options-resource for field {label || id}
      </p>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading options...
      </div>
    );
  }

  const list = options ?? [];

  if (list.length === 0) {
    return <p className="text-sm text-muted-foreground">No options available.</p>;
  }

  if (isMulti) {
    const toggle = (optionId: string, checked: boolean) => {
      const current = Array.isArray(value) ? (value as string[]) : [];
      onChange(checked ? [...current, optionId] : current.filter((v) => v !== optionId));
    };
    return (
      <div className="space-y-2 max-h-48 overflow-y-auto border rounded-md p-2" id={id}>
        {list.map((opt) => (
          <div key={opt.id} className="flex items-center space-x-2">
            <Checkbox
              id={`${id}-${opt.id}`}
              checked={selectedSet.has(opt.id)}
              onCheckedChange={(c) => toggle(opt.id, c === true)}
              disabled={disabled || readonly}
              data-testid={`checkbox-${id}-${opt.id}`}
            />
            <Label
              htmlFor={`${id}-${opt.id}`}
              className="text-sm font-normal cursor-pointer"
            >
              {opt.name}
            </Label>
          </div>
        ))}
      </div>
    );
  }

  const selected = typeof value === "string" ? value : "";
  return (
    <Select
      value={selected || "_none_"}
      onValueChange={(v) => onChange(v === "_none_" ? undefined : v)}
      disabled={disabled || readonly}
    >
      <SelectTrigger id={id} data-testid={`select-${id}`}>
        <SelectValue placeholder={placeholder || `Select ${label?.toLowerCase() || ""}`} />
      </SelectTrigger>
      <SelectContent>
        {!required && <SelectItem value="_none_">None</SelectItem>}
        {list.map((opt) => (
          <SelectItem key={opt.id} value={opt.id}>
            {opt.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
