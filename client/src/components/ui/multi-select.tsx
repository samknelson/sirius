import * as React from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface MultiSelectOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
  detail?: string;
  labelClassName?: string;
  group?: string;
}

interface MultiSelectProps {
  "aria-label"?: string;
  options: MultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  triggerIcon?: React.ReactNode;
  className?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  testId?: string;
  testIdPrefix?: string;
  disabled?: boolean;
  selectionActions?: boolean;
}

/** Multi-select where an empty selection means no restriction. */
export function MultiSelect({
  "aria-label": ariaLabel,
  options,
  value,
  onChange,
  placeholder = "Select...",
  triggerIcon,
  className,
  searchPlaceholder = "Search...",
  emptyText = "No results.",
  testId,
  testIdPrefix,
  disabled,
  selectionActions = false,
}: MultiSelectProps) {
  const [open, setOpen] = React.useState(false);
  const selected = React.useMemo(() => new Set(value), [value]);
  const allValues = React.useMemo(() => Array.from(new Set(options.map(option => option.value))), [options]);
  const groups = React.useMemo(() => {
    const grouped = new Map<string, string[]>();
    for (const option of options) {
      if (option.group) grouped.set(option.group, [...(grouped.get(option.group) ?? []), option.value]);
    }
    return Array.from(grouped, ([label, values]) => ({ label, values }));
  }, [options]);
  const label = value.length === 0
    ? placeholder
    : value.length === 1
      ? options.find(option => option.value === value[0])?.label ?? value[0]
      : `${value.length} selected`;

  const changeGroup = (values: string[], include: boolean) => {
    const groupSet = new Set(values);
    onChange(include
      ? Array.from(new Set([...value, ...values]))
      : value.filter(item => !groupSet.has(item)));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-label={ariaLabel}
          aria-expanded={open} aria-haspopup="listbox" disabled={disabled}
          data-testid={testId} className={cn("h-9 w-full justify-between font-normal", className)}>
          <span className="flex min-w-0 flex-1 items-center gap-2 truncate">
            {triggerIcon}{label}
          </span>
          <span className="ml-2 flex shrink-0 items-center gap-1">
            {value.length > 0 && !disabled && (
              <span role="button" tabIndex={0} aria-label="Clear selection"
                onClick={event => { event.stopPropagation(); onChange([]); }}
                onKeyDown={event => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    onChange([]);
                  }
                }} className="rounded-sm p-0.5 opacity-60 hover:bg-muted hover:opacity-100">
                <X size={14} />
              </span>
            )}
            <ChevronsUpDown size={14} className="opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-64 p-0" align="start">
        {selectionActions && (
          <div className="space-y-2 border-b p-2">
            <div role="group" aria-label="Bulk selection" className="flex gap-1">
              <Button type="button" variant="ghost" size="sm" className="flex-1" disabled={!allValues.length}
                data-testid={testId ? `${testId}-all` : undefined} onClick={() => onChange(allValues)}>All</Button>
              <Button type="button" variant="ghost" size="sm" className="flex-1" disabled={!value.length}
                data-testid={testId ? `${testId}-none` : undefined} onClick={() => onChange([])}>None</Button>
              <Button type="button" variant="ghost" size="sm" className="flex-1" disabled={!allValues.length}
                data-testid={testId ? `${testId}-invert` : undefined}
                onClick={() => onChange(allValues.filter(item => !selected.has(item)))}>Invert</Button>
            </div>
            <p className="px-1 text-xs text-muted-foreground">Actions include all choices, including those hidden by search.</p>
            {groups.length > 0 && (
              <details>
                <summary className="cursor-pointer px-1 py-1 text-xs font-medium">Select by group</summary>
                <div className="max-h-40 space-y-1 overflow-y-auto pt-1">
                  {groups.map(group => (
                    <div key={group.label} role="group" aria-label={group.label} className="flex items-center gap-1">
                      <span className="min-w-0 flex-1 truncate pl-1 text-xs">{group.label} ({group.values.length})</span>
                      <Button type="button" variant="ghost" size="sm" aria-label={`${group.label}: Select all`}
                        onClick={() => changeGroup(group.values, true)}>All</Button>
                      <Button type="button" variant="ghost" size="sm" aria-label={`${group.label}: Select none`}
                        onClick={() => changeGroup(group.values, false)}>None</Button>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map(option => (
                <CommandItem key={option.value} value={`${option.label} ${option.detail ?? ""}`}
                  onSelect={() => onChange(selected.has(option.value)
                    ? value.filter(item => item !== option.value)
                    : [...value, option.value])}
                  data-testid={testIdPrefix ? `${testIdPrefix}-${option.value}` : undefined}
                  className="cursor-pointer">
                  <Check size={16} className={cn("mr-2 shrink-0", selected.has(option.value) ? "opacity-100" : "opacity-0")} />
                  {option.icon && <span className="mr-2 flex items-center">{option.icon}</span>}
                  <span className={cn("truncate", option.labelClassName)}>{option.label}</span>
                  {option.detail && <span className="ml-2 truncate text-xs text-muted-foreground">{option.detail}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
