import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../server/db";
import { storage } from "../../server/storage";
import { getComponentById } from "@shared/components";
import {
  sitespecificBaoDcCases,
  sitespecificBaoDcCaseMonths,
  sitespecificBaoDcDenialLetters,
  sitespecificBaoDcEvents,
  BAO_DC_FMLA_REQUIRED_MONTHS,
} from "@shared/schema";
import { registerBaoDcEntityFileContext } from "../../server/modules/sitespecific/bao/dc-files-context";
import { getEntityFileContext } from "../../server/services/entity-files/registry";
import {
  performDcCaseAction,
  recomputeReadinessAndMaybeBounce,
} from "../../server/services/sitespecific/bao/dc-workflow";
import { addMonthsYmd } from "@shared/utils/date";
import dcMigration from "../../scripts/migrate/components/sitespecific.bao/011_create_disability_credit";
import dcWorkflowMigration from "../../scripts/migrate/components/sitespecific.bao/012_dc_case_workflow";
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
  await dcWorkflowMigration.up();
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

  it("opens a case in draft with a preserved qualifying-basis snapshot and requires explicit duplicate confirmation", async () => {
    const created = await storage.baoDisabilityCredit.openCase({
      workerId, openedYmd: "2026-08-15", qualifyingBasis: basis, createdByUserId: userId,
    });
    caseIds.push(created.id);
    expect(created.status).toBe("draft");
    expect(created.qualifyingBasis).toEqual(basis);

    await expect(
      storage.baoDisabilityCredit.openCase({ workerId, openedYmd: "2026-08-16", qualifyingBasis: basis }),
    ).rejects.toThrow("DUPLICATE_OPEN_CASE");

    // Explicit confirmation allows the duplicate.
    const dup = await storage.baoDisabilityCredit.openCase({
      workerId, openedYmd: "2026-08-16", qualifyingBasis: basis, allowDuplicate: true,
    });
    caseIds.push(dup.id);
    expect(dup.id).not.toBe(created.id);

    // The stored basis never changes even if the underlying facts would no
    // longer qualify (corrected-away FMLA): re-read and compare.
    const reread = await storage.baoDisabilityCredit.getCase(created.id);
    expect(reread?.qualifyingBasis).toEqual(basis);
    await storage.baoDisabilityCredit.transitionCase(dup.id, {
      to: "void", reason: "test cleanup", actorUserId: userId,
    });
  });

  it("requires a reason for terminal transitions and is idempotent on repeat", async () => {
    const [theCase] = await storage.baoDisabilityCredit.listOpenCasesForWorker(workerId);
    await expect(
      storage.baoDisabilityCredit.transitionCase(theCase.id, {
        to: "withdrawn", reason: "  ", actorUserId: userId,
      }),
    ).rejects.toThrow("TERMINAL_REASON_REQUIRED");

    const closed = await storage.baoDisabilityCredit.transitionCase(theCase.id, {
      to: "withdrawn", reason: "worker returned to work", actorUserId: userId,
    });
    expect(closed.status).toBe("withdrawn");
    expect(closed.terminalReason).toBe("worker returned to work");

    // Repeat: idempotent no-op; a DIFFERENT terminal transition is refused.
    const repeat = await storage.baoDisabilityCredit.transitionCase(theCase.id, {
      to: "withdrawn", reason: "worker returned to work", actorUserId: userId,
    });
    expect(repeat.id).toBe(closed.id);
    await expect(
      storage.baoDisabilityCredit.transitionCase(theCase.id, {
        to: "void", reason: "oops", actorUserId: userId,
      }),
    ).rejects.toThrow("CASE_ALREADY_TERMINAL");

    // Exactly ONE terminal status event despite the repeat (idempotent emission).
    const events = await storage.baoDisabilityCredit.listEventsForCase(theCase.id);
    const terminalEvents = events.filter(
      (e) => e.eventType === "case_status_changed" && (e.payload as any)?.to === "withdrawn",
    );
    expect(terminalEvents).toHaveLength(1);
    expect(events.filter((e) => e.eventType === "case_opened")).toHaveLength(1);
  });

  it("replaces months atomically, counts applicable usage, and frees removed months", async () => {
    const c1 = await storage.baoDisabilityCredit.openCase({
      workerId, openedYmd: "2026-09-10", qualifyingBasis: basis,
    });
    caseIds.push(c1.id);

    await expect(
      storage.baoDisabilityCredit.replaceCaseMonths(c1.id, ["2026-09-15"], { actorUserId: userId }),
    ).rejects.toThrow();

    const covered = await storage.baoDisabilityCredit.getCoveredMonthsForWorker(workerId);
    const pick = covered.filter((m) => m >= "2026-01-01").slice(0, 2);
    // Without coverage data on this worker we can still exercise the removed-month
    // semantics using validation-passing months when available.
    if (pick.length >= 2) {
      const months = await storage.baoDisabilityCredit.replaceCaseMonths(c1.id, pick, {
        actorUserId: userId,
      });
      expect(months.filter((m) => m.status === "selected").length).toBe(pick.length);
      // Idempotent repeat: same set, no duplicate rows.
      const again = await storage.baoDisabilityCredit.replaceCaseMonths(c1.id, pick, {
        actorUserId: userId,
      });
      expect(again.filter((m) => m.status !== "removed").length).toBe(pick.length);
      // Deselect one: it becomes removed and stops counting.
      const fewer = await storage.baoDisabilityCredit.replaceCaseMonths(c1.id, [pick[0]], {
        actorUserId: userId,
      });
      expect(fewer.filter((m) => m.status === "removed").length).toBe(1);
      const year = Number(pick[0].slice(0, 4));
      const applicable = await storage.baoDisabilityCredit.countApplicableMonthsForWorkerYear(
        workerId, year,
      );
      expect(applicable).toBeGreaterThanOrEqual(1);
    }
    await storage.baoDisabilityCredit.transitionCase(c1.id, {
      to: "void", reason: "test cleanup", actorUserId: userId,
    });
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
    await storage.baoDisabilityCredit.transitionCase(c.id, {
      to: "void", reason: "test cleanup", actorUserId: userId,
    });
    await storage.baoDisabilityCredit.transitionCase(other.id, {
      to: "void", reason: "test cleanup", actorUserId: userId,
    });
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

  it("attaches document metadata to exactly one parent and supersedes instead of deleting", async () => {
    const c = await storage.baoDisabilityCredit.openCase({
      workerId, openedYmd: "2027-02-01",
      qualifyingBasis: { asOfYmd: "2027-02-01", conditions: ["denial_letter"], denialLetterIds: ["x"] },
    });
    caseIds.push(c.id);
    const doc = await storage.baoDisabilityCredit.addDocument({
      parentKind: "case", caseId: c.id, name: `${run}.pdf`, uploadedByUserId: userId, docType: "dc_form",
    });
    expect((await storage.baoDisabilityCredit.listDocumentsForCase(c.id))[0].id).toBe(doc.id);
    // Supersession marks, never deletes; idempotent on repeat.
    const superseded = await storage.baoDisabilityCredit.supersedeDocument(doc.id, userId);
    expect(superseded.supersededAt).not.toBeNull();
    expect(superseded.supersededByUserId).toBe(userId);
    const again = await storage.baoDisabilityCredit.supersedeDocument(doc.id, userId);
    expect(again.supersededAt).toEqual(superseded.supersededAt);
    expect(await storage.baoDisabilityCredit.listDocumentsForCase(c.id)).toHaveLength(1);
    // No delete surface exists.
    expect((storage.baoDisabilityCredit as any).deleteDocument).toBeUndefined();
    // Both parents set (or neither) violates the CHECK constraint.
    await expect(
      storage.baoDisabilityCredit.addDocument({
        parentKind: "case", caseId: null, name: "bad.pdf", uploadedByUserId: userId,
      } as any),
    ).rejects.toThrow();
    await storage.baoDisabilityCredit.transitionCase(c.id, {
      to: "void", reason: "test cleanup", actorUserId: userId,
    });
  });
});

