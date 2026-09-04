import type { BaoDpTierTransition } from "@shared/schema/sitespecific/bao/schema";

/**
 * Confirmed 1/1/2026 Domestic Partner MONTHLY MEMBER CHARGES (Kristin's rate
 * sheet, attached_assets/Domestic_Partner_Rates_2026_*.xlsx).
 *
 * The workbook has two dollar columns per plan/transition. Only the
 * "Monthly Member Charge" column — what the Fund collects from the member
 * (the 48% tax on imputed income it pays on the member's behalf) — is stored
 * and billed. The "Imputed Income (NOT charged to member)" column is never
 * stored, never billed, never shown as an amount owed.
 *
 * "Family → Family" (member already has two or more children and adds a DP,
 * with or without the DP's children) is CONFIRMED NO CHARGE for all plans:
 * a $0.00 rate with provisional=false. Billing posts nothing for those
 * months and the DP payment gate does not require a payment.
 */
export const DP_RATES_2026_EFFECTIVE_YMD = "2026-01-01";

export interface DpSeedRate {
  rate: string;
  provisional: boolean;
}

/** Confirmed no-charge rate for the family → family-with-DP rows. */
export const DP_NO_CHARGE: DpSeedRate = { rate: "0.00", provisional: false };

/** Benefit name → monthly MEMBER CHARGE by tier transition. */
export const DP_RATES_2026: Record<
  string,
  Record<BaoDpTierTransition, DpSeedRate>
> = {
  // Single → Single +1 | Single +1 → Family | Single → Family | Family → Family
  Kaiser: {
    single_to_2party: { rate: "405.00", provisional: false },
    "2party_to_family": { rate: "335.12", provisional: false },
    single_to_family: { rate: "740.12", provisional: false },
    family_to_family_dp: DP_NO_CHARGE,
  },
  "Health Net": {
    single_to_2party: { rate: "291.62", provisional: false },
    "2party_to_family": { rate: "206.44", provisional: false },
    single_to_family: { rate: "498.06", provisional: false },
    family_to_family_dp: DP_NO_CHARGE,
  },
  MLK: {
    single_to_2party: { rate: "85.21", provisional: false },
    "2party_to_family": { rate: "69.58", provisional: false },
    single_to_family: { rate: "154.80", provisional: false },
    family_to_family_dp: DP_NO_CHARGE,
  },
};

/** The slice of storage the 2026 rate sync needs. */
export interface DpRateSyncStorage {
  trustBenefits: {
    getAllTrustBenefits(): Promise<Array<{ id: string; name: string }>>;
  };
  baoDpRates: {
    list(filters: { benefitId?: string }): Promise<
      Array<{
        id: string;
        tierTransition: string;
        rate: string;
        effectiveYmd: string;
        provisional: boolean;
      }>
    >;
    create(entry: {
      benefitId: string;
      tierTransition: BaoDpTierTransition;
      rate: string;
      effectiveYmd: string;
      provisional: boolean;
    }): Promise<unknown>;
    update(
      id: string,
      record: { rate: string; provisional: boolean },
    ): Promise<unknown>;
  };
}

export interface DpRateSyncResult {
  created: number;
  updated: number;
  unchanged: number;
  changes: string[];
}

/**
 * Idempotently bring the (benefit, transition, 2026-01-01) rows in line with
 * DP_RATES_2026: create missing rows, correct rows whose rate or provisional
 * flag differs, leave matching rows untouched. Rerunning never duplicates
 * or churns rows. Benefits are matched by exact trimmed name; a missing
 * benefit aborts before any write.
 */
export async function syncDpRates2026(
  storage: DpRateSyncStorage,
  rateTable: typeof DP_RATES_2026 = DP_RATES_2026,
  effectiveYmd: string = DP_RATES_2026_EFFECTIVE_YMD,
): Promise<DpRateSyncResult> {
  const benefits = await storage.trustBenefits.getAllTrustBenefits();
  const byName = new Map<string, string>(
    benefits.map((b) => [String(b.name).trim(), String(b.id)]),
  );

  const missing = Object.keys(rateTable).filter((name) => !byName.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Benefits not found by name: ${missing.join(", ")}. ` +
        `Available: ${benefits.map((b) => b.name).join(", ")}`,
    );
  }

  const result: DpRateSyncResult = {
    created: 0,
    updated: 0,
    unchanged: 0,
    changes: [],
  };

  for (const [name, transitions] of Object.entries(rateTable)) {
    const benefitId = byName.get(name)!;
    const existing = await storage.baoDpRates.list({ benefitId });
    for (const [transition, { rate, provisional }] of Object.entries(
      transitions,
    ) as [BaoDpTierTransition, DpSeedRate][]) {
      const match = existing.find(
        (r) =>
          r.tierTransition === transition &&
          String(r.effectiveYmd).slice(0, 10) === effectiveYmd,
      );
      if (match) {
        if (
          Number(match.rate) === Number(rate) &&
          match.provisional === provisional
        ) {
          result.unchanged++;
          continue;
        }
        await storage.baoDpRates.update(match.id, { rate, provisional });
        result.changes.push(
          `Updated ${name} ${transition}: ${match.rate} (provisional ${match.provisional}) -> ${rate} (provisional ${provisional})`,
        );
        result.updated++;
        continue;
      }
      await storage.baoDpRates.create({
        benefitId,
        tierTransition: transition,
        rate,
        effectiveYmd,
        provisional,
      });
      result.changes.push(
        `Created ${name} ${transition}: ${rate} (provisional ${provisional})`,
      );
      result.created++;
    }
  }
  return result;
}
