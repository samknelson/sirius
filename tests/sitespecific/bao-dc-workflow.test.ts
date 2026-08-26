import { describe, expect, it } from "vitest";
import {
  BAO_DC_CASE_TRANSITIONS,
  computeDcChecklist,
  isDcTransitionAllowed,
  validateDcMonthSelection,
  type DcChecklistDocLike,
} from "@shared/sitespecific/bao/dc-workflow";
import {
  BAO_DC_ANNUAL_MONTH_LIMIT,
  BAO_DC_CASE_STATUSES,
  BAO_DC_TERMINAL_CASE_STATUSES,
} from "@shared/schema";

// ---------------------------------------------------------------------------
// Lifecycle transitions
// ---------------------------------------------------------------------------

describe("DC lifecycle transitions", () => {
  it("covers every status and gives terminals (and approved) no exits", () => {
    for (const status of BAO_DC_CASE_STATUSES) {
      expect(BAO_DC_CASE_TRANSITIONS[status]).toBeDefined();
    }
    for (const terminal of BAO_DC_TERMINAL_CASE_STATUSES) {
      expect(BAO_DC_CASE_TRANSITIONS[terminal]).toEqual([]);
    }
    expect(BAO_DC_CASE_TRANSITIONS.approved).toEqual([]);
  });

  it("allows the review path and bounce-backs, refuses skips", () => {
    expect(isDcTransitionAllowed("draft", "ready_for_review")).toBe(true);
    expect(isDcTransitionAllowed("ready_for_review", "in_queue")).toBe(true);
    expect(isDcTransitionAllowed("in_queue", "approved")).toBe(true);
    expect(isDcTransitionAllowed("in_queue", "denied")).toBe(true);
    // Bounces
    expect(isDcTransitionAllowed("ready_for_review", "draft")).toBe(true);
    expect(isDcTransitionAllowed("in_queue", "draft")).toBe(true);
    // Skips / illegal
    expect(isDcTransitionAllowed("draft", "in_queue")).toBe(false);
    expect(isDcTransitionAllowed("draft", "approved")).toBe(false);
    expect(isDcTransitionAllowed("approved", "draft")).toBe(false);
    expect(isDcTransitionAllowed("denied", "draft")).toBe(false);
    // Withdraw/void allowed from every open state
    for (const from of ["draft", "ready_for_review", "in_queue"] as const) {
      expect(isDcTransitionAllowed(from, "withdrawn")).toBe(true);
      expect(isDcTransitionAllowed(from, "void")).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Checklist branches
// ---------------------------------------------------------------------------

const doc = (docType: DcChecklistDocLike["docType"], superseded = false): DcChecklistDocLike => ({
  docType,
  supersededAt: superseded ? new Date() : null,
});

const fullFields = { doctorAddress: true, doctorPhone: true, dates: true };

describe("DC checklist", () => {
  it("names every missing item on an empty case", () => {
    const result = computeDcChecklist([], {});
    expect(result.passing).toBe(false);
    expect(result.missing).toEqual(
      expect.arrayContaining([
        "DC form on file",
        expect.stringContaining("doctor-signed"),
        "Form field: doctor address",
        "Form field: doctor phone",
        "Form field: dates",
      ]),
    );
  });

  it("passes with a signed form and all attested fields", () => {
    const result = computeDcChecklist([doc("dc_form")], { signed: true, fields: fullFields });
    expect(result.passing).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("accepts the unsigned branch only WITH a WSR or doctor's note", () => {
    const unsignedAlone = computeDcChecklist([doc("dc_form")], { fields: fullFields });
    expect(unsignedAlone.passing).toBe(false);
    const withWsr = computeDcChecklist([doc("dc_form"), doc("wsr")], { fields: fullFields });
    expect(withWsr.passing).toBe(true);
    const withNote = computeDcChecklist([doc("dc_form"), doc("doctor_note")], {
      fields: fullFields,
    });
    expect(withNote.passing).toBe(true);
  });

  it("stops counting superseded documents", () => {
    const result = computeDcChecklist([doc("dc_form", true), doc("wsr")], {
      fields: fullFields,
    });
    expect(result.passing).toBe(false);
    expect(result.missing).toContain("DC form on file");
  });

  it("requires the employer accommodation letter when restrictions are noted", () => {
    const base = [doc("dc_form")];
    const att = { signed: true, restrictionsNoted: true, fields: fullFields };
    const withoutLetter = computeDcChecklist(base, att);
    expect(withoutLetter.passing).toBe(false);
    expect(withoutLetter.missing.join(" ")).toMatch(/accommodate/i);
    const withLetter = computeDcChecklist(
      [...base, doc("employer_accommodation_letter")],
      att,
    );
    expect(withLetter.passing).toBe(true);
    // And a superseded letter stops satisfying it again.
    const supersededLetter = computeDcChecklist(
      [...base, doc("employer_accommodation_letter", true)],
      att,
    );
    expect(supersededLetter.passing).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Month selection: continuity + capacity
// ---------------------------------------------------------------------------

describe("DC month selection", () => {
  const base = { otherCaseMonths: [], coveredMonths: [] as string[] };

  it("rejects empty and non-first-of-month selections", () => {
    expect(validateDcMonthSelection({ ...base, selectedMonths: [] }).errors[0].code).toBe(
      "EMPTY_SELECTION",
    );
    const bad = validateDcMonthSelection({ ...base, selectedMonths: ["2026-03-15"] });
    expect(bad.errors[0].code).toBe("NOT_FIRST_OF_MONTH");
  });

  it("rejects months already covered or held by another case", () => {
    const covered = validateDcMonthSelection({
      selectedMonths: ["2026-03-01"],
      coveredMonths: ["2026-03-01"],
      otherCaseMonths: [],
    });
    expect(covered.errors.some((e) => e.code === "ALREADY_COVERED")).toBe(true);

    const conflict = validateDcMonthSelection({
      selectedMonths: ["2026-03-01"],
      coveredMonths: ["2026-02-01"],
      otherCaseMonths: ["2026-03-01"],
    });
    expect(conflict.errors.some((e) => e.code === "CONFLICTING_CASE_MONTH")).toBe(true);
  });

  it("names continuity gap months back to the last covered month", () => {
    const result = validateDcMonthSelection({
      selectedMonths: ["2026-05-01"],
      coveredMonths: ["2026-02-01"],
      otherCaseMonths: [],
    });
    expect(result.ok).toBe(false);
    const gap = result.errors.find((e) => e.code === "CONTINUITY_GAP");
    expect(gap?.months).toEqual(["2026-03-01", "2026-04-01"]);
    expect(result.gapMonths).toEqual(["2026-03-01", "2026-04-01"]);
  });

  it("passes when the selection immediately follows coverage or backfills the gap", () => {
    const adjacent = validateDcMonthSelection({
      selectedMonths: ["2026-03-01", "2026-04-01"],
      coveredMonths: ["2026-02-01"],
      otherCaseMonths: [],
    });
    expect(adjacent.ok).toBe(true);

    const backfilled = validateDcMonthSelection({
      selectedMonths: ["2026-03-01", "2026-04-01", "2026-05-01"],
      coveredMonths: ["2026-02-01"],
      otherCaseMonths: [],
    });
    expect(backfilled.ok).toBe(true);

    // Gaps inside the selection itself are named too.
    const holey = validateDcMonthSelection({
      selectedMonths: ["2026-03-01", "2026-05-01"],
      coveredMonths: ["2026-02-01"],
      otherCaseMonths: [],
    });
    expect(holey.gapMonths).toEqual(["2026-04-01"]);
  });

  it("enforces annual capacity per calendar year across all cases", () => {
    expect(BAO_DC_ANNUAL_MONTH_LIMIT).toBe(6);
    const over = validateDcMonthSelection({
      selectedMonths: ["2026-03-01", "2026-04-01", "2026-05-01"],
      coveredMonths: ["2026-02-01"],
      otherCaseMonths: ["2026-08-01", "2026-09-01", "2026-10-01", "2026-11-01"],
    });
    expect(over.errors.some((e) => e.code === "CAPACITY_EXCEEDED" && e.year === 2026)).toBe(
      true,
    );
    expect(over.perYear["2026"].used).toBe(4);
    expect(over.perYear["2026"].selected).toBe(3);
  });

  it("handles year boundaries: each year's capacity is independent", () => {
    const result = validateDcMonthSelection({
      selectedMonths: [
        "2026-10-01",
        "2026-11-01",
        "2026-12-01",
        "2027-01-01",
        "2027-02-01",
        "2027-03-01",
      ],
      coveredMonths: ["2026-09-01"],
      otherCaseMonths: ["2026-05-01", "2026-06-01", "2026-07-01"],
    });
    // 2026: 3 used + 3 selected = 6 (at limit, OK); 2027: 3 selected.
    expect(result.ok).toBe(true);
    expect(result.perYear["2026"].remaining).toBe(0);
    expect(result.perYear["2027"].selected).toBe(3);

    const overYearEnd = validateDcMonthSelection({
      selectedMonths: ["2026-09-01", "2026-10-01", "2026-11-01", "2026-12-01"],
      coveredMonths: ["2026-08-01"],
      otherCaseMonths: ["2026-01-01", "2026-02-01", "2026-03-01"],
    });
    expect(
      overYearEnd.errors.some((e) => e.code === "CAPACITY_EXCEEDED" && e.year === 2026),
    ).toBe(true);
  });

  it("blocks a selection whose required backfill cannot fit in remaining capacity", () => {
    // Last covered 2026-01; picking 2026-06 requires backfilling Feb–May, and
    // the gap months are NAMED so staff know what a valid selection needs.
    const gapped = validateDcMonthSelection({
      selectedMonths: ["2026-06-01"],
      coveredMonths: ["2026-01-01"],
      otherCaseMonths: [],
    });
    expect(gapped.ok).toBe(false);
    expect(gapped.gapMonths).toEqual([
      "2026-02-01",
      "2026-03-01",
      "2026-04-01",
      "2026-05-01",
    ]);
    // Backfilling the gap makes the run continuous but blows the year's
    // capacity once other cases already hold months → still blocked.
    const backfilled = validateDcMonthSelection({
      selectedMonths: ["2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01"],
      coveredMonths: ["2026-01-01"],
      otherCaseMonths: ["2026-08-01", "2026-09-01"],
    });
    expect(backfilled.ok).toBe(false);
    expect(
      backfilled.errors.some((e) => e.code === "CAPACITY_EXCEEDED" && e.year === 2026),
    ).toBe(true);
  });
});
