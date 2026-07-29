import { registerDashboardPlugin } from "../registry";
import { storage } from "../../../storage";
import type { JsonSchema } from "@shared/json-schema-form";
import type { DashboardPlugin } from "../types";
import type { TrustBenefit } from "@shared/schema";

interface BenefitSummarySettings {
  benefitIds?: string[];
}

/** One month column in the widget. */
export interface BenefitSummaryMonth {
  month: number;
  year: number;
  /** "last" | "current" | "next" relative to today. */
  key: "last" | "current" | "next";
  label: string;
}

export interface BenefitSummaryRow {
  benefitId: string;
  benefitName: string;
  /** Distinct workers with coverage, keyed by month key. */
  counts: Record<"last" | "current" | "next", number>;
  /** Distinct workers with a "terminate" event this month. */
  lostThisMonth: number;
}

export interface BenefitSummaryContent {
  months: BenefitSummaryMonth[];
  rows: BenefitSummaryRow[];
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function shiftMonth(month: number, year: number, delta: number): { month: number; year: number } {
  const idx = year * 12 + (month - 1) + delta;
  return { month: (idx % 12) + 1, year: Math.floor(idx / 12) };
}

function buildMonths(now: Date): BenefitSummaryMonth[] {
  const cur = { month: now.getMonth() + 1, year: now.getFullYear() };
  const last = shiftMonth(cur.month, cur.year, -1);
  const next = shiftMonth(cur.month, cur.year, 1);
  const label = (m: { month: number; year: number }) => `${MONTH_NAMES[m.month - 1]} ${m.year}`;
  return [
    { ...last, key: "last", label: label(last) },
    { ...cur, key: "current", label: label(cur) },
    { ...next, key: "next", label: label(next) },
  ];
}

/**
 * Dynamic settings schema: multi-select over the active trust benefits so
 * admins pick which benefit types the widget summarizes.
 */
async function buildSchema(): Promise<JsonSchema> {
  const benefits = (await storage.trustBenefits.getAllTrustBenefits()) as TrustBenefit[];
  const active = benefits
    .filter((b) => b.isActive)
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  return {
    type: "object",
    title: "Benefit Summary",
    description:
      "Pick the benefits to summarize. The widget shows active coverage counts for last / this / next month and how many workers lost each benefit this month.",
    properties: {
      benefitIds: {
        type: "array",
        title: "Benefits",
        description: "Benefits included in the summary",
        uniqueItems: true,
        items: {
          type: "string",
          enum: active.map((b) => b.id),
          enumNames: active.map((b) => b.name || b.id),
        } as any,
      },
    },
  };
}

export const benefitSummaryPlugin: DashboardPlugin = {
  id: "benefit-summary",
  name: "Benefit Summary",
  description:
    "At-a-glance active coverage counts (last / this / next month) and losses this month for selected benefits",
  requiredComponent: "trust.benefits",
  settingsSchema: buildSchema,
  defaultSettings: { benefitIds: [] },

  async content(ctx): Promise<BenefitSummaryContent> {
    const settings = (ctx.settings ?? {}) as BenefitSummarySettings;
    const requestedIds = Array.isArray(settings.benefitIds)
      ? settings.benefitIds.filter((id): id is string => typeof id === "string")
      : [];

    const months = buildMonths(new Date());
    if (requestedIds.length === 0) return { months, rows: [] };

    // Resolve names and drop ids that no longer exist (deleted benefits).
    const allBenefits = (await ctx.storage.trustBenefits.getAllTrustBenefits()) as TrustBenefit[];
    const benefitById = new Map(allBenefits.map((b) => [b.id, b]));
    const benefitIds = requestedIds.filter((id) => benefitById.has(id));
    if (benefitIds.length === 0) return { months, rows: [] };

    const current = months.find((m) => m.key === "current")!;

    const [coverageCounts, lostCounts] = await Promise.all([
      ctx.storage.trust.wmb.countWorkersByBenefitForMonths(
        benefitIds,
        months.map((m) => ({ month: m.month, year: m.year })),
      ),
      // "Lost this month" reads the recorded coverage "terminate" events for
      // the current month — NOT a last-month vs this-month diff.
      ctx.storage.trustWmbEvents.countWorkersByBenefitForMonth(
        benefitIds,
        "terminate",
        current.month,
        current.year,
      ),
    ]);

    const coverageByKey = new Map<string, number>();
    for (const c of coverageCounts) {
      coverageByKey.set(`${c.benefitId}:${c.year}:${c.month}`, c.workerCount);
    }
    const lostByBenefit = new Map(lostCounts.map((l) => [l.benefitId, l.workerCount]));

    const rows: BenefitSummaryRow[] = benefitIds.map((benefitId) => {
      const counts = { last: 0, current: 0, next: 0 } as BenefitSummaryRow["counts"];
      for (const m of months) {
        counts[m.key] = coverageByKey.get(`${benefitId}:${m.year}:${m.month}`) ?? 0;
      }
      return {
        benefitId,
        benefitName: benefitById.get(benefitId)?.name || benefitId,
        counts,
        lostThisMonth: lostByBenefit.get(benefitId) ?? 0,
      };
    });
    rows.sort((a, b) => a.benefitName.localeCompare(b.benefitName));

    return { months, rows };
  },

  client: {
    component: "benefit-summary:BenefitSummary",
    order: 6,
    enabledByDefault: false,
  },
};

registerDashboardPlugin(benefitSummaryPlugin);
