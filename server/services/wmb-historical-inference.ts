import type { WorkerBenefitCoverage } from "../storage/trust/wmb-events";

export interface HistoricalEvent {
  eventType: "start" | "restart" | "terminate";
  benefitId: string;
  year: number;
  month: number;
}

/** Inclusive month key; no Date/timezone conversions are needed. */
export function monthKey(year: number, month: number): number {
  return year * 12 + month;
}

function fromKey(key: number): { year: number; month: number } {
  const month = (key - 1) % 12 + 1;
  return { year: (key - month) / 12, month };
}

export function inferHistoricalEvents(coverage: WorkerBenefitCoverage[], cutoff: number): HistoricalEvent[] {
  const byBenefit = new Map<string, Set<number>>();
  for (const row of coverage) {
    if (row.month < 1 || row.month > 12) throw new Error(`Invalid WMB month: ${row.month}`);
    let months = byBenefit.get(row.benefitId);
    if (!months) byBenefit.set(row.benefitId, months = new Set());
    months.add(monthKey(row.year, row.month));
  }
  const events: HistoricalEvent[] = [];
  for (const [benefitId, months] of byBenefit) {
    const ordered = [...months].sort((a, b) => a - b);
    for (const [index, key] of ordered.entries()) {
      if (key > cutoff) continue;
      if (index === 0) events.push({ benefitId, ...fromKey(key), eventType: "start" });
      if (!months.has(key - 1)) events.push({ benefitId, ...fromKey(key), eventType: "restart" });
      // Only the first missing month after a run, not every missing month.
      if (key + 1 <= cutoff && !months.has(key + 1)) {
        events.push({ benefitId, ...fromKey(key + 1), eventType: "terminate" });
      }
    }
  }
  return events;
}