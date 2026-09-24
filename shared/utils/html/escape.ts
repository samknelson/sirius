/**
 * HTML escaping — dependency-free.
 *
 * DELIBERATELY has no imports. `server/production-entry.ts` renders its
 * boot-failure page before (and often instead of) the application, and it
 * imports THIS FILE directly rather than the barrel: the barrel pulls in
 * `sanitize.ts`, which pulls `isomorphic-dompurify`, which pulls jsdom
 * under Node. A heavy top-level import on the boot path has crashed the
 * lean production image at module load before. Keep this file leaf-level.
 *
 * See `./index.ts` for the escape-vs-sanitize distinction.
 */

/**
 * Encode the five HTML metacharacters so `s` renders as literal text.
 *
 * Use this on values that are NOT markup — a worker's name, a stack
 * trace, a token label — before interpolating them into an HTML string
 * or an attribute value. `&` must be replaced first or the replacements
 * would double-encode each other.
 *
 * This is not a sanitizer: it never inspects or removes markup, it
 * neutralizes all of it. To keep authored markup live while removing the
 * unsafe parts, use `sanitizeHtml` instead.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
