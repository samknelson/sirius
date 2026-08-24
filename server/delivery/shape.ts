import { sanitizeHtml } from "@shared/utils/html";
import { isSafeRelativePath, type DeliveryFieldSpec } from "@shared/delivery-fields";

/**
 * The server side of the delivery field declarations in
 * `shared/delivery-fields.ts`: the one shaping step that needs the
 * server's HTML sanitizer.
 *
 * Re-exports the declarations themselves so delivery code has a single
 * import for "what the fields are and how to shape them".
 */
export {
  BULK_CHANNEL_FIELDS,
  NOTIFIER_CHANNEL_FIELDS,
  DELIVERY_FIELD_SYNTAX,
  DELIVERY_FIELD_SAFETY,
  applyFieldEligibility,
  isSafeRelativePath,
  tokenCleanerFor,
  validateDeliveryFieldSpecs,
  type CleanedToken,
  type DeliveryFieldSafety,
  type DeliveryFieldSpec,
  type DeliveryFieldSyntax,
  type ShapedFields,
  type TokenValueCleaner,
} from "@shared/delivery-fields";

/**
 * Shape ONE rendered field the way delivery shapes it.
 *
 * This is the single implementation of "what happens to a tokenized
 * string between rendering it and sending it": whitespace trimming,
 * HTML sanitizing, same-app link enforcement and empty-value fallbacks.
 * Delivery code and the template studio's preview both call it, so a
 * change here can never make the two disagree.
 *
 * This runs on the FINISHED string. Cleaning each token's value on its
 * way in is a separate job with a separate owner — the container's
 * `tokenCleanerFor` function, called during evaluation.
 *
 * Fields declared `tokenized: false` are never rendered at all
 * (delivery sends the stored value verbatim), so the caller passes the
 * raw value through.
 */
export function shapeRenderedValue(
  spec: DeliveryFieldSpec,
  rendered: string,
): string {
  let value = rendered;
  if (spec.trim) value = value.trim();
  if (spec.syntax === "html") {
    // Token values were escaped on the way in; the completed body then
    // goes through the tag/attribute allowlist, because authored markup
    // can reach storage without passing the rich-text editor.
    value = sanitizeHtml(value, "rich-document");
  }
  if (spec.safety === "relative-url") {
    // Trim first, then validate: delivery sends the trimmed URL, so a
    // padded but otherwise fine path must not preview as dropped.
    value = isSafeRelativePath(value) ? value : "";
  }
  if (!value && spec.fallback) value = spec.fallback;
  return value;
}
