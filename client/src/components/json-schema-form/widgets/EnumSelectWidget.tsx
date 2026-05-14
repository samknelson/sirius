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

// Original rjsf-shadcn SelectWidget (FancySelect for single, FancyMultiSelect
// for multiple). We only override the single case; the multiple case still
// needs the original because Radix Select is single-value only.
const RjsfShadcnSelectWidget = ShadcnWidgets.SelectWidget;

/**
 * Drop-in replacement for `@rjsf/shadcn`'s default `SelectWidget`.
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
 * Multi-select (`multiple: true`) still falls through to rjsf-shadcn's
 * `FancyMultiSelect` for now — none of the current plugin Configure
 * modals use array-of-enum, and Radix Select is single-select only.
 */

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

  // Radix Select disallows empty string item values, so when the
  // field is optional we expose a "None" entry under a sentinel
  // string and translate both directions.
  const radixValue =
    typeof selectedEncoded === "string" && selectedEncoded.length > 0
      ? selectedEncoded
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

  // rjsf-shadcn's original SelectWidget passes `value` (the raw form
  // value, already decoded) straight through `enumOptionValueDecoder`
  // for its onFocus/onBlur callbacks. We mirror that exactly so
  // subscribers see the same payload they did before.
  const decodedForCallback = () =>
    enumOptionValueDecoder(value, enumOptions, optionValueFormat, optEmptyValue);

  return (
    <div className="p-0.5">
      <Select
        value={radixValue}
        onValueChange={handleValueChange}
        disabled={disabled || readonly}
        // rjsf passes (id, value) to onFocus/onBlur; Radix gives us
        // an open-state boolean, so we synthesize the decoded value.
        onOpenChange={(open) => {
          if (open) onFocus?.(id, decodedForCallback());
          else onBlur?.(id, decodedForCallback());
        }}
      >
        <SelectTrigger
          id={id}
          aria-describedby={ariaDescribedByIds(id)}
          aria-required={required || undefined}
          className={cn(rawErrors.length > 0 && "border-destructive")}
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
