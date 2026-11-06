import { createElement, forwardRef, type ElementType } from "react";
import { maskPersonal } from "@shared/privacy/mask-mode";
import { useMaskMode, type PersonalFormatter } from "./MaskMode";

/** Metadata such as visible native tooltips is a display too, not canonical data. */
export const PersonalSurface = forwardRef<unknown, {
  as: ElementType;
  personalFields: Record<string, (mask: PersonalFormatter) => unknown>;
  [key: string]: any;
}>(({ as, personalFields, ...props }, ref) => {
  const { mode } = useMaskMode();
  if (mode === "on") {
    const mask: PersonalFormatter = (value, kind) =>
      typeof value === "string" || typeof value === "number" ? maskPersonal(value, kind) : value;
    for (const [key, render] of Object.entries(personalFields)) {
      props[key] = render(mask);
    }
  }
  return createElement(as, { ...props, ref });
});
PersonalSurface.displayName = "PersonalSurface";
