/**
 * How a record's provenance sequence number is written for people.
 *
 * The sequence is one ever-climbing counter across every record in the
 * database, so the raw number carries no meaning on its own and is read
 * mostly by being compared, quoted or searched for. Grouping it makes it
 * legible the way a phone number or an account number is: four digits at a
 * time, counted from the right, joined with dots.
 *
 * While the number still fits in two groups the leading group is padded to
 * three digits, so early sequences all share one width and line up in a
 * column. Once it outgrows that, the widths speak for themselves and no
 * padding is added.
 *
 *   1          → 000.0001
 *   9999       → 000.9999
 *   19999      → 001.9999
 *   9999999    → 999.9999
 *   10009999   → 1000.9999
 *   99999999   → 9999.9999
 *   100000000  → 1.0000.0000
 */
export function formatRecordSequence(seq: number): string {
  const digits = Math.trunc(Math.abs(seq)).toString();

  const groups: string[] = [];
  let rest = digits;
  while (rest.length > 4) {
    groups.unshift(rest.slice(-4));
    rest = rest.slice(0, -4);
  }
  groups.unshift(rest);

  if (groups.length === 1) return `000.${groups[0].padStart(4, "0")}`;
  if (groups.length === 2) return `${groups[0].padStart(3, "0")}.${groups[1]}`;
  return groups.join(".");
}

/**
 * How a record's current provenance revision number is written for people.
 *
 * Revisions are grouped four digits at a time from the right. Unlike the
 * database-wide sequence, a single revision group is simply padded to four
 * digits and is not given an extra leading group.
 *
 *   97      → 0097
 *   254567  → 25.4567
 */
export function formatRecordRevision(rev: number): string {
  const digits = Math.trunc(Math.abs(rev)).toString();

  const groups: string[] = [];
  let rest = digits;
  while (rest.length > 4) {
    groups.unshift(rest.slice(-4));
    rest = rest.slice(0, -4);
  }
  groups.unshift(rest);

  if (groups.length === 1) return groups[0].padStart(4, "0");
  return groups.join(".");
}
