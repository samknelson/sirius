import { describe, it, expect } from "vitest";
import {
  sortPolicyHistoryEntries,
  type PolicyHistoryOrderKey,
} from "../../server/storage/employers/policy-history-order";

/**
 * The employer's current policy is denormalized from the first entry of this
 * order, from inside the transaction that writes an entry, while the history
 * page applies the same order later — once provenance has been written.
 *
 * A disagreement between those two moments is silent: the employer carries the
 * wrong policy and nothing recomputes it until the history is next edited. So
 * what is asserted here is that the two moments pick the same entry, including
 * while more than one entry is still waiting for its provenance.
 */

const entry = (
  id: string,
  date: string,
  recordedAt: Date | string | null,
): PolicyHistoryOrderKey => ({ id, date, recordedAt });

const ids = (entries: PolicyHistoryOrderKey[]) => entries.map((e) => e.id);

describe("policy history order", () => {
  it("puts the later effective date first, whatever the recorded times say", () => {
    const entries = [
      entry("a", "2024-01-01", new Date("2024-06-01T10:00:00Z")),
      entry("b", "2025-01-01", new Date("2024-01-01T10:00:00Z")),
    ];

    expect(ids(sortPolicyHistoryEntries(entries))).toEqual(["b", "a"]);
  });

  it("breaks a shared effective date by which entry was recorded later", () => {
    const entries = [
      entry("older", "2025-01-01", new Date("2025-03-01T09:00:00Z")),
      entry("newer", "2025-01-01", new Date("2025-03-01T09:00:01Z")),
    ];

    expect(ids(sortPolicyHistoryEntries(entries))).toEqual(["newer", "older"]);
  });

  it("treats an entry with no provenance as the newest", () => {
    const entries = [
      entry("recorded", "2025-01-01", new Date("2025-03-01T09:00:00Z")),
      entry("pending", "2025-01-01", null),
    ];

    expect(ids(sortPolicyHistoryEntries(entries))).toEqual(["pending", "recorded"]);
  });

  it("picks the same entry in the transaction and after provenance lands, with two writes pending", () => {
    // Two entries sharing an effective date, created back to back. When the
    // second is written its own provenance cannot exist, and the first one's
    // has not been written either — it is deferred past the commit.
    const first = "11111111-1111-4111-8111-111111111111";
    const second = "00000000-0000-4000-8000-000000000000";

    const insideTheTransaction = [
      entry(first, "2025-01-01", null),
      entry(second, "2025-01-01", null),
    ];

    // What the page sees once both provenance rows have been written.
    const afterProvenance = [
      entry(first, "2025-01-01", new Date("2025-03-01T09:00:00.000Z")),
      entry(second, "2025-01-01", new Date("2025-03-01T09:00:00.500Z")),
    ];

    // The id tiebreak alone would disagree with the recorded times here, which
    // is what naming the just-created entry exists to prevent.
    expect(ids(sortPolicyHistoryEntries(insideTheTransaction))[0]).not.toBe(second);

    expect(ids(sortPolicyHistoryEntries(insideTheTransaction, second))[0]).toBe(second);
    expect(ids(sortPolicyHistoryEntries(afterProvenance))[0]).toBe(second);
  });

  it("does not let an updated entry jump the entries recorded after it", () => {
    // An update names nothing: it leaves the recorded-at alone, so the entry
    // keeps its place rather than becoming the newest.
    const entries = [
      entry("edited", "2025-01-01", new Date("2025-03-01T09:00:00Z")),
      entry("later", "2025-01-01", new Date("2025-04-01T09:00:00Z")),
    ];

    expect(ids(sortPolicyHistoryEntries(entries))).toEqual(["later", "edited"]);
  });

  it("orders identically whatever order the rows arrive in", () => {
    const entries = [
      entry("a", "2025-01-01", new Date("2025-03-01T09:00:00Z")),
      entry("b", "2025-01-01", null),
      entry("c", "2026-01-01", new Date("2025-01-01T09:00:00Z")),
      entry("d", "2025-01-01", new Date("2025-05-01T09:00:00Z")),
    ];

    const expected = ids(sortPolicyHistoryEntries(entries));
    expect(expected).toEqual(["c", "b", "d", "a"]);
    expect(ids(sortPolicyHistoryEntries([...entries].reverse()))).toEqual(expected);
  });
});
