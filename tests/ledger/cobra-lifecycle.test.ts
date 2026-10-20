import { describe, expect, it } from "vitest";
import { decideCobraLifecycle, type CobraLifecycleInput } from "@shared/schema/sitespecific/bao/cobra-lifecycle";
import { computeCobraDeadlines } from "@shared/schema/sitespecific/bao/cobra";
import { baoCobraHelp } from "../../server/help/system/bao-cobra";
import { likePatternMatches } from "../../server/help/path-match";
import { getSystemHelp } from "../../server/help/system";

const base: CobraLifecycleInput = {
  effectiveYmd: "2025-12-01", electedYmd: "2026-01-10",
  initialDeadlineYmd: "2026-02-24", maxPeriodYmd: "2027-06-01",
  todayYmd: "2026-01-20", currentClosed: false,
  months: [
    { ym: "2025-12", caseChargeCents: 10000, paymentCents: 10000 },
    { ym: "2026-01", caseChargeCents: 10000, paymentCents: 10000 },
  ],
};

describe("COBRA lifecycle transition matrix", () => {
  it("moves new → elected pending → enrolled only after all initial months are paid", () => {
    expect(decideCobraLifecycle({ ...base, electedYmd: null }).status).toBe("New");
    const partial = base.months.map((m, i) => ({ ...m, paymentCents: i ? 0 : 10000 }));
    expect(decideCobraLifecycle({ ...base, months: partial })).toMatchObject({
      status: "Pending First Payment", paymentStatus: "grace", initialSatisfied: false,
    });
    expect(decideCobraLifecycle(base)).toMatchObject({ status: "Enrolled", paymentStatus: "paid" });
  });

  it.each([0, 1, 9999])("does not enroll with insufficient qualifying allocation %i", (paymentCents) => {
    expect(decideCobraLifecycle({ ...base, months: base.months.map((m) => ({ ...m, paymentCents })) }).status)
      .toBe("Pending First Payment");
  });

  it("requires every initial month to have real net-positive case premium evidence", () => {
    for (const months of [[], base.months.slice(1), base.months.map((m) => ({ ...m, caseChargeCents: 0 }))]) {
      const result = decideCobraLifecycle({ ...base, months });
      expect(result.blockers.length).toBeGreaterThan(0);
      expect(result.status).toBeUndefined();
      expect(result.paymentStatus).toBeUndefined();
    }
  });

  it("never moves another month's excess allocation to the initial obligation", () => {
    const months = [
      { ym: "2025-12", caseChargeCents: 10000, paymentCents: 0 },
      { ym: "2026-01", caseChargeCents: 10000, paymentCents: 20000 },
      { ym: "2024-12", caseChargeCents: 10000, paymentCents: 900000 },
    ];
    expect(decideCobraLifecycle({ ...base, months }).status).toBe("Pending First Payment");
  });

  it("refuses shared statement-month allocations even when only a closed case competes", () => {
    const result = decideCobraLifecycle({
      ...base,
      months: base.months.map((m) => ({ ...m, hasOtherObligation: m.ym === "2026-01" })),
    });
    expect(result.blockers.join()).toMatch(/attribution is ambiguous in 2026-01/);
    expect(result.status).toBeUndefined();
    expect(result.paymentStatus).toBeUndefined();
  });

  it("includes the first-payment deadline day; never renews old debt's grace", () => {
    const unpaid = base.months.map((m) => ({ ...m, paymentCents: 0 }));
    expect(decideCobraLifecycle({ ...base, months: unpaid, todayYmd: "2026-02-24" }).status).toBe("Pending First Payment");
    for (const todayYmd of ["2026-02-25", "2026-03-01", "2027-01-01"]) {
      expect(decideCobraLifecycle({ ...base, months: unpaid, todayYmd }).status).toBe("Delinquent");
    }
    expect(decideCobraLifecycle({ ...base, todayYmd: "2026-03-01" }).status).toBe("Enrolled");
  });

  it("separates paid initial months from later debt and recovers after payment", () => {
    const months = [...base.months, { ym: "2026-02", caseChargeCents: 10000, paymentCents: 0 }];
    expect(decideCobraLifecycle({ ...base, months, todayYmd: "2026-03-03" })).toMatchObject({
      initialSatisfied: true, status: "Enrolled", paymentStatus: "grace",
    });
    expect(decideCobraLifecycle({ ...base, months, todayYmd: "2026-03-04" }).status).toBe("Delinquent");
    expect(decideCobraLifecycle({ ...base, months: months.map((m) => ({ ...m, paymentCents: 10000 })), todayYmd: "2026-03-04" }).status).toBe("Enrolled");
  });

  it("ages a December obligation across the year boundary", () => {
    const input = {
      ...base, effectiveYmd: "2025-10-01", electedYmd: "2025-10-01",
      initialDeadlineYmd: "2025-11-15",
      months: [
        { ym: "2025-10", caseChargeCents: 10000, paymentCents: 10000 },
        { ym: "2025-12", caseChargeCents: 10000, paymentCents: 0 },
      ],
    };
    expect(decideCobraLifecycle({ ...input, todayYmd: "2025-12-31" }).paymentStatus).toBe("grace");
    expect(decideCobraLifecycle({ ...input, todayYmd: "2026-01-01" }).paymentStatus).toBe("delinquent");
  });

  it("preserves the later-of-initial-and-periodic deadline for later premiums", () => {
    const input = {
      ...base, electedYmd: "2026-01-31", initialDeadlineYmd: "2026-03-17",
      months: [...base.months, { ym: "2026-02", caseChargeCents: 10000, paymentCents: 0 }],
    };
    expect(decideCobraLifecycle({ ...input, todayYmd: "2026-03-17" }).paymentStatus).toBe("grace");
    expect(decideCobraLifecycle({ ...input, todayYmd: "2026-03-18" }).paymentStatus).toBe("delinquent");
  });

  it("never reopens a closed case; maximum-period closure wins over missing evidence", () => {
    expect(decideCobraLifecycle({ ...base, currentClosed: true })).toEqual({ blockers: [] });
    expect(decideCobraLifecycle({ ...base, todayYmd: "2027-06-01" }).status).toBe("Enrolled");
    expect(decideCobraLifecycle({ ...base, months: [], todayYmd: "2027-06-02" }).status).toBe("Closed");
  });

  it("closes restored benefits only before election, without inventing election-expiry closure", () => {
    expect(decideCobraLifecycle({ ...base, electedYmd: null, restoredBenefits: true }).status).toBe("Closed");
    expect(decideCobraLifecycle({ ...base, restoredBenefits: true }).status).toBe("Enrolled");
    expect(decideCobraLifecycle({ ...base, electedYmd: null, todayYmd: "2026-05-01" }).status).toBe("New");
  });

  it("retains central deadline calculations and diagnoses missing initial deadline", () => {
    expect(computeCobraDeadlines("wmb_event", "2025-12-01", "2026-01-10")).toMatchObject({
      lastDayToElectYmd: "2026-01-30", initialPaymentDeadlineYmd: "2026-02-24",
      maxPeriodYmd: "2027-06-01",
    });
    expect(decideCobraLifecycle({ ...base, initialDeadlineYmd: null }).blockers).toContain("Initial payment deadline is missing");
  });
});

describe("COBRA built-in help", () => {
  it("registers sanitized, focused guidance without touching local help", () => {
    const stored = getSystemHelp(baoCobraHelp.id)!;
    expect(stored.source).toBe("system");
    expect(stored.details).toContain("<h3>Status meanings</h3>");
    expect(stored.details).toContain("exactly zero");
    const matches = (path: string) => baoCobraHelp.paths.some((p) => likePatternMatches(p, path));
    for (const path of ["/cobra/cases", "/cobra/cases/a", "/cobra/cases/a/edit", "/workers/w/sitespecific/bao/cobra"]) expect(matches(path)).toBe(true);
    for (const path of ["/cobra/cases-other", "/workers/w/sitespecific/bao/cobra/other", "/workers/w/benefits", "/config/helps", "/config/sitespecific/bao/cobra-rates"]) expect(matches(path)).toBe(false);
  });
});
