import type { WidgetProps } from "@rjsf/utils";
import { SimpleHtmlEditor } from "@/components/ui/simple-html-editor";

export function HtmlEditorWidget(props: WidgetProps) {
  const { id, value, onChange, disabled, readonly, placeholder } = props;
  return (
    <SimpleHtmlEditor
      data-testid={`editor-${id}`}
      value={typeof value === "string" ? value : ""}
      onChange={(v: string) => onChange(v)}
      disabled={disabled || readonly}
      placeholder={placeholder}
    />
  );
}
