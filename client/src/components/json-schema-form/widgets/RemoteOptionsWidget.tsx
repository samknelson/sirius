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
  [extra: string]: unknown;
}

/**
 * Widget for fields tagged with `x-options-resource: "<options-type>"`.
 * Fetches /api/options/:type and renders either a single Select or a
 * checkbox list (when the underlying schema is an array of strings).
 *
 * A checkbox list can be grouped: `x-options-group-by: "<field>"` names the
 * option field holding the group id and `x-options-group-resource:
 * "<options-type>"` the lookup that names the groups (in its own order).
 * Options whose group is unknown are listed last, ungrouped.
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
  // Alternative source: a full API endpoint (e.g. "/api/ledger/accounts")
  // returning an array of { id, name } rows. Takes precedence when present.
  const optionsEndpoint = (schema as Record<string, unknown>)["x-options-endpoint"] as string | undefined;
  const groupBy = (schema as Record<string, unknown>)["x-options-group-by"] as string | undefined;
  const groupResource = (schema as Record<string, unknown>)["x-options-group-resource"] as string | undefined;
  const isMulti = (schema as { type?: string }).type === "array";
  const grouped = isMulti && !!groupBy && !!groupResource;

  const { data: options, isLoading } = useQuery<OptionItem[]>({
    queryKey: optionsEndpoint ? [optionsEndpoint] : ["/api/options", optionsType],
    enabled: !!(optionsEndpoint || optionsType),
  });
  const { data: groupOptions, isLoading: groupsLoading } = useQuery<OptionItem[]>({
    queryKey: ["/api/options", groupResource],
    enabled: grouped,
  });

  const selectedSet = useMemo(
    () => new Set(Array.isArray(value) ? (value as string[]) : []),
    [value],
  );

  // Group headings in the lookup's order, each with its options in list
  // order; a trailing heading-less group collects options whose group id
  // names no known group.
  const groups = useMemo(() => {
    if (!grouped) return null;
    const list = options ?? [];
    const named = (groupOptions ?? []).map((g) => ({
      key: g.id,
      name: g.name,
      items: list.filter((opt) => opt[groupBy!] === g.id),
    }));
    const known = new Set(named.map((g) => g.key));
    const rest = list.filter((opt) => !known.has(String(opt[groupBy!])));
    return [
      ...named.filter((g) => g.items.length > 0),
      ...(rest.length > 0 ? [{ key: "__ungrouped__", name: null, items: rest }] : []),
    ];
  }, [grouped, options, groupOptions, groupBy]);

  if (!optionsType && !optionsEndpoint) {
    return (
      <p className="text-sm text-destructive">
        Missing x-options-resource for field {label || id}
      </p>
    );
  }

  if (isLoading || (grouped && groupsLoading)) {
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
    const row = (opt: OptionItem) => (
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
    );
    return (
      <div className={`space-y-2 ${groups ? "max-h-72" : "max-h-48"} overflow-y-auto border rounded-md p-2`} id={id}>
        {groups
          ? groups.map((group) => (
              <div key={group.key} className="space-y-2" data-testid={`options-group-${id}-${group.key}`}>
                {group.name && (
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground pt-1">
                    {group.name}
                  </div>
                )}
                {group.items.map(row)}
              </div>
            ))
          : list.map(row)}
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