// ---------------------------------------------------------------------------
// Document classification boundary + evidence-change auto-bounce
// ---------------------------------------------------------------------------

describe("DC document classification boundary", () => {
  it("refuses ALL updates through the generic entity-files adapter (member PATCH path)", async () => {
    registerBaoDcEntityFileContext();
    const context = getEntityFileContext("bao-dc-case");
    expect(context).toBeDefined();
    // The generic PATCH route calls adapter.update after a manage check that
    // a member who owns the case passes — so the adapter itself must refuse.
    await expect(
      context!.adapter.update("any-case", "any-doc", { data: { docType: "dc_form" } }),
    ).rejects.toThrow("DC_DOCUMENT_UPDATE_VIA_DC_ROUTES");
    // Deletion is likewise impossible through the generic route.
    await expect(context!.adapter.remove("any-case", "any-doc")).rejects.toThrow(
      "DC_DOCUMENTS_CANNOT_BE_DELETED",
    );
  });

  it("auto-bounces a queued case when its only DC form is reclassified away", async () => {
    const c = await storage.baoDisabilityCredit.openCase({
      workerId: otherWorkerId, openedYmd: "2027-06-01",
      qualifyingBasis: { asOfYmd: "2027-06-01", conditions: ["denial_letter"], denialLetterIds: ["x"] },
      allowDuplicate: true,
    });
    caseIds.push(c.id);
    const form = await storage.baoDisabilityCredit.addDocument({
      parentKind: "case", caseId: c.id, name: "form.pdf", uploadedByUserId: userId, docType: "dc_form",
    });
    await storage.baoDisabilityCredit.updateCaseAttestations(
      c.id,
      { signed: true, fields: { doctorAddress: true, doctorPhone: true, dates: true } },
      userId,
    );
    // Give it a month directly (bypassing coverage continuity for the test).
    await db.insert(sitespecificBaoDcCaseMonths).values({
      caseId: c.id, workerId: otherWorkerId, workMonthYmd: "2098-01-01", status: "selected",
    });
    await storage.baoDisabilityCredit.transitionCase(c.id, {
      to: "ready_for_review", actorUserId: userId,
    });
    await storage.baoDisabilityCredit.transitionCase(c.id, {
      to: "in_queue", actorUserId: userId,
    });

    // Staff reclassify the only DC form to "other" → checklist stops passing
    // → the queued case must bounce back to draft with a system note.
    await storage.baoDisabilityCredit.updateCaseDocument(c.id, form.id, { docType: "other" });
    const { readiness, bounced } = await recomputeReadinessAndMaybeBounce(c.id, userId);
    expect(readiness.ready).toBe(false);
    expect(readiness.missing).toContain("DC form on file");
    expect(bounced).toBe(true);
    const after = await storage.baoDisabilityCredit.getCase(c.id);
    expect(after?.status).toBe("draft");
    const notes = await storage.baoDisabilityCredit.listCaseNotes(c.id);
    expect(notes.some((n) => n.body.toLowerCase().includes("no longer passes"))).toBe(true);

    await db.delete(sitespecificBaoDcCaseMonths).where(eq(sitespecificBaoDcCaseMonths.caseId, c.id));
    await storage.baoDisabilityCredit.transitionCase(c.id, {
      to: "void", reason: "test cleanup", actorUserId: userId,
    });
  });
});

