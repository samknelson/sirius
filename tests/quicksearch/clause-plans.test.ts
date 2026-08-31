/**
 * A search box that ORs every configured field together turns into a way to
 * enumerate records by typing digits: `008` walks every identifier beginning
 * `008`, `2026` returns every grievance filed this year, and four digits that
 * happen to be someone's last-four confirm an SSN nobody asked about.
 *
 * Each searcher therefore decides which clauses the typed string could
 * plausibly BE and drops the rest. That decision is invisible in the UI — a
 * dropped clause looks exactly like "nothing matched" — so it is pinned here.
 */
import { describe, expect, it } from "vitest";

import { planWorkerSearch } from "../../server/plugins/quicksearch/plugins/worker";
import { planGrievanceSearch } from "../../server/plugins/quicksearch/plugins/grievance";
import { planEdlsSheetSearch } from "../../server/plugins/quicksearch/plugins/edls-sheet";

const ID_TYPES = { idTypeIds: ["type-a", "type-b"] };

describe("worker search clauses", () => {
  it("always matches on name", () => {
    expect(planWorkerSearch("smith", {}).name).toBe("smith");
    expect(planWorkerSearch("  smith  ", {}).name).toBe("smith");
  });

  it("treats an all-digit input as a worker number", () => {
    expect(planWorkerSearch("4172", {}).siriusId).toBe(4172);
  });

  it("does not treat a mixed string as a worker number", () => {
    expect(planWorkerSearch("41a72", {}).siriusId).toBeNull();
    expect(planWorkerSearch("417-2", {}).siriusId).toBeNull();
  });

  it("drops the identifier clause when no id type is configured", () => {
    expect(planWorkerSearch("A-100", {}).workerIdValue).toBeNull();
  });

  it("matches an identifier exactly, never as a prefix", () => {
    const plan = planWorkerSearch("A-100", ID_TYPES);
    expect(plan.workerIdValue).toBe("A-100");
    expect(plan.workerIdTypeIds).toEqual(["type-a", "type-b"]);
  });

  it("ignores an id type list that is not a list of ids", () => {
    expect(planWorkerSearch("A-100", { idTypeIds: "type-a" }).workerIdValue).toBeNull();
    expect(planWorkerSearch("A-100", { idTypeIds: [1, null] as any }).workerIdValue).toBeNull();
  });

  describe("phone", () => {
    it("is dropped entirely when the option is off", () => {
      expect(planWorkerSearch("5551234", { searchPhone: false }).phoneDigits).toBeNull();
    });

    it("needs enough digits to be a phone number", () => {
      expect(planWorkerSearch("555123", { searchPhone: true }).phoneDigits).toBeNull();
      expect(planWorkerSearch("5551234", { searchPhone: true }).phoneDigits).toBe("5551234");
    });

    it("ignores formatting on the way in", () => {
      expect(planWorkerSearch("(212) 555-1234", { searchPhone: true }).phoneDigits).toBe(
        "2125551234",
      );
    });
  });

  describe("SSN", () => {
    it("is dropped entirely when the option is off", () => {
      // The runner forces this off for a user without the permission, so the
      // permission check and this branch are the same code path.
      expect(planWorkerSearch("123456789", { searchSsn: false }).ssn).toBeNull();
    });

    it("matches a full nine digits", () => {
      expect(planWorkerSearch("123456789", { searchSsn: true }).ssn).toEqual({
        mode: "full",
        digits: "123456789",
      });
    });

    it("matches a last-four", () => {
      expect(planWorkerSearch("6789", { searchSsn: true }).ssn).toEqual({
        mode: "last4",
        digits: "6789",
      });
    });

    it("ignores formatting", () => {
      expect(planWorkerSearch("123-45-6789", { searchSsn: true }).ssn).toEqual({
        mode: "full",
        digits: "123456789",
      });
    });

    it("drops any other digit count — a partial SSN is not an SSN", () => {
      for (const partial of ["008", "12345", "12345678", "1234567890"]) {
        expect(planWorkerSearch(partial, { searchSsn: true }).ssn).toBeNull();
      }
    });
  });
});

describe("grievance search clauses", () => {
  it("always matches on class description and worker name", () => {
    const plan = planGrievanceSearch("overtime");
    expect(plan.classDescription).toBe("overtime");
    expect(plan.workerName).toBe("overtime");
  });

  it("drops the number clause for a short numeric string", () => {
    // A grievance number starts with the filing date, so "2026" is a year far
    // more often than it is the start of an identifier.
    expect(planGrievanceSearch("2026").siriusId).toBeNull();
    expect(planGrievanceSearch("202604").siriusId).toBeNull();
  });

  it("matches the whole number once the input is long enough to be one", () => {
    expect(planGrievanceSearch("20260426-1").siriusId).toBe("20260426-1");
  });

  it("trims before deciding", () => {
    expect(planGrievanceSearch("  20260426-1 ").siriusId).toBe("20260426-1");
  });
});

describe("EDLS sheet search clauses", () => {
  it("always matches on sheet title and worker name", () => {
    const plan = planEdlsSheetSearch("  loadout  ", {});
    expect(plan.title).toBe("loadout");
    expect(plan.workerName).toBe("loadout");
  });

  it("drops the identifier clause when no id type is configured", () => {
    const plan = planEdlsSheetSearch("A-100", {});
    expect(plan.workerIdValue).toBeNull();
    expect(plan.workerIdTypeIds).toEqual([]);
  });

  it("matches an identifier exactly, never as a prefix", () => {
    const plan = planEdlsSheetSearch("A-100", ID_TYPES);
    expect(plan.workerIdValue).toBe("A-100");
    expect(plan.workerIdTypeIds).toEqual(["type-a", "type-b"]);
  });

  it("ignores an id type list that is not a list of ids", () => {
    expect(planEdlsSheetSearch("A-100", { idTypeIds: "type-a" }).workerIdValue).toBeNull();
    expect(planEdlsSheetSearch("A-100", { idTypeIds: [1, null] as any }).workerIdValue).toBeNull();
  });
});
