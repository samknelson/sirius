/**
 * Which of an employer's policy-history entries comes first.
 *
 * This is a pure leaf on purpose. Two readers have to agree about the answer,
 * and they run at different moments against different data:
 *
 *   - the history page, listing an employer's entries and badging the first
 *     one "Current";
 *   - `syncEmployerCurrentPolicy`, which denormalizes that same first entry's
 *     policy onto the employer, from INSIDE the transaction that just wrote an
 *     entry.
 *
 * If those two disagree the employer's current policy is quietly wrong, and
 * nothing recomputes it until the history is next edited. So the order is
 * decided in one function over plain rows rather than twice in SQL, where the
 * two `ORDER BY` lists could drift apart unnoticed. An employer's history is a
 * handful of rows, so sorting them in memory costs nothing worth naming.
 */

/** The three fields the order is decided on. */
export interface PolicyHistoryOrderKey {
  /** The entry's own id. */
  id: string;
  /** The EFFECTIVE date of the policy change: `YYYY-MM-DD`, business data. */
  date: string;
  /**
   * When the entry was recorded, from the record's provenance
   * (`entity_metadata.created_date`). Null when no provenance row exists yet.
   */
  recordedAt: Date | string | null;
}

function recordedTime(value: Date | string | null): number | null {
  if (value === null || value === undefined) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

/**
 * Newest first: effective date, then when the entry was recorded, then id so
 * the order is total and stable.
 *
 * **A missing recorded-at sorts FIRST.** Provenance is written after the
 * writing transaction COMMITS, so an entry without it is one being written
 * right now — the newest there is. Every entry predating the provenance
 * framework was seeded from the column this replaced, so the only other way to
 * get here is a provenance write that was lost; that costs a tiebreak, and
 * costs it identically in both readers, which is the property that matters.
 *
 * **`justCreatedId` is how the two readers stay in agreement while more than
 * one entry is waiting for provenance.** The in-transaction reader can see a
 * second entry created moments earlier whose provenance has not landed either:
 * both read as null, the id tiebreak picks one, and the page — reading later,
 * once both have real recorded times — picks the other. So the create path
 * names the entry it just wrote, which is by definition the newest, and it
 * wins its effective date the same way its recorded-at will once written.
 * Only a create passes it: an update leaves the recorded-at alone, and an
 * updated entry must not jump the entries actually recorded after it.
 *
 * Concurrent transactions inserting for one employer still resolve by which
 * commits last, as they did when this date was a column on the table: neither
 * sees the other's uncommitted row.
 */
export function comparePolicyHistoryEntries(
  a: PolicyHistoryOrderKey,
  b: PolicyHistoryOrderKey,
  justCreatedId?: string,
): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;

  if (justCreatedId !== undefined) {
    const aJustCreated = a.id === justCreatedId;
    const bJustCreated = b.id === justCreatedId;
    if (aJustCreated !== bJustCreated) return aJustCreated ? -1 : 1;
  }

  const aRecorded = recordedTime(a.recordedAt);
  const bRecorded = recordedTime(b.recordedAt);
  if (aRecorded === null || bRecorded === null) {
    if (aRecorded !== bRecorded) return aRecorded === null ? -1 : 1;
  } else if (aRecorded !== bRecorded) {
    return aRecorded < bRecorded ? 1 : -1;
  }

  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

/** The same order, applied to a list. Returns a new array. */
export function sortPolicyHistoryEntries<T extends PolicyHistoryOrderKey>(
  entries: T[],
  justCreatedId?: string,
): T[] {
  return [...entries].sort((a, b) => comparePolicyHistoryEntries(a, b, justCreatedId));
}