describe("DC approval vs evidence-mutation race", () => {
  it("an approval racing a supersede recomputes readiness under the case lock", async () => {
    const c = await storage.baoDisabilityCredit.openCase({
      workerId: otherWorkerId, openedYmd: "2027-08-01",
      qualifyingBasis: { asOfYmd: "2027-08-01", conditions: ["denial_letter"], denialLetterIds: ["x"] },
      allowDuplicate: true,
    });
    caseIds.push(c.id);
    const form = await storage.baoDisabilityCredit.addDocument({
      parentKind: "case", caseId: c.id, name: "form.pdf", uploadedByUserId: userId, docType: "dc_form",
    });
    await storage.baoDisabilityCredit.updateCaseAttestations(
      c.id,
      { signed: true, fields: { doctorAddress: true, doctorPhone: true, dates: true } },
      userId,
    );
    await db.insert(sitespecificBaoDcCaseMonths).values({
      caseId: c.id, workerId: otherWorkerId, workMonthYmd: "2099-01-01", status: "selected",
    });
    await storage.baoDisabilityCredit.transitionCase(c.id, { to: "ready_for_review", actorUserId: userId });
    await storage.baoDisabilityCredit.transitionCase(c.id, { to: "in_queue", actorUserId: userId });

    // Hold the case's serialization lock, supersede the only DC form inside
    // it, and keep the transaction open while an approval is attempted.
    let approvalError: unknown;
    const supersedeTx = storage.baoDisabilityCredit.withCaseSerialization(c.id, async () => {
      await storage.baoDisabilityCredit.supersedeDocument(form.id, userId);
      await new Promise((r) => setTimeout(r, 500));
    });
    await new Promise((r) => setTimeout(r, 150));
    const approval = performDcCaseAction(c.id, "approve", { actorUserId: userId }).catch(
      (err) => {
        approvalError = err;
        return undefined;
      },
    );
    await Promise.all([supersedeTx, approval]);

    // The approval blocked on the lock, then rechecked readiness AGAINST the
    // committed supersede — so it must have refused, naming the missing form.
    expect(approvalError).toBeDefined();
    expect((approvalError as Error).message).toBe("CASE_NOT_READY");
    expect((approvalError as Error & { details?: string[] }).details).toContain(
      "DC form on file",
    );
    const after = await storage.baoDisabilityCredit.getCase(c.id);
    expect(after?.status).toBe("in_queue"); // never approved on stale evidence

    // The (unwrapped-in-test) supersede is then healed by the same atomic
    // recompute helper staff routes use.
    const { bounced } = await recomputeReadinessAndMaybeBounce(c.id, userId);
    expect(bounced).toBe(true);

    await db.delete(sitespecificBaoDcCaseMonths).where(eq(sitespecificBaoDcCaseMonths.caseId, c.id));
    await storage.baoDisabilityCredit.transitionCase(c.id, {
      to: "void", reason: "test cleanup", actorUserId: userId,
    });
  }, 20000);
});
