/**
 * Task 392 — S1 migration run-history reject normalization.
 *
 * The dashboard used to read only a legacy top-level `rejects` map, so
 * standard loader envelopes (rejectGate.counts) and aggregate sync runs
 * (fleet[].rejectGate.counts) all displayed "none". rejectCountsOf is the
 * single reader; these tests pin every recorded report shape.
 */
import { describe, expect, it } from "vitest";
import { rejectCountsOf } from "@/lib/s1-run-rejects";

describe("rejectCountsOf", () => {
  it("reads a standard loader envelope's rejectGate.counts", () => {
    const report = {
      loader: "load-hours",
      summary: { created: 1, rejected: 3 },
      rejectGate: {
        status: "pass",
        counts: { missing_worker: 2, bad_month: 1 },
        allowed: ["missing_worker", "bad_month"],
        disallowed: [],
      },
    };
    expect(rejectCountsOf(report)).toEqual({ missing_worker: 2, bad_month: 1 });
  });

  it("shows counts even when the reject gate failed", () => {
    const report = {
      rejectGate: {
        status: "fail",
        counts: { unruled_reason: 4 },
        allowed: [],
        disallowed: [{ reason: "unruled_reason", count: 4 }],
      },
    };
    expect(rejectCountsOf(report)).toEqual({ unruled_reason: 4 });
  });

  it("combines fleet rejectGate counts for an aggregate sync report, summing repeated reasons", () => {
    const report = {
      command: "sync",
      result: "PASS",
      fleet: [
        { id: "contacts", rejectGate: { status: "pass", counts: { missing_sirius_id: 2 }, allowed: [], disallowed: [] } },
        { id: "hours", rejectGate: { status: "pass", counts: { missing_sirius_id: 3, bad_month: 1 }, allowed: [], disallowed: [] } },
        { id: "no-envelope-step", rejectGate: null }, // failed step: rejectGate recorded as null
        { id: "clean-step", rejectGate: { status: "pass", counts: {}, allowed: [], disallowed: [] } },
      ],
    };
    expect(rejectCountsOf(report)).toEqual({ missing_sirius_id: 5, bad_month: 1 });
  });

  it("still reads legacy top-level reject maps", () => {
    expect(rejectCountsOf({ rejects: { no_nid: 7 } })).toEqual({ no_nid: 7 });
  });

  it("prefers the standard envelope over a legacy map when both exist", () => {
    const report = {
      rejects: { stale: 99 },
      rejectGate: { status: "pass", counts: { fresh: 1 }, allowed: [], disallowed: [] },
    };
    expect(rejectCountsOf(report)).toEqual({ fresh: 1 });
  });

  it("returns empty for stage reports (reports array, no rejects)", () => {
    expect(rejectCountsOf({ reports: [{ bundle: "sirius_worker", rows: 10 }] })).toEqual({});
  });

  it("returns empty for parity reports (result only)", () => {
    expect(rejectCountsOf({ result: "PASS", mismatches: 0 })).toEqual({});
  });

  it("returns empty for envelopes with an empty counts map", () => {
    expect(
      rejectCountsOf({ rejectGate: { status: "pass", counts: {}, allowed: [], disallowed: [] } }),
    ).toEqual({});
  });

  it("tolerates malformed shapes without throwing", () => {
    expect(rejectCountsOf(null)).toEqual({});
    expect(rejectCountsOf(undefined)).toEqual({});
    expect(rejectCountsOf("FAIL")).toEqual({});
    expect(rejectCountsOf({ rejectGate: "broken" })).toEqual({});
    expect(rejectCountsOf({ rejectGate: { counts: [1, 2] } })).toEqual({});
    expect(rejectCountsOf({ fleet: "not-an-array" })).toEqual({});
    expect(rejectCountsOf({ rejects: ["array-not-map"] })).toEqual({});
    // Non-numeric junk values inside a counts map are dropped, numbers kept.
    expect(
      rejectCountsOf({ rejectGate: { counts: { good: 2, bad: "x", worse: null } } }),
    ).toEqual({ good: 2 });
  });
});
