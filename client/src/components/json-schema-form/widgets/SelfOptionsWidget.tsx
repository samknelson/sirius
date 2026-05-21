import type { WidgetProps } from "@rjsf/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SchemaFormContext } from "../SchemaForm";

/**
 * Widget for hierarchical "parent" pickers (x-options-self: true).
 * Reads the candidate list and the current row id from form context so
 * we don't refetch the same collection that owns the form. The row
 * being edited is excluded to prevent self-parenting.
 */
export function SelfOptionsWidget(props: WidgetProps<unknown, never, SchemaFormContext>) {
  const { id, value, label, disabled, readonly, onChange, formContext, required } = props;
  const items: Array<{ id: string; name: string }> = formContext?.selfItems ?? [];
  const editingId = formContext?.editingId ?? null;
  const candidates = items.filter((i: { id: string }) => i.id !== editingId);
  const selected = typeof value === "string" ? value : "";

  return (
    <Select
      value={selected || "_none_"}
      onValueChange={(v) => onChange(v === "_none_" ? null : v)}
      disabled={disabled || readonly}
    >
      <SelectTrigger id={id} data-testid={`select-${id}`}>
        <SelectValue placeholder={`No ${(label || "parent").toLowerCase()}`} />
      </SelectTrigger>
      <SelectContent>
        {!required && (
          <SelectItem value="_none_">No {(label || "parent").toLowerCase()}</SelectItem>
        )}
        {candidates.map((opt: { id: string; name: string }) => (
          <SelectItem key={opt.id} value={opt.id}>
            {opt.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
