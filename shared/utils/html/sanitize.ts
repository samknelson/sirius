/**
 * The single DOMPurify-backed sanitizer.
 *
 * This is the ONLY module in the codebase allowed to import DOMPurify;
 * `scripts/dev/check-html-utils.ts` fails the build if another one does.
 * Keeping it here means every allowlist in the product is visible in one
 * table (`./policies.ts`) instead of being re-derived at each call site.
 *
 * NOT importable from the production boot path: `isomorphic-dompurify`
 * pulls jsdom under Node. Boot-path code imports `./escape` directly.
 */
import DOMPurify from "isomorphic-dompurify";
import { decodeHtmlEntities } from "./entities";
import {
  HTML_SANITIZE_POLICIES,
  type HtmlSanitizeAllowlist,
  type HtmlSanitizePolicyName,
} from "./policies";

/**
 * Harden `target="_blank"` links, which would otherwise hand the opened
 * page a live `window.opener` handle back to ours.
 *
 * DOMPurify does not do this on its own. The hand-rolled contract
 * sanitizer this module replaced did, so the rule is carried over here
 * rather than lost in the swap — and because it lives on the one
 * sanitize path, every policy that permits links now gets it.
 *
 * Registered once at module load. `afterSanitizeAttributes` runs AFTER
 * the allowlist filter, so the attribute we add survives it.
 */
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  // Duck-typed rather than `instanceof Element`: under Node the DOM comes
  // from jsdom, so there is no global `Element` to test against.
  const el = node as unknown as {
    nodeType?: number;
    getAttribute?: (name: string) => string | null;
    setAttribute?: (name: string, value: string) => void;
  };
  if (el.nodeType !== 1 || !el.getAttribute || !el.setAttribute) return;
  if (el.getAttribute("target") === "_blank") {
    el.setAttribute("rel", "noopener noreferrer");
  }
});

/**
 * Strip everything a policy does not permit from markup that is MEANT to
 * render as markup, and return the surviving HTML.
 *
 * `policy` is normally one of the documented names in `./policies.ts`.
 * An explicit allowlist object is accepted as an escape hatch, but if you
 * reach for it twice, add a named policy instead — the point of the table
 * is that "what may this content contain?" has one answer per content kind.
 *
 * This is NOT `escapeHtml`. Sanitizing keeps authored markup live and
 * removes the dangerous parts; escaping neutralizes all markup so it
 * shows up as literal characters. Passing text through here instead of
 * `escapeHtml` lets an author's `<b>` become bold when it was meant to
 * be read as the four characters `<b>`.
 */
export function sanitizeHtml(
  html: string,
  policy: HtmlSanitizePolicyName | HtmlSanitizeAllowlist,
): string {
  const allowlist: HtmlSanitizeAllowlist =
    typeof policy === "string" ? HTML_SANITIZE_POLICIES[policy] : policy;

  // An absent tags/attributes list means "DOMPurify's defaults"; omit the
  // key entirely rather than passing undefined, which DOMPurify would
  // read as an empty allowlist.
  const config: Record<string, unknown> = {};
  if (allowlist.tags) config.ALLOWED_TAGS = [...allowlist.tags];
  if (allowlist.attributes) config.ALLOWED_ATTR = [...allowlist.attributes];
  if (allowlist.uriPattern) config.ALLOWED_URI_REGEXP = allowlist.uriPattern;

  return DOMPurify.sanitize(html, config);
}

/**
 * Sanitize, and say whether anything a READER would notice changed.
 *
 * For most content "did sanitizing change it?" is not a question worth
 * asking — you sanitize and render. It matters for content that is a
 * record of something, where a viewer is entitled to know they are not
 * being shown the document that was stored: today that is the signed
 * e-signature snapshots.
 *
 * The distinction this draws is between a CONTENT change and an ENCODING
 * change, and it exists because the naive byte comparison is a false
 * alarm generator. DOMPurify parses to a DOM and re-serializes, so it
 * normalizes entity spelling on the way through — a stored `&#10003;`
 * comes back as a literal `✓`. Those two bytes-differ but render as the
 * same glyph, and reporting them as "this document changed" would train
 * viewers to ignore the warning that exists to catch a real strip.
 *
 * So both sides are entity-decoded before comparing: same characters
 * after decoding means only the spelling moved. A tag or attribute that
 * the policy actually removed survives that normalization and is
 * reported.
 */
export function sanitizeHtmlReportingChange(
  html: string,
  policy: HtmlSanitizePolicyName | HtmlSanitizeAllowlist,
): { clean: string; contentChanged: boolean } {
  const clean = sanitizeHtml(html, policy);
  const contentChanged =
    clean !== html && decodeHtmlEntities(clean) !== decodeHtmlEntities(html);
  return { clean, contentChanged };
}
