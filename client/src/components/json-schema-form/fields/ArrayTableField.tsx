import { useMemo } from "react";
import type { FieldProps } from "@rjsf/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, RotateCcw } from "lucide-react";

/**
 * Generic RJSF field for an array of flat objects rendered as an
 * editable table. Triggered by the vendor key `x-widget: "array-table"`
 * (see SchemaForm's uiSchema mapping). Columns are derived from
 * `items.properties`; each property's input type comes from its JSON
 * Schema (`format: "date"` → date input, `type: number|integer` →
 * number input, otherwise text).
 *
 * Supported item-level hints:
 *  - `minItems` on the array disables the remove button once the row
 *    count reaches the minimum.
 *  - `x-reset-to-default: true` plus an array `default` renders a
 *    "Reset to defaults" button.
 *
 * Row ordering is left as stored; one-time display sorting (e.g. newest
 * effective date first) is applied by the host when it builds the
 * initial form data via `sortArrayTableSettings`.
 */

interface ColumnDef {
  key: string;
  title: string;
  inputType: "date" | "number" | "text";
  step?: string;
}

function deriveColumns(itemsSchema: unknown): ColumnDef[] {
  const props =
    (itemsSchema as { properties?: Record<string, Record<string, unknown>> })
      ?.properties ?? {};
  return Object.entries(props).map(([key, sub]) => {
    let inputType: ColumnDef["inputType"] = "text";
    let step: string | undefined;
    if (sub?.format === "date") {
      inputType = "date";
    } else if (sub?.type === "number") {
      inputType = "number";
      step = "0.01";
    } else if (sub?.type === "integer") {
      inputType = "number";
      step = "1";
    }
    return {
      key,
      title: (sub?.title as string) || key,
      inputType,
      step,
    };
  });
}

type Row = Record<string, unknown>;

export function ArrayTableField(props: FieldProps) {
  const { schema, formData, onChange, disabled, readonly, idSchema, fieldPathId } =
    props as FieldProps & { idSchema?: { $id?: string } };
  const schemaAny = schema as Record<string, unknown>;
  const columns = useMemo(() => deriveColumns(schemaAny.items), [schemaAny.items]);
  const rows: Row[] = Array.isArray(formData) ? (formData as Row[]) : [];
  const minItems = (schemaAny.minItems as number) ?? 0;
  const canReset = schemaAny["x-reset-to-default"] === true;
  const defaultRows = schemaAny.default;
  const baseId = fieldPathId?.$id ?? idSchema?.$id ?? "array-table";
  const ro = disabled || readonly;

  const blankRow = (): Row => {
    const r: Row = {};
    for (const c of columns) {
      r[c.key] = c.inputType === "number" ? undefined : "";
    }
    return r;
  };

  const update = (next: Row[]) => onChange(next as never, fieldPathId.path);

  const setCell = (idx: number, col: ColumnDef, raw: string) => {
    const next = rows.map((row, i) => {
      if (i !== idx) return row;
      let v: unknown = raw;
      if (col.inputType === "number") {
        if (raw === "") {
          v = undefined;
        } else {
          const n = Number(raw);
          v = Number.isNaN(n) ? undefined : n;
        }
      }
      return { ...row, [col.key]: v };
    });
    update(next);
  };

  return (
    <div className="space-y-3" data-testid={`array-table-${baseId}`}>
      <div className="flex items-end justify-between gap-4">
        <div>
          {schemaAny.title ? (
            <Label className="text-base font-semibold">
              {schemaAny.title as string}
            </Label>
          ) : null}
          {schemaAny.description ? (
            <p className="text-sm text-muted-foreground">
              {schemaAny.description as string}
            </p>
          ) : null}
        </div>
        <div className="flex gap-2 shrink-0">
          {canReset && Array.isArray(defaultRows) ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={ro}
              onClick={() => update((defaultRows as Row[]).map((r) => ({ ...r })))}
              data-testid={`button-reset-${baseId}`}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Reset to defaults
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={ro}
            onClick={() => update([...rows, blankRow()])}
            data-testid={`button-add-${baseId}`}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {rows.length === 0 ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid={`empty-${baseId}`}
          >
            No entries.
          </p>
        ) : null}
        {rows.map((row, idx) => (
          <div
            key={idx}
            className="grid gap-3 items-end p-3 border rounded-md"
            style={{
              gridTemplateColumns: `repeat(${columns.length}, 1fr) auto`,
            }}
          >
            {columns.map((col) => (
              <div key={col.key} className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  {col.title}
                </Label>
                <Input
                  type={col.inputType}
                  step={col.step}
                  value={(row?.[col.key] as string | number | undefined) ?? ""}
                  disabled={ro}
                  onChange={(e) => setCell(idx, col, e.target.value)}
                  data-testid={`input-${baseId}-${col.key}-${idx}`}
                />
              </div>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={ro || rows.length <= minItems}
              onClick={() => update(rows.filter((_, i) => i !== idx))}
              data-testid={`button-remove-${baseId}-${idx}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
