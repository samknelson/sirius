/**
 * Extensible population resolvers for the scheduled benefit-scan sweep.
 *
 * A resolver maps (population type, coverage month C) → the set of worker ids
 * to enqueue for a scan of C. Resolution is strictly a function of the
 * COVERAGE month, never the run date:
 *
 * - `active_elections`       → workers with an active trust election in C.
 * - `previous_month_benefit` → workers who had a benefit (WMB row) in C-1.
 * - `all_workers`            → every worker (coverage-month independent).
 *
 * Registry-style so future sweep populations plug in without touching the
 * schedule / coverage-month code.
 */
import type { IStorage } from "../storage";
import { addCoverageMonths, type CoverageMonthRef } from "./benefit-scan-schedule";

export interface ScanPopulationResolver {
  id: string;
  label: string;
  /** Resolve the worker ids to scan for coverage month `coverage`. */
  resolve(storage: IStorage, coverage: CoverageMonthRef): Promise<string[]>;
}

const resolvers = new Map<string, ScanPopulationResolver>();

export function registerScanPopulationResolver(resolver: ScanPopulationResolver): void {
  resolvers.set(resolver.id, resolver);
}

export function getScanPopulationResolver(id: string): ScanPopulationResolver | undefined {
  return resolvers.get(id);
}

export function listScanPopulationTypes(): { id: string; label: string }[] {
  return Array.from(resolvers.values()).map(({ id, label }) => ({ id, label }));
}

registerScanPopulationResolver({
  id: "active_elections",
  label: "Workers with an active election in the coverage month",
  resolve: (storage, coverage) =>
    storage.wmbScanQueue.getWorkerIdsWithActiveElectionInMonth(coverage.month, coverage.year),
});

registerScanPopulationResolver({
  id: "previous_month_benefit",
  label: "Workers with a benefit in the month before the coverage month",
  resolve: (storage, coverage) => {
    const prev = addCoverageMonths(coverage, -1);
    return storage.wmbScanQueue.getWorkerIdsWithBenefitInMonth(prev.month, prev.year);
  },
});

registerScanPopulationResolver({
  id: "all_workers",
  label: "All workers",
  resolve: (storage) => storage.wmbScanQueue.getAllWorkerIds(),
});
