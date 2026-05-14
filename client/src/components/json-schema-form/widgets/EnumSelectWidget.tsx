import type { FocusEvent } from "react";
import type { WidgetProps } from "@rjsf/utils";
import {
  ariaDescribedByIds,
  enumOptionSelectedValue,
  enumOptionValueDecoder,
  enumOptionValueEncoder,
  getOptionValueFormat,
} from "@rjsf/utils";
import { Widgets as ShadcnWidgets } from "@rjsf/shadcn";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

// Original rjsf-shadcn SelectWidget (FancySelect for single,
// FancyMultiSelect for multiple). Captured at module-load time so
// our registry override of `SelectWidget` cannot create a recursive
// fallback when we delegate the multi-select case below.
const RjsfShadcnSelectWidget = ShadcnWidgets.SelectWidget;

/**
 * Drop-in replacement for `@rjsf/shadcn`'s default single-enum
 * `SelectWidget`.
 *
 * The vendored rjsf-shadcn widget renders its dropdown with a plain
 * absolutely-positioned `<div>` (no portal). When that widget lives
 * inside a scrollable container — e.g. our `SchemaFormDialog` body —
 * the popover's overflow contributes to the container's scrollHeight,
 * so opening the menu summons a phantom scrollbar. Clicking that
 * scrollbar moves focus off the rjsf-shadcn `Command`, fires its
 * blur handler, and immediately closes the menu.
 *
 * Radix Select's content portals to `document.body`, so it escapes
 * the dialog body's scroll container entirely. No phantom scrollbar,
 * no focus-loss-on-scroll, and the menu can never be clipped by
 * `overflow:hidden` ancestors. This widget mirrors the rjsf-shadcn
 * encode/decode contract so consumers see the exact same `onChange`
 * payload they already expect.
 *
 * Multi-select (`multiple: true`) delegates to the captured
 * rjsf-shadcn original because Radix Select is single-value only.
 */

// Radix Select forbids empty-string item values. We use a sentinel
// for the optional "None" entry and translate both directions.
// Picked to be unambiguous against any realistic enum value.
const NONE_SENTINEL = "__rjsf_none__";

export function EnumSelectWidget(props: WidgetProps) {
  const {
    id,
    options,
    required,
    disabled,
    readonly,
    value,
    multiple,
    onChange,
    onBlur,
    onFocus,
    placeholder,
    rawErrors = [],
    className,
  } = props;

  const { enumOptions, enumDisabled, emptyValue: optEmptyValue } = options as {
    enumOptions?: Array<{ value: unknown; label: string }>;
    enumDisabled?: unknown[];
    emptyValue?: unknown;
  };

  // Radix Select is single-value only. Hand multi-enum back to
  // rjsf-shadcn's original widget (FancyMultiSelect). Its multi-tag
  // popover has the same overflow-container caveats as FancySelect,
  // but no current Configure modal renders an array-of-enum field,
  // so address that if/when it surfaces.
  if (multiple) {
    return <RjsfShadcnSelectWidget {...props} />;
  }

  const optionValueFormat = getOptionValueFormat(options);
  const items =
    enumOptions?.map(({ value: rawValue, label }, index) => ({
      encoded: enumOptionValueEncoder(rawValue, index, optionValueFormat),
      label,
      disabled: Array.isArray(enumDisabled) && enumDisabled.includes(rawValue),
    })) ?? [];

  const selectedEncoded = enumOptionSelectedValue(
    value,
    enumOptions,
    false,
    optionValueFormat,
    "",
  );

  // Controlled value for Radix:
  // - real selection -> the encoded enum string
  // - optional + no selection -> the None sentinel (so the trigger
  //   shows the "None" item label rather than the placeholder)
  // - required + no selection -> "" (Radix treats both "" and
  //   undefined as placeholder triggers, but only "" keeps the
  //   component controlled. Passing undefined would flip Radix into
  //   uncontrolled mode and let stale UI persist after an external
  //   clear). We never render a <SelectItem value=""> -- Radix
  //   forbids that -- so the empty value just paints the placeholder.
  const hasSelection =
    typeof selectedEncoded === "string" && selectedEncoded.length > 0;
  const radixValue = hasSelection
    ? selectedEncoded
    : required
      ? ""
      : NONE_SENTINEL;

  const handleValueChange = (next: string) => {
    const encoded = next === NONE_SENTINEL ? "" : next;
    onChange(
      enumOptionValueDecoder(
        encoded,
        enumOptions,
        optionValueFormat,
        optEmptyValue,
      ),
    );
  };

  // rjsf passes (id, decodedValue) to onFocus/onBlur. The upstream
  // rjsf-shadcn widget computes the decoded value from `props.value`
  // at the moment focus/blur fires; we do the same here so the
  // payload matches what subscribers received before. We attach to
  // the SelectTrigger (not Radix's onOpenChange) so keyboard tab
  // traversal still produces focus/blur events even when the menu
  // never opens.
  const handleFocus = (_e: FocusEvent<HTMLButtonElement>) => {
    onFocus?.(
      id,
      enumOptionValueDecoder(value, enumOptions, optionValueFormat, optEmptyValue),
    );
  };
  const handleBlur = (_e: FocusEvent<HTMLButtonElement>) => {
    onBlur?.(
      id,
      enumOptionValueDecoder(value, enumOptions, optionValueFormat, optEmptyValue),
    );
  };

  return (
    <div className="p-0.5">
      <Select
        value={radixValue}
        onValueChange={handleValueChange}
        disabled={disabled || readonly}
      >
        <SelectTrigger
          id={id}
          aria-describedby={ariaDescribedByIds(id)}
          aria-required={required || undefined}
          // Mirror the upstream widget's class merge: incoming
          // `className` from RJSF (or wrapper widgets) wins over
          // base styling, and rawErrors paint the destructive border.
          className={cn(rawErrors.length > 0 && "border-destructive", className)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          data-testid={`select-${id}`}
        >
          <SelectValue placeholder={placeholder || "Select..."} />
        </SelectTrigger>
        <SelectContent>
          {!required && (
            <SelectItem value={NONE_SENTINEL}>
              {(placeholder as string | undefined) || "None"}
            </SelectItem>
          )}
          {items.map((item) => (
            <SelectItem
              key={item.encoded}
              value={item.encoded}
              disabled={item.disabled}
            >
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
