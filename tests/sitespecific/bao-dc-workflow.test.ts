import { describe, expect, it } from "vitest";
import {
  BAO_DC_CASE_TRANSITIONS,
  BAO_DC_OPTION_FUTURE_MONTHS,
  BAO_DC_OPTION_LOOKBACK_MONTHS,
  computeDcChecklist,
  computeDcMonthOptions,
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

  it("allows the one-step approval handoff and bounce-backs, refuses skips", () => {
    // One-step handoff: draft goes STRAIGHT to the queue.
    expect(isDcTransitionAllowed("draft", "in_queue")).toBe(true);
    // The intermediate mark-ready hop is retired for new work…
    expect(isDcTransitionAllowed("draft", "ready_for_review")).toBe(false);
    // …but legacy ready_for_review cases keep every exit so they are never
    // stranded: they can be sent for approval or returned to draft.
    expect(isDcTransitionAllowed("ready_for_review", "in_queue")).toBe(true);
    expect(isDcTransitionAllowed("ready_for_review", "draft")).toBe(true);
    expect(isDcTransitionAllowed("in_queue", "approved")).toBe(true);
    expect(isDcTransitionAllowed("in_queue", "denied")).toBe(true);
    // Bounces
    expect(isDcTransitionAllowed("in_queue", "draft")).toBe(true);
    // Skips / illegal
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
// A current dc_form doc alone never satisfies "DC form on file" — a reviewer
// must ALSO manually attest (dcFormOnFile) that they checked it.
const formAttested = { dcFormOnFile: true };

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

  it("passes with a signed, manually attested form and all attested fields", () => {
    const result = computeDcChecklist([doc("dc_form")], {
      ...formAttested, signed: true, fields: fullFields,
    });
    expect(result.passing).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("a classified dc_form WITHOUT the manual attestation does not satisfy the checklist", () => {
    const uploadOnly = computeDcChecklist([doc("dc_form")], { signed: true, fields: fullFields });
    expect(uploadOnly.passing).toBe(false);
    expect(uploadOnly.missing).toContain("DC form on file");
  });

  it("the manual attestation WITHOUT a current dc_form does not satisfy the checklist", () => {
    const attestOnly = computeDcChecklist([], {
      ...formAttested, signed: true, fields: fullFields,
    });
    expect(attestOnly.passing).toBe(false);
    expect(attestOnly.missing).toContain("DC form on file");
  });

  it("accepts the unsigned branch only WITH a WSR or doctor's note", () => {
    const unsignedAlone = computeDcChecklist([doc("dc_form")], {
      ...formAttested, fields: fullFields,
    });
    expect(unsignedAlone.passing).toBe(false);
    const withWsr = computeDcChecklist([doc("dc_form"), doc("wsr")], {
      ...formAttested, fields: fullFields,
    });
    expect(withWsr.passing).toBe(true);
    const withNote = computeDcChecklist([doc("dc_form"), doc("doctor_note")], {
      ...formAttested, fields: fullFields,
    });
    expect(withNote.passing).toBe(true);
  });

  it("stops counting superseded documents", () => {
    const result = computeDcChecklist([doc("dc_form", true), doc("wsr")], {
      ...formAttested, fields: fullFields,
    });
    expect(result.passing).toBe(false);
    expect(result.missing).toContain("DC form on file");
  });

  it("requires the employer accommodation letter when restrictions are noted", () => {
    const base = [doc("dc_form")];
    const att = { ...formAttested, signed: true, restrictionsNoted: true, fields: fullFields };
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

// ---------------------------------------------------------------------------
// Month selection: extension-only (DC never establishes first coverage)
// ---------------------------------------------------------------------------

describe("DC extension-only selection", () => {
  it("rejects any selection for a worker with NO established coverage", () => {
    const result = validateDcMonthSelection({
      selectedMonths: ["2026-03-01"],
      coveredMonths: [],
      otherCaseMonths: [],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === "NO_PRIOR_COVERAGE")).toBe(true);
    // Other-case DC months are NOT established coverage — still rejected.
    const dcOnly = validateDcMonthSelection({
      selectedMonths: ["2026-04-01"],
      coveredMonths: [],
      otherCaseMonths: ["2026-03-01"],
    });
    expect(dcOnly.errors.some((e) => e.code === "NO_PRIOR_COVERAGE")).toBe(true);
  });

  it("rejects months before the worker's first established coverage month", () => {
    const result = validateDcMonthSelection({
      selectedMonths: ["2026-01-01", "2026-04-01"],
      coveredMonths: ["2026-03-01"],
      otherCaseMonths: [],
    });
    expect(result.ok).toBe(false);
    const err = result.errors.find((e) => e.code === "BEFORE_FIRST_COVERAGE");
    expect(err?.months).toEqual(["2026-01-01"]);
    // A month EQUAL to the first coverage month is already-covered, not
    // double-reported as before-first-coverage.
    const equal = validateDcMonthSelection({
      selectedMonths: ["2026-03-01"],
      coveredMonths: ["2026-03-01"],
      otherCaseMonths: [],
    });
    expect(equal.errors.some((e) => e.code === "ALREADY_COVERED")).toBe(true);
    expect(equal.errors.some((e) => e.code === "BEFORE_FIRST_COVERAGE")).toBe(false);
  });

  it("accepts a valid extension after the first coverage month", () => {
    const result = validateDcMonthSelection({
      selectedMonths: ["2026-04-01"],
      coveredMonths: ["2026-02-01", "2026-03-01"],
      otherCaseMonths: [],
    });
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Month options (guided picker)
// ---------------------------------------------------------------------------

describe("DC month options", () => {
  const now = "2026-08-01";
  const base = {
    nowMonthYmd: now,
    coveredMonths: [] as string[],
    otherCaseMonths: [] as string[],
    activeCaseMonths: [] as string[],
  };

  it("spans exactly the 13-month lookback plus eight future months", () => {
    expect(BAO_DC_OPTION_LOOKBACK_MONTHS).toBe(12);
    expect(BAO_DC_OPTION_FUTURE_MONTHS).toBe(8);
    const options = computeDcMonthOptions({ ...base, coveredMonths: ["2020-01-01"] });
    expect(options).toHaveLength(21);
    expect(options[0].monthYmd).toBe("2025-08-01");
    expect(options[options.length - 1].monthYmd).toBe("2027-04-01");
    // Deterministic: same inputs, same output.
    expect(computeDcMonthOptions({ ...base, coveredMonths: ["2020-01-01"] })).toEqual(options);
  });

  it("normalizes a mid-month 'now' to its first-of-month window", () => {
    const options = computeDcMonthOptions({
      ...base,
      nowMonthYmd: "2026-08-15",
      coveredMonths: ["2020-01-01"],
    });
    expect(options[0].monthYmd).toBe("2025-08-01");
    expect(options[options.length - 1].monthYmd).toBe("2027-04-01");
  });

  it("offers NOTHING selectable when the worker has no established coverage", () => {
    const options = computeDcMonthOptions(base);
    expect(options.every((o) => o.status === "unavailable" && !o.selectable)).toBe(true);
    expect(options[0].reason).toMatch(/no established coverage/i);
  });

  it("never offers a month at or before the first established coverage month", () => {
    const options = computeDcMonthOptions({ ...base, coveredMonths: ["2026-03-01"] });
    const byMonth = Object.fromEntries(options.map((o) => [o.monthYmd, o]));
    expect(byMonth["2026-02-01"].status).toBe("unavailable");
    expect(byMonth["2026-02-01"].selectable).toBe(false);
    expect(byMonth["2026-03-01"].status).toBe("covered"); // equal → covered wins
    expect(byMonth["2026-04-01"].status).toBe("available");
    expect(byMonth["2026-04-01"].selectable).toBe(true);
  });

  it("marks covered and other-case months non-selectable with reasons", () => {
    const options = computeDcMonthOptions({
      ...base,
      coveredMonths: ["2026-05-01", "2026-06-01"],
      otherCaseMonths: ["2026-07-01"],
    });
    const byMonth = Object.fromEntries(options.map((o) => [o.monthYmd, o]));
    expect(byMonth["2026-06-01"]).toMatchObject({ status: "covered", selectable: false });
    expect(byMonth["2026-06-01"].reason).toMatch(/already covered/i);
    expect(byMonth["2026-07-01"]).toMatchObject({ status: "conflicting", selectable: false });
    expect(byMonth["2026-07-01"].reason).toMatch(/another/i);
    expect(byMonth["2026-08-01"].status).toBe("available");
  });

  it("keeps existing ACTIVE selections checked and toggleable — even outside the window", () => {
    const options = computeDcMonthOptions({
      ...base,
      coveredMonths: ["2024-01-01"],
      activeCaseMonths: ["2024-06-01", "2026-09-01"],
    });
    const byMonth = Object.fromEntries(options.map((o) => [o.monthYmd, o]));
    // Outside the window, still present as selected + toggleable.
    expect(byMonth["2024-06-01"]).toMatchObject({ status: "selected", selectable: true });
    // Inside the window too.
    expect(byMonth["2026-09-01"]).toMatchObject({ status: "selected", selectable: true });
    // Selected wins over conflicting/covered classification.
    const overlapping = computeDcMonthOptions({
      ...base,
      coveredMonths: ["2026-05-01"],
      otherCaseMonths: ["2026-06-01"],
      activeCaseMonths: ["2026-06-01"],
    });
    const byM = Object.fromEntries(overlapping.map((o) => [o.monthYmd, o]));
    expect(byM["2026-06-01"].status).toBe("selected");
  });
});
