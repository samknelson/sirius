import { describe, expect, it } from "vitest";
import {
  BAO_DC_CASE_TRANSITIONS,
  BAO_DC_OPTION_FUTURE_MONTHS,
  BAO_DC_OPTION_LOOKBACK_MONTHS,
  computeDcChecklist,
  computeDcMonthOptions,
  deriveDcCoveredCoverageMonths,
  enumerateDcCandidateWorkMonths,
  isDcTransitionAllowed,
  validateDcMonthSelection,
  type DcChecklistDocLike,
  type DcMonthCandidate,
  type DcMonthRef,
  type DcOtherCaseMonth,
} from "@shared/sitespecific/bao/dc-workflow";
import {
  BAO_DC_ANNUAL_MONTH_LIMIT,
  BAO_DC_CASE_STATUSES,
  BAO_DC_TERMINAL_CASE_STATUSES,
} from "@shared/schema";
import { addMonthsYmd, type Ymd } from "@shared/utils/date";
import { deriveDcAnnualMaxStatus, deriveDcMonthHistory } from "@shared/sitespecific/bao/dc-reporting";

// ---------------------------------------------------------------------------
// Coverage-axis fixtures. The Fund approves COVERAGE months; each maps to the
// work month `lag` months earlier that receives the credit hours. These
// helpers build refs/candidates for a plan with a 3-month lag and a 60-hour
// minimum — the spec's canonical numbers.
// ---------------------------------------------------------------------------

const LAG = 3;
const MINIMUM = 60;

function ref(workMonthYmd: string): DcMonthRef {
  return { workMonthYmd, coverageMonthYmd: addMonthsYmd(workMonthYmd, LAG) };
}
function refs(...workMonths: string[]): DcMonthRef[] {
  return workMonths.map(ref);
}
function other(...workMonths: string[]): DcOtherCaseMonth[] {
  return workMonths.map(ref);
}
/** Coverage months `from` … `through` inclusive (what WMB would show). */
function coverage(from: string, through: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= through; m = addMonthsYmd(m, 1)) out.push(m);
  return out;
}
/** Picker candidates around `now`, all resolvable, with optional reported hours. */
function candidatesAround(
  now: string,
  hoursByWorkMonth: Record<string, number> = {},
  extra: string[] = [],
): DcMonthCandidate[] {
  return enumerateDcCandidateWorkMonths(now, extra).map((workMonthYmd) => ({
    workMonthYmd,
    coverageMonthYmd: addMonthsYmd(workMonthYmd, LAG),
    threshold: MINIMUM,
    qualifyingHours: hoursByWorkMonth[workMonthYmd] ?? 0,
  }));
}

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
// Month selection: continuity + capacity (coverage axis)
// ---------------------------------------------------------------------------

