import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../server/db";
import { storage } from "../../server/storage";
import { getComponentById } from "@shared/components";
import {
  sitespecificBaoDcCases,
  sitespecificBaoDcDenialLetters,
  sitespecificBaoDcEvents,
  BAO_DC_FMLA_REQUIRED_MONTHS,
} from "@shared/schema";
import { addMonthsYmd } from "@shared/utils/date";
import dcMigration from "../../scripts/migrate/components/sitespecific.bao/011_create_disability_credit";
import {
  evaluateDcEligibility,
  findUnreportedGapsBetweenFmlaMonths,
  isDenialLetterActive,
  isFmlaStatusOption,
  isRetiredDisabilityStatusOption,
  rollingWindow,
} from "../../server/services/sitespecific/bao/dc-eligibility";
import {
  parseDenialLetterValidityMonths,
  parseRetiredDisabilityRowMode,
  BAO_DC_DENIAL_LETTER_VALIDITY_MONTHS_DEFAULT,
  BAO_DC_RETIRED_DISABILITY_ROW_MODE_DEFAULT,
} from "../../server/services/sitespecific/bao/dc-settings";

// ---------------------------------------------------------------------------
// Pure foundation logic (no DB needed)
// ---------------------------------------------------------------------------

describe("date math", () => {
  it("adds months with day clamping and never rolls over", () => {
    expect(addMonthsYmd("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsYmd("2024-01-31", 1)).toBe("2024-02-29"); // leap year
    expect(addMonthsYmd("2026-03-15", -3)).toBe("2025-12-15");
    expect(addMonthsYmd("2026-12-01", 1)).toBe("2027-01-01");
  });
});

describe("DC configuration parsing", () => {
  it("applies the specified defaults", () => {
    expect(parseDenialLetterValidityMonths(undefined)).toBe(BAO_DC_DENIAL_LETTER_VALIDITY_MONTHS_DEFAULT);
    expect(parseRetiredDisabilityRowMode(undefined)).toBe(BAO_DC_RETIRED_DISABILITY_ROW_MODE_DEFAULT);
    expect(BAO_DC_RETIRED_DISABILITY_ROW_MODE_DEFAULT).toBe("flag");
    expect(BAO_DC_DENIAL_LETTER_VALIDITY_MONTHS_DEFAULT).toBe(12);
  });

  it("accepts both configuration modes and rejects garbage", () => {
    expect(parseRetiredDisabilityRowMode("reject")).toBe("reject");
    expect(parseRetiredDisabilityRowMode(" FLAG ")).toBe("flag");
    expect(parseRetiredDisabilityRowMode("banana")).toBe("flag");
    expect(parseDenialLetterValidityMonths("6")).toBe(6);
    expect(parseDenialLetterValidityMonths("0")).toBe(12);
    expect(parseDenialLetterValidityMonths("nope")).toBe(12);
  });
});

describe("status classification", () => {
  it("LOA never qualifies as FMLA", () => {
    expect(isFmlaStatusOption({ name: "FMLA", code: "" })).toBe(true);
    expect(isFmlaStatusOption({ name: "F M L A", code: null })).toBe(true);
    expect(isFmlaStatusOption({ name: "LOA", code: "loa" })).toBe(false);
    expect(isFmlaStatusOption({ name: "Leave of Absence", code: "" })).toBe(false);
    expect(isRetiredDisabilityStatusOption({ name: "Disability", code: "" })).toBe(true);
    expect(isRetiredDisabilityStatusOption({ name: "FMLA", code: "" })).toBe(false);
  });
});

describe("rolling FMLA eligibility (pure core)", () => {
  const letters: never[] = [];
  const base = { denialLetters: letters, denialLetterValidityMonths: 12 };

  it("requires exactly the threshold of months — boundary", () => {
    const two = evaluateDcEligibility({ ...base, asOfYmd: "2026-08-15", fmlaMonths: ["2026-06-01", "2026-07-01"] });
    expect(two.eligible).toBe(false);
    const three = evaluateDcEligibility({ ...base, asOfYmd: "2026-08-15", fmlaMonths: ["2026-05-01", "2026-06-01", "2026-07-01"] });
    expect(three.eligible).toBe(true);
    expect(three.conditions).toEqual(["fmla_months"]);
    expect(three.basis.fmlaMonths).toEqual(["2026-05-01", "2026-06-01", "2026-07-01"]);
    expect(BAO_DC_FMLA_REQUIRED_MONTHS).toBe(3);
  });

  it("counts INTERMITTENT months, not just consecutive ones", () => {
    const result = evaluateDcEligibility({
      ...base,
      asOfYmd: "2026-08-15",
      fmlaMonths: ["2025-10-01", "2026-02-01", "2026-07-01"],
    });
    expect(result.eligible).toBe(true);
  });

  it("enforces the rolling 12-month window boundaries", () => {
    const { startMonthYmd, endMonthYmd } = rollingWindow("2026-08-15");
    expect(startMonthYmd).toBe("2025-09-01");
    expect(endMonthYmd).toBe("2026-08-01");
    // A month just OUTSIDE the window doesn't count.
    const outside = evaluateDcEligibility({
      ...base,
      asOfYmd: "2026-08-15",
      fmlaMonths: ["2025-08-01", "2026-06-01", "2026-07-01"],
    });
    expect(outside.eligible).toBe(false);
    // The window START month counts.
    const edge = evaluateDcEligibility({
      ...base,
      asOfYmd: "2026-08-15",
      fmlaMonths: ["2025-09-01", "2026-06-01", "2026-07-01"],
    });
    expect(edge.eligible).toBe(true);
    // Duplicates count once.
    const dupes = evaluateDcEligibility({
      ...base,
      asOfYmd: "2026-08-15",
      fmlaMonths: ["2026-07-01", "2026-07-01", "2026-06-01"],
    });
    expect(dupes.eligible).toBe(false);
  });
});

describe("denial-letter eligibility (derived expiry)", () => {
  it("active window is [letter, letter + validity months)", () => {
    const letter = { letterYmd: "2026-01-10", voidedYmd: null };
    expect(isDenialLetterActive(letter, "2026-01-10", 12)).toBe(true);
    expect(isDenialLetterActive(letter, "2027-01-09", 12)).toBe(true);
    expect(isDenialLetterActive(letter, "2027-01-10", 12)).toBe(false); // expired
    expect(isDenialLetterActive(letter, "2026-01-09", 12)).toBe(false); // future letter
    expect(isDenialLetterActive({ ...letter, voidedYmd: "2026-02-01" }, "2026-03-01", 12)).toBe(false);
    // Validity change is honored immediately — expiry is derived, not stored.
    expect(isDenialLetterActive(letter, "2026-08-01", 6)).toBe(false);
    expect(isDenialLetterActive(letter, "2026-08-01", 12)).toBe(true);
  });

  it("qualifies a worker without FMLA months and records the condition", () => {
    const result = evaluateDcEligibility({
      asOfYmd: "2026-08-15",
      fmlaMonths: [],
      denialLetters: [
        { id: "L1", letterYmd: "2026-01-01", voidedYmd: null },
        { id: "L2", letterYmd: "2020-01-01", voidedYmd: null }, // expired
        { id: "L3", letterYmd: "2027-01-01", voidedYmd: null }, // future
      ],
      denialLetterValidityMonths: 12,
    });
    expect(result.eligible).toBe(true);
    expect(result.conditions).toEqual(["denial_letter"]);
    expect(result.activeDenialLetterIds).toEqual(["L1"]);
  });

  it("records BOTH conditions when both hold", () => {
    const result = evaluateDcEligibility({
      asOfYmd: "2026-08-15",
      fmlaMonths: ["2026-05-01", "2026-06-01", "2026-07-01"],
      denialLetters: [{ id: "L1", letterYmd: "2026-06-01", voidedYmd: null }],
      denialLetterValidityMonths: 12,
    });
    expect(result.conditions).toEqual(["fmla_months", "denial_letter"]);
  });
});

describe("FMLA gap reporting", () => {
  it("reports months between FMLA months with no reported rows at all", () => {
    expect(
      findUnreportedGapsBetweenFmlaMonths(
        ["2026-01-01", "2026-05-01"],
        ["2026-01-01", "2026-03-01", "2026-05-01"],
      ),
    ).toEqual(["2026-02-01", "2026-04-01"]);
    // Consecutive FMLA months: nothing to report.
    expect(findUnreportedGapsBetweenFmlaMonths(["2026-01-01", "2026-02-01"], ["2026-01-01", "2026-02-01"])).toEqual([]);
    // A single FMLA month has no "between".
    expect(findUnreportedGapsBetweenFmlaMonths(["2026-01-01"], [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// DB-backed foundation (component tables, integrity, idempotency)
// ---------------------------------------------------------------------------

const run = `bao-dc-test-${Date.now()}`;
let workerId = "";
let otherWorkerId = "";
let userId = "";
const caseIds: string[] = [];
const letterIds: string[] = [];

beforeAll(async () => {
  await dcMigration.up();
  if (!(await storage.baoDisabilityCredit.tableExists())) {
    throw new Error("DC migration did not create its tables");
  }
  const workers = await storage.workers.getAllWorkers();
  const assignees = await storage.users.getUsersWithAnyPermission(["staff", "admin"]);
  if (workers.length < 2 || !assignees[0]) {
    throw new Error("DC tests require two workers and one staff user");
  }
  workerId = workers[0].id;
  otherWorkerId = workers[1].id;
  userId = assignees[0].id;
});

afterAll(async () => {
  for (const id of caseIds) {
    await db.delete(sitespecificBaoDcEvents).where(eq(sitespecificBaoDcEvents.caseId, id));
    await db.delete(sitespecificBaoDcCases).where(eq(sitespecificBaoDcCases.id, id));
  }
  for (const id of letterIds) {
    await db.delete(sitespecificBaoDcDenialLetters).where(eq(sitespecificBaoDcDenialLetters.id, id));
  }
  await db.delete(sitespecificBaoDcEvents).where(eq(sitespecificBaoDcEvents.workerId, workerId));
  await db.delete(sitespecificBaoDcEvents).where(eq(sitespecificBaoDcEvents.workerId, otherWorkerId));
});

describe("DC component ownership", () => {
  it("declares every DC table in the component manifest", () => {
    const tables = getComponentById("sitespecific.bao")?.schemaManifest?.tables ?? [];
    expect(tables).toEqual(expect.arrayContaining([
      "sitespecific_bao_dc_cases",
      "sitespecific_bao_dc_case_months",
      "sitespecific_bao_dc_denial_letters",
      "sitespecific_bao_dc_documents",
      "sitespecific_bao_dc_case_notes",
      "sitespecific_bao_dc_events",
    ]));
  });
});

describe("DC case integrity", () => {
  const basis = {
    asOfYmd: "2026-08-15",
    conditions: ["fmla_months" as const],
    fmlaMonths: ["2026-05-01", "2026-06-01", "2026-07-01"],
  };

  it("opens a case with a preserved qualifying-basis snapshot and refuses a second live case", async () => {
    const created = await storage.baoDisabilityCredit.openCase({
      workerId, openedYmd: "2026-08-15", qualifyingBasis: basis,
    });
    caseIds.push(created.id);
    expect(created.status).toBe("open");
    expect(created.qualifyingBasis).toEqual(basis);

    await expect(
      storage.baoDisabilityCredit.openCase({ workerId, openedYmd: "2026-08-16", qualifyingBasis: basis }),
    ).rejects.toThrow("LIVE_CASE_EXISTS");

    // The stored basis never changes even if the underlying facts would no
    // longer qualify (corrected-away FMLA): re-read and compare.
    const reread = await storage.baoDisabilityCredit.getCase(created.id);
    expect(reread?.qualifyingBasis).toEqual(basis);
    expect(reread?.status).toBe("open");
  });

  it("requires a reason for terminal transitions and is idempotent on repeat", async () => {
    const theCase = (await storage.baoDisabilityCredit.getLiveCaseForWorker(workerId))!;
    await expect(
      storage.baoDisabilityCredit.terminateCase(theCase.id, "closed", "  ", "2026-09-01"),
    ).rejects.toThrow("TERMINAL_REASON_REQUIRED");

    const closed = await storage.baoDisabilityCredit.terminateCase(
      theCase.id, "closed", "worker returned to work", "2026-09-01",
    );
    expect(closed.status).toBe("closed");
    expect(closed.terminalReason).toBe("worker returned to work");

    // Repeat: idempotent no-op; a DIFFERENT terminal transition is refused.
    const repeat = await storage.baoDisabilityCredit.terminateCase(
      theCase.id, "closed", "worker returned to work", "2026-09-01",
    );
    expect(repeat.id).toBe(closed.id);
    await expect(
      storage.baoDisabilityCredit.terminateCase(theCase.id, "void", "oops", "2026-09-02"),
    ).rejects.toThrow("CASE_ALREADY_TERMINAL");

    // Exactly ONE case_closed event row despite the repeat (idempotent emission).
    const events = await storage.baoDisabilityCredit.listEventsForWorker(workerId);
    expect(events.filter((e) => e.eventType === "case_closed" && e.caseId === theCase.id)).toHaveLength(1);
    expect(events.filter((e) => e.eventType === "case_opened" && e.caseId === theCase.id)).toHaveLength(1);
  });

  it("enforces one LIVE month per worker/work-month and derives annual usage", async () => {
    const c1 = await storage.baoDisabilityCredit.openCase({
      workerId, openedYmd: "2026-09-10", qualifyingBasis: basis,
    });
    caseIds.push(c1.id);

    await expect(
      storage.baoDisabilityCredit.addCaseMonth(c1.id, "2026-09-15"),
    ).rejects.toThrow("WORK_MONTH_MUST_BE_FIRST_OF_MONTH");

    const m1 = await storage.baoDisabilityCredit.addCaseMonth(c1.id, "2026-09-01");
    expect(m1.status).toBe("live");
    // Identical repeat is idempotent — same row, no duplicate.
    const m1again = await storage.baoDisabilityCredit.addCaseMonth(c1.id, "2026-09-01");
    expect(m1again.id).toBe(m1.id);
    expect(await storage.baoDisabilityCredit.listCaseMonths(c1.id)).toHaveLength(1);

    await storage.baoDisabilityCredit.addCaseMonth(c1.id, "2026-10-01");
    expect(await storage.baoDisabilityCredit.countLiveMonthsForWorkerYear(workerId, 2026)).toBe(2);

    // Voiding requires a reason; a voided month frees the slot.
    await expect(storage.baoDisabilityCredit.voidCaseMonth(m1.id, "")).rejects.toThrow("VOID_REASON_REQUIRED");
    const voided = await storage.baoDisabilityCredit.voidCaseMonth(m1.id, "issued in error");
    expect(voided.status).toBe("void");
    const voidedAgain = await storage.baoDisabilityCredit.voidCaseMonth(m1.id, "issued in error");
    expect(voidedAgain.id).toBe(voided.id);
    expect(await storage.baoDisabilityCredit.countLiveMonthsForWorkerYear(workerId, 2026)).toBe(1);
    const reissued = await storage.baoDisabilityCredit.addCaseMonth(c1.id, "2026-09-01");
    expect(reissued.id).not.toBe(m1.id);

    // Exactly one month event per distinct operation despite the repeats.
    const events = await storage.baoDisabilityCredit.listEventsForWorker(workerId);
    expect(events.filter((e) => e.eventType === "case_month_added").length).toBe(3);
    expect(events.filter((e) => e.eventType === "case_month_voided").length).toBe(1);

    await storage.baoDisabilityCredit.terminateCase(c1.id, "void", "test cleanup", "2026-12-31");
  });

  it("keeps case notes append-only with same-case correction links", async () => {
    const c = await storage.baoDisabilityCredit.openCase({
      workerId: otherWorkerId, openedYmd: "2026-08-15",
      qualifyingBasis: { asOfYmd: "2026-08-15", conditions: ["denial_letter"], denialLetterIds: ["x"] },
    });
    caseIds.push(c.id);
    const n1 = await storage.baoDisabilityCredit.addCaseNote({
      caseId: c.id, authorUserId: userId, body: `${run} original note`,
    });
    const n2 = await storage.baoDisabilityCredit.addCaseNote({
      caseId: c.id, authorUserId: userId, body: `${run} correction`, correctsNoteId: n1.id,
    });
    expect(n2.correctsNoteId).toBe(n1.id);
    // No update/delete surface exists at all.
    expect((storage.baoDisabilityCredit as any).updateCaseNote).toBeUndefined();
    expect((storage.baoDisabilityCredit as any).deleteCaseNote).toBeUndefined();
    // A correction may only reference a note on the SAME case.
    const other = await storage.baoDisabilityCredit.openCase({
      workerId, openedYmd: "2027-01-01",
      qualifyingBasis: { asOfYmd: "2027-01-01", conditions: ["denial_letter"], denialLetterIds: ["x"] },
    });
    caseIds.push(other.id);
    await expect(
      storage.baoDisabilityCredit.addCaseNote({
        caseId: other.id, authorUserId: userId, body: "cross-case", correctsNoteId: n1.id,
      }),
    ).rejects.toThrow("CORRECTED_NOTE_NOT_ON_CASE");
    expect(await storage.baoDisabilityCredit.listCaseNotes(c.id)).toHaveLength(2);
    await storage.baoDisabilityCredit.terminateCase(c.id, "void", "test cleanup", "2027-01-02");
    await storage.baoDisabilityCredit.terminateCase(other.id, "void", "test cleanup", "2027-01-02");
  });

  it("records and voids denial letters with idempotent events", async () => {
    const letter = await storage.baoDisabilityCredit.createDenialLetter({
      workerId, letterYmd: "2026-06-01",
    });
    letterIds.push(letter.id);
    await expect(storage.baoDisabilityCredit.voidDenialLetter(letter.id, "", "2026-07-01"))
      .rejects.toThrow("VOID_REASON_REQUIRED");
    const voided = await storage.baoDisabilityCredit.voidDenialLetter(letter.id, "superseded", "2026-07-01");
    expect(voided.voidReason).toBe("superseded");
    const again = await storage.baoDisabilityCredit.voidDenialLetter(letter.id, "superseded", "2026-07-01");
    expect(again.id).toBe(voided.id);
    const events = await storage.baoDisabilityCredit.listEventsForWorker(workerId);
    expect(events.filter((e) => e.eventType === "denial_letter_recorded").length).toBe(1);
    expect(events.filter((e) => e.eventType === "denial_letter_voided").length).toBe(1);
  });

  it("attaches document metadata to exactly one parent", async () => {
    const c = await storage.baoDisabilityCredit.openCase({
      workerId, openedYmd: "2027-02-01",
      qualifyingBasis: { asOfYmd: "2027-02-01", conditions: ["denial_letter"], denialLetterIds: ["x"] },
    });
    caseIds.push(c.id);
    const doc = await storage.baoDisabilityCredit.addDocument({
      parentKind: "case", caseId: c.id, name: `${run}.pdf`, uploadedByUserId: userId,
    });
    expect((await storage.baoDisabilityCredit.listDocumentsForCase(c.id))[0].id).toBe(doc.id);
    // Both parents set (or neither) violates the CHECK constraint.
    await expect(
      storage.baoDisabilityCredit.addDocument({
        parentKind: "case", caseId: null, name: "bad.pdf", uploadedByUserId: userId,
      } as any),
    ).rejects.toThrow();
    await storage.baoDisabilityCredit.terminateCase(c.id, "void", "test cleanup", "2027-02-02");
  });
});
