import type { WidgetProps } from "@rjsf/utils";
import { Input } from "@/components/ui/input";

/**
 * Widget for color-string fields. Renders a native color picker plus a
 * synced text input so the hex value is visible/editable. Used by
 * fields tagged `"x-widget": "color"` in JSON Schema.
 */
export function ColorWidget(props: WidgetProps) {
  const { id, value, onChange, disabled, readonly } = props;
  const v = typeof value === "string" && value ? value : "";
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={v || "#6b7280"}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || readonly}
        className="h-9 w-12 rounded border cursor-pointer"
        data-testid={`color-${id}`}
      />
      <Input
        value={v}
        onChange={(e) => onChange(e.target.value || undefined)}
        placeholder="#000000"
        disabled={disabled || readonly}
        className="font-mono w-32"
        data-testid={`color-text-${id}`}
      />
    </div>
  );
}
