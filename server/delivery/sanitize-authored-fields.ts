import { MEDIUM_FIELDS, type MediumName } from "@shared/delivery-fields";
import { sanitizeTemplateHtml } from "@shared/utils/html/sanitize";

/**
 * Save-time defense, not delivery shaping: no token evaluation, trimming,
 * plain-text rewriting, or invented omitted fields. Final rendered values
 * still go through the normal delivery sanitizer.
 */
export function sanitizeAuthoredFields<T extends Record<string, unknown>>(
  medium: MediumName,
  content: T,
): T {
  const clean: Record<string, unknown> = { ...content };
  for (const field of MEDIUM_FIELDS[medium]) {
    if (field.syntax === "html" && typeof clean[field.key] === "string") {
      clean[field.key] = sanitizeTemplateHtml(clean[field.key] as string);
    }
  }
  return clean as T;
}
