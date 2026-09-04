/**
 * The shared HTML utility library — escaping, sanitizing, HTML→text.
 *
 * ─── Escaping is not sanitizing ────────────────────────────────────────
 *
 * These two do OPPOSITE things and are not interchangeable:
 *
 *   escapeHtml(text)          — the input is NOT markup. Encodes the five
 *                               HTML metacharacters so the value renders
 *                               as the literal characters an author typed.
 *                               Use before interpolating a name, a title,
 *                               a stack trace into an HTML string.
 *
 *   sanitizeHtml(html, policy) — the input IS markup, and is meant to
 *                               render as markup. Removes everything the
 *                               named policy does not permit and keeps
 *                               the rest live.
 *
 * Swap one for the other and you get a real bug, in one of two flavours:
 * sanitizing text turns a user's `<b>` into live bold (or deletes it);
 * escaping markup turns an authored document into a visible soup of
 * angle brackets. Decide which one you have — text or markup — first.
 *
 * ─── Boot-path constraint ──────────────────────────────────────────────
 *
 * `sanitize.ts` imports `isomorphic-dompurify`, which pulls jsdom under
 * Node. A heavy top-level import on the production boot path has crashed
 * the lean production image at module load before, so the library is
 * split by dependency weight:
 *
 *   escape.ts    — no imports at all
 *   entities.ts  — no imports at all
 *   to-text.ts   — imports entities.ts only
 *   policies.ts  — data only, no imports
 *   letter-page.ts — no imports at all (the standard postal letter page)
 *   sanitize.ts  — imports DOMPurify
 *
 * Import THIS BARREL by default. Code that must not load DOMPurify —
 * today that is `server/production-entry.ts`, which escapes text onto its
 * boot-failure page before the app exists — imports the leaf file
 * (`shared/utils/html/escape`) directly instead.
 *
 * ─── Picking a sanitize policy ─────────────────────────────────────────
 *
 * Every allowlist in the product lives in `./policies.ts`. Choose a name
 * from `HTML_SANITIZE_POLICIES`; each entry documents the content it
 * governs. Add a policy there rather than passing an inline allowlist.
 */
export { escapeHtml } from "./escape";
export { decodeHtmlEntities, HTML_NAMED_ENTITIES } from "./entities";
export { htmlToPlainText, htmlToInlineText, toSingleLine } from "./to-text";
export {
  HTML_SANITIZE_POLICIES,
  SAFE_URI_PATTERN,
  type HtmlSanitizeAllowlist,
  type HtmlSanitizePolicyName,
} from "./policies";
export { sanitizeHtml, sanitizeHtmlReportingChange } from "./sanitize";
export { LETTER_PAGE_HTML, wrapLetterPage } from "./letter-page";
