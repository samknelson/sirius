import { useMemo } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * The type filter shared by the notes tab and the files tab.
 *
 * The two frameworks are deliberately congruent, so the control they hand the
 * user is ONE component rather than two lookalikes that drift apart.
 *
 * It filters the rows a tab has ALREADY loaded — no query, no request, nothing
 * remembered between visits — and its choices come from the types actually
 * present on this record rather than from every type an administrator has
 * configured. That way every choice returns at least one row, and a type that
 * has since been de-scoped from the area is still reachable on the rows that
 * carry it.
 */

/** Sentinel values: a Select cannot hold an empty string. */
export const TYPE_FILTER_ALL = "__all__";
export const TYPE_FILTER_UNTYPED = "__untyped__";

export interface TypeFilterChoice {
  value: string;
  label: string;
}

export const ALL_TYPES: TypeFilterChoice = { value: TYPE_FILTER_ALL, label: "All types" };

/** What the filter needs to know about a row: its type, if it has one. */
export interface TypeFilterRow {
  typeId: string | null;
  typeName: string | null;
}

/**
 * The choices to offer, taken from the rows themselves.
 *
 * The current selection is kept even once its last row is gone (deleted, or
 * retyped) — the control must be able to say what it is filtering to, rather
 * than silently falling back to showing everything.
 */
export function buildTypeFilterChoices(
  rows: TypeFilterRow[],
  selected: TypeFilterChoice,
): TypeFilterChoice[] {
  const byValue = new Map<string, string>();
  for (const row of rows) {
    const value = row.typeId ?? TYPE_FILTER_UNTYPED;
    if (byValue.has(value)) continue;
    byValue.set(value, row.typeId ? (row.typeName ?? "Unknown type") : "No type");
  }
  if (selected.value !== TYPE_FILTER_ALL && !byValue.has(selected.value)) {
    byValue.set(selected.value, selected.label);
  }
  return [...byValue.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => {
      // Untyped rows are a real group, but they belong at the bottom.
      if (a.value === TYPE_FILTER_UNTYPED) return 1;
      if (b.value === TYPE_FILTER_UNTYPED) return -1;
      return a.label.localeCompare(b.label);
    });
}

/** Whether one row survives the current selection. */
export function typeFilterMatches(selected: TypeFilterChoice, row: TypeFilterRow): boolean {
  if (selected.value === TYPE_FILTER_ALL) return true;
  if (selected.value === TYPE_FILTER_UNTYPED) return row.typeId === null;
  return row.typeId === selected.value;
}

export function TypeFilter({
  id,
  value,
  onChange,
  choices,
  shown,
  total,
}: {
  /** Unique per tab, so the label points at this tab's control. */
  id: string;
  value: TypeFilterChoice;
  onChange: (choice: TypeFilterChoice) => void;
  choices: TypeFilterChoice[];
  /** Rows currently visible, and rows on the record, for the summary line. */
  shown: number;
  total: number;
}) {
  const filtering = value.value !== TYPE_FILTER_ALL;
  const byValue = useMemo(
    () => new Map([ALL_TYPES, ...choices].map((choice) => [choice.value, choice])),
    [choices],
  );

  // Nothing to narrow: no rows, or every row the same type. A filter already
  // in effect keeps its control, so it can always be undone.
  if (choices.length < 2 && !filtering) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 mb-4" data-testid="filter-type">
      <Label htmlFor={id} className="text-sm text-muted-foreground">
        Type
      </Label>
      <Select
        value={value.value}
        onValueChange={(next) => onChange(byValue.get(next) ?? ALL_TYPES)}
      >
        <SelectTrigger id={id} className="h-8 w-56" data-testid="select-type-filter">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_TYPES.value} data-testid="option-type-filter-all">
            {ALL_TYPES.label}
          </SelectItem>
          {choices.map((choice) => (
            <SelectItem
              key={choice.value}
              value={choice.value}
              data-testid={`option-type-filter-${choice.value}`}
            >
              {choice.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {filtering && (
        <span className="text-xs text-muted-foreground" data-testid="text-type-filter-summary">
          Showing {shown} of {total}
        </span>
      )}
    </div>
  );
}