describe("DC month selection", () => {
  const base = { otherCaseMonths: [] as DcOtherCaseMonth[], coveredMonths: [] as string[] };

  it("rejects empty and non-first-of-month selections", () => {
    expect(validateDcMonthSelection({ ...base, selectedMonths: [] }).errors[0].code).toBe(
      "EMPTY_SELECTION",
    );
    const bad = validateDcMonthSelection({
      ...base,
      selectedMonths: [{ workMonthYmd: "2026-03-15", coverageMonthYmd: "2026-06-15" }],
    });
    expect(bad.errors[0].code).toBe("NOT_FIRST_OF_MONTH");
  });

  it("canonical: covered through Sep 2026, Oct + Nov coverage credit Jul + Aug work months", () => {
    // The spec's example. Under the old work-month model Jul/Aug were refused
    // as "already covered" because the worker had hours in them.
    const result = validateDcMonthSelection({
      selectedMonths: refs("2026-07-01", "2026-08-01"),
      coveredMonths: coverage("2026-01-01", "2026-09-01"),
      otherCaseMonths: [],
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.gapMonths).toEqual([]);
    expect(result.perYear["2026"]).toMatchObject({ used: 0, selected: 2 });
  });

  it("decides 'already covered' on the coverage axis, naming both months", () => {
    // Work month Jun 2026 → Sep 2026 coverage, which WMB already shows.
    const covered = validateDcMonthSelection({
      selectedMonths: refs("2026-06-01"),
      coveredMonths: coverage("2026-01-01", "2026-09-01"),
      otherCaseMonths: [],
    });
    const err = covered.errors.find((e) => e.code === "ALREADY_COVERED");
    expect(err?.months).toEqual(["2026-09-01"]);
    expect(err?.workMonths).toEqual(["2026-06-01"]);
    expect(err?.message).toMatch(/September 2026 coverage \(work month June 2026\)/);
  });

  it("rejects a work month or coverage month held by another case", () => {
    const conflict = validateDcMonthSelection({
      selectedMonths: refs("2026-07-01"),
      coveredMonths: coverage("2026-01-01", "2026-09-01"),
      otherCaseMonths: other("2026-07-01"),
    });
    expect(conflict.errors.some((e) => e.code === "CONFLICTING_CASE_MONTH")).toBe(true);
    // An other-case month whose lag is unresolved still blocks its work month.
    const unresolvedOther = validateDcMonthSelection({
      selectedMonths: refs("2026-07-01"),
      coveredMonths: coverage("2026-01-01", "2026-09-01"),
      otherCaseMonths: [{ workMonthYmd: "2026-07-01", coverageMonthYmd: null }],
    });
    expect(unresolvedOther.errors.some((e) => e.code === "CONFLICTING_CASE_MONTH")).toBe(true);
  });

  it("names continuity gaps as COVERAGE months, with the work month alongside", () => {
    // Covered through Sep 2026; picking work month Sep (Dec coverage) skips
    // Oct + Nov coverage — i.e. work months Jul + Aug.
    const result = validateDcMonthSelection({
      selectedMonths: refs("2026-09-01"),
      coveredMonths: coverage("2026-01-01", "2026-09-01"),
      otherCaseMonths: [],
      candidateMonths: candidatesAround("2026-08-01"),
    });
    expect(result.ok).toBe(false);
    const gap = result.errors.find((e) => e.code === "CONTINUITY_GAP");
    expect(gap?.months).toEqual(["2026-10-01", "2026-11-01"]);
    expect(gap?.workMonths).toEqual(["2026-07-01", "2026-08-01"]);
    expect(gap?.message).toMatch(/October 2026 \(work month July 2026\)/);
    expect(gap?.message).toMatch(/November 2026 \(work month August 2026\)/);
    expect(result.gapMonths).toEqual(["2026-10-01", "2026-11-01"]);
  });

  it("passes when the selection immediately follows coverage or backfills the gap", () => {
    const through = coverage("2026-01-01", "2026-09-01");
    expect(
      validateDcMonthSelection({
        selectedMonths: refs("2026-07-01", "2026-08-01"),
        coveredMonths: through,
        otherCaseMonths: [],
      }).ok,
    ).toBe(true);
    expect(
      validateDcMonthSelection({
        selectedMonths: refs("2026-07-01", "2026-08-01", "2026-09-01"),
        coveredMonths: through,
        otherCaseMonths: [],
      }).ok,
    ).toBe(true);
    // Gaps inside the selection itself are named too (Nov coverage missing).
    const holey = validateDcMonthSelection({
      selectedMonths: refs("2026-07-01", "2026-09-01"),
      coveredMonths: through,
      otherCaseMonths: [],
    });
    expect(holey.gapMonths).toEqual(["2026-11-01"]);
  });

  it("counts a work month already at the plan minimum as covered for continuity", () => {
    // WMB covers through Sep 2026; work month Jul (Oct coverage) has 60 of 60
    // hours reported → its coverage month is covered without DC, so Aug
    // (Nov coverage) can be selected on its own with no gap.
    const candidates = candidatesAround("2026-08-01", { "2026-07-01": MINIMUM });
    const covered = deriveDcCoveredCoverageMonths(coverage("2026-01-01", "2026-09-01"), candidates);
    expect(covered).toContain("2026-10-01");
    const result = validateDcMonthSelection({
      selectedMonths: refs("2026-08-01"),
      coveredMonths: covered,
      otherCaseMonths: [],
      candidateMonths: candidates,
    });
    expect(result.ok).toBe(true);
    // …and selecting the at-minimum month itself is "already covered".
    const atMinimum = validateDcMonthSelection({
      selectedMonths: refs("2026-07-01"),
      coveredMonths: covered,
      otherCaseMonths: [],
    });
    expect(atMinimum.errors.map((e) => e.code)).toEqual(["ALREADY_COVERED"]);
  });

  it("refuses two work months that would credit the same coverage month", () => {
    const result = validateDcMonthSelection({
      selectedMonths: [
        { workMonthYmd: "2026-07-01", coverageMonthYmd: "2026-10-01" },
        { workMonthYmd: "2026-08-01", coverageMonthYmd: "2026-10-01" },
      ],
      coveredMonths: coverage("2026-01-01", "2026-09-01"),
      otherCaseMonths: [],
    });
    expect(result.errors.some((e) => e.code === "DUPLICATE_COVERAGE_MONTH")).toBe(true);
  });

  it("enforces annual capacity per WORK-month calendar year across all cases", () => {
    expect(BAO_DC_ANNUAL_MONTH_LIMIT).toBe(6);
    const over = validateDcMonthSelection({
      selectedMonths: refs("2026-03-01", "2026-04-01", "2026-05-01"),
      coveredMonths: coverage("2025-06-01", "2026-05-01"),
      otherCaseMonths: other("2026-08-01", "2026-09-01", "2026-10-01", "2026-11-01"),
    });
    expect(over.errors.some((e) => e.code === "CAPACITY_EXCEEDED" && e.year === 2026)).toBe(
      true,
    );
    expect(over.perYear["2026"].used).toBe(4);
    expect(over.perYear["2026"].selected).toBe(3);
  });

  it("handles year boundaries: each WORK-month year's capacity is independent", () => {
    // Work months Oct 2026 … Mar 2027 → coverage Jan … Jun 2027; the year
    // is the WORK month's year, so 2026 gets 3 (+3 used) and 2027 gets 3.
    const result = validateDcMonthSelection({
      selectedMonths: refs(
        "2026-10-01",
        "2026-11-01",
        "2026-12-01",
        "2027-01-01",
        "2027-02-01",
        "2027-03-01",
      ),
      coveredMonths: coverage("2026-01-01", "2026-12-01"),
      otherCaseMonths: other("2026-05-01", "2026-06-01", "2026-07-01"),
    });
    expect(result.ok).toBe(true);
    expect(result.perYear["2026"].remaining).toBe(0);
    expect(result.perYear["2027"].selected).toBe(3);

    const overYearEnd = validateDcMonthSelection({
      selectedMonths: refs("2026-09-01", "2026-10-01", "2026-11-01", "2026-12-01"),
      coveredMonths: coverage("2026-01-01", "2026-11-01"),
      otherCaseMonths: other("2026-01-01", "2026-02-01", "2026-03-01"),
    });
    expect(
      overYearEnd.errors.some((e) => e.code === "CAPACITY_EXCEEDED" && e.year === 2026),
    ).toBe(true);
  });

  it("blocks a selection whose required backfill cannot fit in remaining capacity", () => {
    // Covered through Apr 2026 coverage (work month Jan). Picking work month
    // Jun (Sep coverage) requires backfilling May–Aug coverage, NAMED.
    const gapped = validateDcMonthSelection({
      selectedMonths: refs("2026-06-01"),
      coveredMonths: coverage("2025-06-01", "2026-04-01"),
      otherCaseMonths: [],
    });
    expect(gapped.ok).toBe(false);
    expect(gapped.gapMonths).toEqual(["2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01"]);
    // Backfilling makes the run continuous but blows the year's capacity
    // once other cases already hold months → still blocked.
    const backfilled = validateDcMonthSelection({
      selectedMonths: refs("2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01"),
      coveredMonths: coverage("2025-06-01", "2026-04-01"),
      otherCaseMonths: other("2026-08-01", "2026-09-01"),
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
      selectedMonths: refs("2026-03-01"),
      coveredMonths: [],
      otherCaseMonths: [],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === "NO_PRIOR_COVERAGE")).toBe(true);
    // Other-case DC months are NOT established coverage — still rejected.
    const dcOnly = validateDcMonthSelection({
      selectedMonths: refs("2026-04-01"),
      coveredMonths: [],
      otherCaseMonths: other("2026-03-01"),
    });
    expect(dcOnly.errors.some((e) => e.code === "NO_PRIOR_COVERAGE")).toBe(true);
  });

  it("rejects COVERAGE months before the worker's first established coverage month", () => {
    // First coverage Mar 2026. Work month Nov 2025 → Feb 2026 coverage: too
    // early. Work month Jan 2026 → Apr 2026 coverage: fine.
    const result = validateDcMonthSelection({
      selectedMonths: refs("2025-11-01", "2026-01-01"),
      coveredMonths: ["2026-03-01"],
      otherCaseMonths: [],
    });
    expect(result.ok).toBe(false);
    const err = result.errors.find((e) => e.code === "BEFORE_FIRST_COVERAGE");
    expect(err?.months).toEqual(["2026-02-01"]);
    expect(err?.workMonths).toEqual(["2025-11-01"]);
    expect(err?.message).toMatch(/February 2026 coverage \(work month November 2025\)/);
    // A coverage month EQUAL to the first coverage month is already-covered,
    // not double-reported as before-first-coverage.
    const equal = validateDcMonthSelection({
      selectedMonths: refs("2025-12-01"),
      coveredMonths: ["2026-03-01"],
      otherCaseMonths: [],
    });
    expect(equal.errors.some((e) => e.code === "ALREADY_COVERED")).toBe(true);
    expect(equal.errors.some((e) => e.code === "BEFORE_FIRST_COVERAGE")).toBe(false);
  });

  it("accepts a valid extension after the first coverage month", () => {
    const result = validateDcMonthSelection({
      selectedMonths: refs("2026-01-01"),
      coveredMonths: ["2026-02-01", "2026-03-01"],
      otherCaseMonths: [],
    });
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Month options (guided picker, coverage axis)
// ---------------------------------------------------------------------------

describe("DC month options", () => {
  const now = "2026-08-01";
  const base = {
    wmbCoverageMonths: [] as string[],
    otherCaseMonths: [] as DcOtherCaseMonth[],
    activeCaseMonths: [] as string[],
  };
  const byWork = (options: ReturnType<typeof computeDcMonthOptions>) =>
    Object.fromEntries(options.map((o) => [o.workMonthYmd, o]));

  it("spans exactly the 13-month lookback plus eight future months", () => {
    expect(BAO_DC_OPTION_LOOKBACK_MONTHS).toBe(12);
    expect(BAO_DC_OPTION_FUTURE_MONTHS).toBe(8);
    const candidates = candidatesAround(now);
    const options = computeDcMonthOptions({
      ...base,
      candidates,
      wmbCoverageMonths: ["2020-01-01"],
    });
    expect(options).toHaveLength(21);
    expect(options[0].workMonthYmd).toBe("2025-08-01");
    expect(options[options.length - 1].workMonthYmd).toBe("2027-04-01");
    // Deterministic: same inputs, same output.
    expect(
      computeDcMonthOptions({ ...base, candidates, wmbCoverageMonths: ["2020-01-01"] }),
    ).toEqual(options);
  });

  it("normalizes a mid-month 'now' to its first-of-month window", () => {
    const months = enumerateDcCandidateWorkMonths("2026-08-15");
    expect(months[0]).toBe("2025-08-01");
    expect(months[months.length - 1]).toBe("2027-04-01");
    // Extra months (active case months outside the window) are always kept.
    expect(enumerateDcCandidateWorkMonths("2026-08-15", ["2024-06-01"])).toContain("2024-06-01");
  });

  it("every option carries BOTH keys and labels the coverage month", () => {
    const options = computeDcMonthOptions({
      ...base,
      candidates: candidatesAround(now),
      wmbCoverageMonths: coverage("2026-01-01", "2026-09-01"),
    });
    const jul = byWork(options)["2026-07-01"];
    expect(jul).toMatchObject({
      workMonthYmd: "2026-07-01",
      coverageMonthYmd: "2026-10-01",
      status: "available",
      selectable: true,
      threshold: MINIMUM,
      qualifyingHours: 0,
      shortfall: MINIMUM,
    });
  });

  it("canonical: covered through Sep 2026 offers Oct + Nov coverage (work months Jul + Aug)", () => {
    const options = byWork(
      computeDcMonthOptions({
        ...base,
        candidates: candidatesAround(now),
        wmbCoverageMonths: coverage("2026-01-01", "2026-09-01"),
      }),
    );
    // Work month Jun → Sep coverage → covered; Jul/Aug → Oct/Nov → offered.
    expect(options["2026-06-01"]).toMatchObject({ status: "covered", coverageMonthYmd: "2026-09-01" });
    expect(options["2026-07-01"]).toMatchObject({ status: "available", coverageMonthYmd: "2026-10-01" });
    expect(options["2026-08-01"]).toMatchObject({ status: "available", coverageMonthYmd: "2026-11-01" });
  });

  it("offers a partial-hours work month with the top-off detail", () => {
    const options = byWork(
      computeDcMonthOptions({
        ...base,
        candidates: candidatesAround(now, { "2026-07-01": 50 }),
        wmbCoverageMonths: coverage("2026-01-01", "2026-09-01"),
      }),
    );
    expect(options["2026-07-01"]).toMatchObject({
      status: "available",
      selectable: true,
      qualifyingHours: 50,
      shortfall: 10,
      detail: "50 of 60 hours reported — Disability Credit adds 10",
    });
  });

  it("offers an at-or-above-minimum work month as not grantable with that reason", () => {
    const options = byWork(
      computeDcMonthOptions({
        ...base,
        candidates: candidatesAround(now, { "2026-07-01": 60, "2026-08-01": 72.5 }),
        wmbCoverageMonths: coverage("2026-01-01", "2026-09-01"),
      }),
    );
    expect(options["2026-07-01"]).toMatchObject({
      status: "not_grantable",
      selectable: false,
      shortfall: 0,
      detail: "60 of 60 hours reported — no Disability Credit needed",
    });
    expect(options["2026-07-01"].reason).toMatch(/already meet the plan minimum/);
    expect(options["2026-08-01"]).toMatchObject({ status: "not_grantable", shortfall: 0 });
    // The month after an at-minimum month stays selectable: Oct coverage is
    // covered by employer hours, so Dec coverage (work month Sep) continues it.
    expect(options["2026-09-01"]).toMatchObject({ status: "available", selectable: true });
  });

  it("surfaces an unresolvable month with the configuration message, not an error", () => {
    const candidates = candidatesAround(now).map((c) =>
      c.workMonthYmd === "2026-07-01"
        ? {
            ...c,
            coverageMonthYmd: null,
            threshold: null,
            unavailable: { code: "DC_GRANT_NO_THRESHOLD_RULE", message: "No threshold rule." },
          }
        : c,
    );
    const options = byWork(
      computeDcMonthOptions({
        ...base,
        candidates,
        wmbCoverageMonths: coverage("2026-01-01", "2026-09-01"),
      }),
    );
    expect(options["2026-07-01"]).toMatchObject({
      status: "unavailable",
      selectable: false,
      coverageMonthYmd: null,
      reason: "No threshold rule.",
    });
  });

  it("offers NOTHING selectable when the worker has no established coverage", () => {
    const options = computeDcMonthOptions({ ...base, candidates: candidatesAround(now) });
    expect(options.every((o) => o.status === "unavailable" && !o.selectable)).toBe(true);
    expect(options[0].reason).toMatch(/no established coverage/i);
  });

  it("never offers a COVERAGE month at or before the first established coverage month", () => {
    const options = byWork(
      computeDcMonthOptions({
        ...base,
        candidates: candidatesAround(now),
        wmbCoverageMonths: ["2026-03-01"],
      }),
    );
    // Work month Nov 2025 → Feb 2026 coverage: before first coverage.
    expect(options["2025-11-01"]).toMatchObject({ status: "unavailable", selectable: false });
    expect(options["2025-11-01"].reason).toMatch(/first established coverage month \(March 2026\)/);
    // Work month Dec 2025 → Mar 2026 coverage: equal → covered wins.
    expect(options["2025-12-01"].status).toBe("covered");
    // Work month Jan 2026 → Apr 2026 coverage: offered.
    expect(options["2026-01-01"]).toMatchObject({ status: "available", selectable: true });
  });

  it("marks covered and other-case months non-selectable with reasons", () => {
    const options = byWork(
      computeDcMonthOptions({
        ...base,
        candidates: candidatesAround(now),
        wmbCoverageMonths: coverage("2026-01-01", "2026-09-01"),
        otherCaseMonths: other("2026-07-01"),
      }),
    );
    expect(options["2026-06-01"]).toMatchObject({ status: "covered", selectable: false });
    expect(options["2026-06-01"].reason).toMatch(/already covered/i);
    expect(options["2026-07-01"]).toMatchObject({ status: "conflicting", selectable: false });
    expect(options["2026-07-01"].reason).toMatch(/another/i);
    expect(options["2026-08-01"].status).toBe("available");
  });

  it("keeps existing ACTIVE selections checked and toggleable — even outside the window", () => {
    const options = byWork(
      computeDcMonthOptions({
        ...base,
        candidates: candidatesAround(now, {}, ["2024-06-01"]),
        wmbCoverageMonths: coverage("2024-01-01", "2024-08-01"),
        activeCaseMonths: ["2024-06-01", "2026-09-01"],
      }),
    );
    // Outside the window, still present as selected + toggleable.
    expect(options["2024-06-01"]).toMatchObject({ status: "selected", selectable: true });
    // Inside the window too.
    expect(options["2026-09-01"]).toMatchObject({ status: "selected", selectable: true });
    // Selected wins over conflicting/covered classification, and a selected
    // month whose hours now meet the minimum warns instead of hiding.
    const overlapping = byWork(
      computeDcMonthOptions({
        ...base,
        candidates: candidatesAround(now, { "2026-07-01": 60 }),
        wmbCoverageMonths: coverage("2026-01-01", "2026-09-01"),
        otherCaseMonths: other("2026-06-01"),
        activeCaseMonths: ["2026-06-01", "2026-07-01"],
      }),
    );
    expect(overlapping["2026-06-01"].status).toBe("selected");
    expect(overlapping["2026-07-01"]).toMatchObject({ status: "selected", selectable: true });
    expect(overlapping["2026-07-01"].reason).toMatch(/voided at approval/);
  });
});

describe("DC post-approval derivations (shared)", () => {
  it("annual maximum: maxed out exactly at the limit, resets Jan 1 of the next year", () => {
    expect(deriveDcAnnualMaxStatus({ "2026": { used: 6, limit: 6 } }, 2026)).toEqual({
      year: 2026,
      used: 6,
      limit: 6,
      maxedOut: true,
      resetsYmd: "2027-01-01",
    });
    expect(deriveDcAnnualMaxStatus({ "2026": { used: 5, limit: 6 } }, 2026).maxedOut).toBe(false);
    // No usage row for the current year = nothing used, not maxed.
    expect(deriveDcAnnualMaxStatus({ "2025": { used: 6, limit: 6 } }, 2026)).toMatchObject({
      used: 0,
      maxedOut: false,
    });
  });

  it("history renders each entry's own coverage snapshot — a later plan-lag change never rewrites it", () => {
    // Every entry was written under lag 3 (Jul work → Oct coverage). The
    // plan lag has since changed to 4: the log must still say Oct.
    const liveLagNow = (work: string) => addMonthsYmd(work as Ymd, 4);
    const month = {
      id: "m1",
      caseId: "c1",
      workMonthYmd: "2026-07-01",
      status: "granted",
      voidReason: null,
      data: { coverageMonthYmd: "2026-10-01", grantedHours: 60 },
    };
    const events = [
      {
        id: "e1",
        eventType: "case_month_added",
        caseId: "c1",
        dedupeKey: "s",
        payload: { monthId: "m1", workMonthYmd: "2026-07-01", coverageMonthYmd: "2026-10-01", actorUserId: "u1" },
        createdAt: "2026-09-04T15:11:33.000Z",
      },
      {
        id: "e2",
        eventType: "case_month_granted",
        caseId: "c1",
        dedupeKey: "g",
        payload: { monthId: "m1", workMonthYmd: "2026-07-01", coverageMonthYmd: "2026-10-01", grantedHours: 100 },
        createdAt: "2026-09-04T15:11:48.000Z",
      },
      {
        // Reconcile events carry the row's grant stamp (storage copies it in).
        id: "e3",
        eventType: "case_month_reconciled",
        caseId: "c1",
        dedupeKey: "r",
        payload: { monthId: "m1", workMonthYmd: "2026-07-01", coverageMonthYmd: "2026-10-01", previousDcHours: 100, dcHours: 60 },
        createdAt: "2026-09-05T09:00:00.000Z",
      },
    ];
    const history = deriveDcMonthHistory(events, [month], liveLagNow);
    expect(history.map((e) => e.eventType)).toEqual([
      "case_month_added",
      "case_month_granted",
      "case_month_reconciled",
    ]);
    for (const entry of history) {
      expect(entry).toMatchObject({ coverageMonthYmd: "2026-10-01", coverageSource: "event" });
    }
    expect(history[0]).toMatchObject({ actorUserId: "u1", hoursAfter: null });
    expect(history[1]).toMatchObject({ hoursBefore: 0, hoursAfter: 100 });
    expect(history[2]).toMatchObject({ hoursBefore: 100, hoursAfter: 60, removed: false });
  });

  it("history: a snapshot of 'unresolvable' stays null; only legacy entries without one use the row stamp, then the live lag", () => {
    const liveLagNow = (work: string) => addMonthsYmd(work as Ymd, 4);
    const grantedRow = {
      id: "m1",
      caseId: "c1",
      workMonthYmd: "2026-07-01",
      status: "granted",
      voidReason: null,
      data: { coverageMonthYmd: "2026-10-01" },
    };
    const selectedRow = {
      id: "m2",
      caseId: "c1",
      workMonthYmd: "2026-08-01",
      status: "selected",
      voidReason: null,
      data: null,
    };
    const events = [
      {
        // Deselected while its lag could not be resolved: recorded as such.
        id: "e0",
        eventType: "case_month_voided",
        caseId: "c1",
        dedupeKey: "v",
        payload: { monthId: "m3", workMonthYmd: "2026-06-01", coverageMonthYmd: null, reason: "deselected", actorUserId: "u1" },
        createdAt: "2026-09-04T15:10:00.000Z",
      },
      {
        // Legacy selection entry (no snapshot) on a month later granted: the
        // grant stamp is the honest historical value.
        id: "e1",
        eventType: "case_month_added",
        caseId: "c1",
        dedupeKey: "s1",
        payload: { monthId: "m1", workMonthYmd: "2026-07-01", actorUserId: "u1" },
        createdAt: "2026-09-04T15:11:33.000Z",
      },
      {
        // Legacy selection entry on a still-selected month: only the live
        // lag can label it, and the entry says so.
        id: "e2",
        eventType: "case_month_added",
        caseId: "c1",
        dedupeKey: "s2",
        payload: { monthId: "m2", workMonthYmd: "2026-08-01", actorUserId: "u1" },
        createdAt: "2026-09-04T15:12:00.000Z",
      },
    ];
    const history = deriveDcMonthHistory(events, [grantedRow, selectedRow], liveLagNow);
    expect(history.map((e) => [e.eventType, e.coverageMonthYmd, e.coverageSource])).toEqual([
      ["case_month_voided", null, "event"],
      ["case_month_added", "2026-10-01", "row"],
      ["case_month_added", "2026-12-01", "live"],
    ]);
    expect(history[0]).toMatchObject({ removed: true, reason: "deselected" });
  });
});
