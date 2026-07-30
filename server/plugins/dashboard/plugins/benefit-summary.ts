import { registerDashboardPlugin } from "../registry";
import { createUnifiedOptionsStorage } from "../../../storage/unified-options";
import type { JsonSchema } from "@shared/json-schema-form";
import type { DashboardPlugin } from "../types";

const unifiedOptionsStorage = createUnifiedOptionsStorage();

interface BenefitSummarySettings {
  benefitTypeIds?: string[];
  /** Legacy shape (pre benefit-type rework): individual benefit ids. */
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

/** Per-benefit detail within a benefit type group. */
export interface BenefitSummaryBenefitRow {
  benefitId: string;
  benefitName: string;
  /** Active coverage counts for this benefit, keyed by month key. */
  counts: Record<"last" | "current" | "next", number>;
  /** Distinct workers with a "terminate" event this month for this benefit. */
  lostThisMonth: number;
}

export interface BenefitSummaryGroup {
  benefitTypeId: string;
  benefitTypeName: string;
  /** Type totals: coverage counts summed across the type's benefits. */
  counts: Record<"last" | "current" | "next", number>;
  /** Type total of lostThisMonth across the type's benefits. */
  lostThisMonth: number;
  /** Per-benefit breakdown for every active benefit of this type. */
  benefits: BenefitSummaryBenefitRow[];
}

export interface BenefitSummaryContent {
  months: BenefitSummaryMonth[];
  groups: BenefitSummaryGroup[];
  /** True when the config has at least one benefit type selected (directly
   * or derived from legacy per-benefit settings). Lets the client
   * distinguish "nothing selected" from "selected types have no active
   * benefits". */
  configured: boolean;
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
 * Dynamic settings schema: multi-select over the trust benefit TYPES
 * (Medical, Dental, ...) so admins pick categories, not individual benefits.
 *
 * Options are expressed as `anyOf` single-value-enum subschemas with titles
 * (not `enum` + `enumNames`) so the RJSF multi-select renders readable
 * labels instead of raw ids.
 */
async function buildSchema(): Promise<JsonSchema> {
  const types = (await unifiedOptionsStorage.list("trust-benefit-type")) as Array<{
    id: string;
    name: string;
  }>;
  return {
    type: "object",
    title: "Benefit Summary",
    description:
      "Pick the benefit types to summarize. The widget shows active coverage counts for last / this / next month and how many workers lost each benefit of those types this month.",
    properties: {
      benefitTypeIds: {
        type: "array",
        title: "Benefit types",
        description: "Benefit types included in the summary",
        uniqueItems: true,
        items: {
          type: "string",
          anyOf: types.map((t) => ({
            type: "string",
            enum: [t.id],
            title: t.name || t.id,
          })),
        } as JsonSchema,
      },
    },
  };
}

export const benefitSummaryPlugin: DashboardPlugin = {
  id: "benefit-summary",
  name: "Benefit Summary",
  description:
    "At-a-glance active coverage counts (last / this / next month) and losses this month for selected benefit types",
  requiredComponent: "trust.benefits",
  settingsSchema: buildSchema,
  defaultSettings: { benefitTypeIds: [] },

  async content(ctx): Promise<BenefitSummaryContent> {
    const settings = (ctx.settings ?? {}) as BenefitSummarySettings;
    let requestedTypeIds = Array.isArray(settings.benefitTypeIds)
      ? settings.benefitTypeIds.filter((id): id is string => typeof id === "string")
      : [];

    const months = buildMonths(new Date());

    const allBenefits = (await ctx.storage.trustBenefits.getAllTrustBenefits()) as Array<{
      id: string;
      name: string | null;
      benefitType: string | null;
      benefitTypeName: string | null;
      benefitTypeSequence: number | null;
      isActive: boolean;
    }>;

    // Legacy configs (pre benefit-type rework) stored individual benefit
    // ids. Derive the corresponding types on read so old configs keep
    // rendering until they are re-saved.
    if (requestedTypeIds.length === 0 && Array.isArray(settings.benefitIds)) {
      const legacyIds = new Set(
        settings.benefitIds.filter((id): id is string => typeof id === "string"),
      );
      requestedTypeIds = Array.from(
        new Set(
          allBenefits
            .filter((b) => legacyIds.has(b.id) && b.benefitType)
            .map((b) => b.benefitType as string),
        ),
      );
    }

    if (requestedTypeIds.length === 0) return { months, groups: [], configured: false };

    // Expand types -> active benefits of those types.
    const selectedTypes = new Set(requestedTypeIds);
    const benefits = allBenefits.filter(
      (b) => b.isActive && b.benefitType && selectedTypes.has(b.benefitType),
    );
    if (benefits.length === 0) return { months, groups: [], configured: true };
    const benefitIds = benefits.map((b) => b.id);

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

    // Group by benefit type: every active benefit of the type gets its own
    // row (month counts + lost this month); the group carries type totals.
    const groupsByType = new Map<string, BenefitSummaryGroup & { sequence: number }>();
    for (const b of benefits) {
      const typeId = b.benefitType!;
      let group = groupsByType.get(typeId);
      if (!group) {
        group = {
          benefitTypeId: typeId,
          benefitTypeName: b.benefitTypeName || typeId,
          counts: { last: 0, current: 0, next: 0 },
          lostThisMonth: 0,
          benefits: [],
          sequence: b.benefitTypeSequence ?? Number.MAX_SAFE_INTEGER,
        };
        groupsByType.set(typeId, group);
      }
      const row: BenefitSummaryBenefitRow = {
        benefitId: b.id,
        benefitName: b.name || b.id,
        counts: { last: 0, current: 0, next: 0 },
        lostThisMonth: lostByBenefit.get(b.id) ?? 0,
      };
      for (const m of months) {
        const count = coverageByKey.get(`${b.id}:${m.year}:${m.month}`) ?? 0;
        row.counts[m.key] = count;
        group.counts[m.key] += count;
      }
      group.lostThisMonth += row.lostThisMonth;
      group.benefits.push(row);
    }

    const groups = Array.from(groupsByType.values())
      .sort(
        (a, b) =>
          a.sequence - b.sequence || a.benefitTypeName.localeCompare(b.benefitTypeName),
      )
      .map(({ sequence: _sequence, ...group }) => ({
        ...group,
        benefits: group.benefits.sort((a, b) => a.benefitName.localeCompare(b.benefitName)),
      }));

    return { months, groups, configured: true };
  },

  client: {
    component: "benefit-summary:BenefitSummary",
    order: 6,
    enabledByDefault: false,
  },
};

registerDashboardPlugin(benefitSummaryPlugin);
