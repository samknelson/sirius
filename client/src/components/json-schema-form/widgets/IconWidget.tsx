import type { WidgetProps } from "@rjsf/utils";
import { IconPicker } from "@/components/ui/icon-picker";

/**
 * Widget for icon-name fields. Used by unified-options resources that
 * declare `"x-widget": "icon"` in their JSON Schema. Wraps the existing
 * `IconPicker` so saved icon names match the rest of the app.
 */
export function IconWidget(props: WidgetProps) {
  const { id, value, onChange, placeholder, disabled, readonly } = props;
  return (
    <IconPicker
      value={typeof value === "string" && value ? value : undefined}
      onChange={(icon) => onChange(icon ?? undefined)}
      placeholder={placeholder || "Select an icon (optional)"}
      data-testid={`picker-${id}`}
      {...(disabled || readonly ? { className: "pointer-events-none opacity-60" } : {})}
    />
  );
}
