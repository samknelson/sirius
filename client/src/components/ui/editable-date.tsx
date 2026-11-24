import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { formatYmd, isValidYmd } from "@shared/utils/date";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface EditableDateProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  testId: string;
  compact?: boolean;
}

/** A single date display that becomes a native picker while editing. */
export function EditableDate({ value, onChange, label, testId, compact = false }: EditableDateProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);

  const finish = () => {
    setEditing(false);
    if (!cancelled.current && isValidYmd(draft) && draft !== value) onChange(draft);
  };

  if (editing) {
    return (
      <Input
        ref={input}
        type="date"
        value={draft}
        aria-label={label}
        data-testid={testId}
        className={compact ? "h-8 w-44 max-w-full" : "w-44 max-w-full"}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={finish}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            cancelled.current = true;
            setEditing(false);
          } else if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size={compact ? "sm" : "default"}
      className="max-w-full whitespace-normal text-sm"
      aria-label={`${label}: ${formatYmd(value, "weekday-short")}. Click to change date`}
      data-testid={`${testId}-display`}
      onClick={() => {
        cancelled.current = false;
        flushSync(() => {
          setDraft(value);
          setEditing(true);
        });
        input.current?.focus();
        // Some browsers do not support showPicker, or refuse it in an iframe.
        // The focused native date input remains usable in either case.
        try { input.current?.showPicker?.(); } catch { /* Use the native input instead. */ }
      }}
    >
      {formatYmd(value, "weekday-short")}
    </Button>
  );
}
