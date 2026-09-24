/**
 * Evaluate a SQL LIKE-style pattern (with `%` wildcards) against a URL
 * path in pure TypeScript, mirroring the behavior of the SQL
 * `path LIKE pattern` check used by storage.helps.findMatchingForPath.
 *
 * Only `%` (match any sequence, including empty) is supported as a
 * wildcard; `_` is treated literally since page paths use it literally.
 * All regex metacharacters in the pattern are escaped.
 */
export function likePatternMatches(pattern: string, path: string): boolean {
  const regexSource =
    "^" +
    pattern
      .split("%")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*") +
    "$";
  return new RegExp(regexSource).test(path);
}
