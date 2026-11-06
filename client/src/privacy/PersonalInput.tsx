import { forwardRef, useState, type ComponentProps } from "react";
import { maskPersonal, type PersonalField } from "@shared/privacy/mask-mode";
import { useMaskMode } from "./MaskMode";

export function inputPersonalKind(props: Record<string, unknown>): PersonalField | undefined {
  if (typeof props["data-personal"] === "string") return props["data-personal"] as PersonalField;
  const key = [props.name, props.id, props["data-testid"]].filter(v => typeof v === "string").join(" ");
  if (/(?:^|[-_.\s])(?:ssn)(?:$|[-_.\s])/i.test(key)) return "ssn";
  if (/(birth.?date|date.?of.?birth|\bdob\b)/i.test(key)) return "dob";
  if (/(email)/i.test(key) || props.type === "email") return "email";
  if (/(phone|mobile|fax)/i.test(key) || props.type === "tel") return "phone";
  if (/(?:given|family|first.?name|last.?name|middle.?name|generational|contact.?name|worker.?name|beneficiary.?name)/i.test(key)) return "name";
  if (/(?:street|postal.?code|zip.?code|address[12]|address-)/i.test(key)) return "address";
  return undefined;
}

/**
 * Raw HTML value, form ref, validation and change events remain canonical.
 * The overlay is presentation only: focusing never replaces state with stars
 * and never reveals the original. Selection/copy still uses the original.
 */
export const PersonalInput = forwardRef<HTMLInputElement, ComponentProps<"input"> & {
  "data-personal"?: PersonalField;
}>(({ style, className, type, onChange, onInvalid, onKeyDown, ...props }, ref) => {
  const [draft, setDraft] = useState(props.defaultValue ?? "");
  const [invalid, setInvalid] = useState(false);
  const { mode } = useMaskMode();
  const kind = inputPersonalKind({ ...props, type });
  const active = mode === "on" && kind && type !== "password" && type !== "hidden";
  const change: ComponentProps<"input">["onChange"] = event => {
    setDraft(event.target.value);
    setInvalid(false);
    onChange?.(event);
  };
  if (!kind || type === "password" || type === "hidden") return <input {...props} onKeyDown={onKeyDown} onInvalid={onInvalid} onChange={change} ref={ref} type={type} style={style} className={className} />;
  const canonical = props.value ?? draft;
  // A native date control formats a calendar date in the browser's locale,
  // not an instant in the site's zone. Keep that ordering and native validity.
  const dateParts = type === "date" && /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(canonical));
  const displayed = dateParts ? new Intl.DateTimeFormat(undefined, {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC",
  }).format(new Date(Date.UTC(Number(dateParts[1]), Number(dateParts[2]) - 1, Number(dateParts[3])))) : canonical;
  return <span className="relative inline-flex w-full flex-col">
    <input {...props} onChange={change} ref={ref} type={type} className={className}
      onKeyDown={event => {
        onKeyDown?.(event);
        if (active && type === "date" && ((event.altKey && event.key === "ArrowDown") || event.key === " ")) event.preventDefault();
      }}
      onInvalid={event => {
        onInvalid?.(event);
        if (active) { event.preventDefault(); setInvalid(true); }
      }}
      data-screen-masked={active ? "true" : undefined} title={active && kind === "dob" ? "Screen-masked date; edit using the keyboard." : props.title}
      style={active ? { ...style, color: "transparent", caretColor: "currentColor", WebkitTextFillColor: "transparent", textShadow: "none" } : style} />
    {active && <span aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre px-3 text-sm">
      {canonical === "" ? props.placeholder : maskPersonal(displayed, kind)}
    </span>}
    {invalid && <span role="alert" className="text-xs text-destructive">Invalid personal field. Check the value.</span>}
  </span>;
});
PersonalInput.displayName = "PersonalInput";
