import { ReportConfig, ReportColumn, ReportRecord } from '../report.js';
import { storage } from '../../../../storage';

/**
 * Only-One Election Violations report.
 *
 * Scans EVERY worker trust election (current, ended, and future-dated) and
 * flags elections whose selected benefits include more than one benefit from
 * a benefit type currently marked "Only one of this type" (`onlyOne` on the
 * trust-benefit-type option). New enrollment and manual-edit paths enforce
 * this rule, but older elections and intentional carry-forward paths can
 * retain violations — this report is the reliable way to find them.
 *
 * Read-only: one deterministic record per violating election, aggregating
 * all violating types and their conflicting benefits. Never mutates data.
 */
export class ReportElectionsOnlyOneViolations {
  name = 'report_elections_only_one_violations';
  displayName = 'Only-One Election Violations';
  description =
    'Find elections containing more than one benefit from a benefit type marked "Only one of this type"';
  category = 'Trust';

  getPrimaryKeyField(): string {
    return 'electionId';
  }

  getColumns(): ReportColumn[] {
    return [
      { id: 'workerName', header: 'Worker', type: 'string', width: 200 },
      { id: 'employerName', header: 'Employer', type: 'string', width: 200 },
      { id: 'startYmd', header: 'Start Date', type: 'string', width: 110 },
      { id: 'endYmd', header: 'End Date', type: 'string', width: 110 },
      { id: 'violatingTypes', header: 'Violating Types', type: 'string', width: 180 },
      { id: 'conflictingBenefits', header: 'Conflicting Benefits', type: 'string', width: 400 },
      { id: 'electionLink', header: 'Election', type: 'link', width: 120 },
    ];
  }

  async fetchRecords(
    _config: ReportConfig,
    _batchSize: number = 100,
    onProgress?: (progress: { processed: number; total: number }) => void,
  ): Promise<ReportRecord[]> {
    // Current "Only one of this type" settings + benefit type names, keyed
    // by benefit id. The rule is evaluated against TODAY's settings, so an
    // old election violates as soon as the flag is turned on for its type.
    const allBenefits = await storage.trustBenefits.getAllTrustBenefits();
    const benefitById = new Map<string, any>(
      allBenefits.map((b: any) => [b.id, b]),
    );

    // No filters: current, ended, AND future-dated elections all included.
    const elections = await storage.workerTrustElections.searchViews({});
    const total = elections.length;
    const records: ReportRecord[] = [];

    for (let i = 0; i < total; i++) {
      const election = elections[i] as any;
      const benefitIds: string[] = Array.isArray(election.benefitIds)
        ? election.benefitIds
        : [];

      // Group this election's benefits by benefit type, but only for types
      // currently flagged onlyOne.
      const byType = new Map<
        string,
        { typeName: string; benefitNames: string[] }
      >();
      for (const id of benefitIds) {
        const benefit = benefitById.get(id);
        if (!benefit?.benefitTypeOnlyOne || !benefit.benefitType) continue;
        const entry: { typeName: string; benefitNames: string[] } =
          byType.get(benefit.benefitType) ?? {
            typeName: benefit.benefitTypeName ?? 'Unknown type',
            benefitNames: [],
          };
        entry.benefitNames.push(benefit.name ?? id);
        byType.set(benefit.benefitType, entry);
      }

      // Deterministic aggregation: types sorted by name, benefits sorted by
      // name within each type; exactly one row per violating election.
      const violations = Array.from(byType.values())
        .filter((v) => v.benefitNames.length > 1)
        .sort((a, b) => a.typeName.localeCompare(b.typeName));

      if (violations.length > 0) {
        for (const v of violations) v.benefitNames.sort((a, b) => a.localeCompare(b));
        records.push({
          electionId: election.id,
          workerName: election.workerName ?? election.workerId,
          employerName: election.employerName ?? election.employerId,
          startYmd: election.startYmd ?? '',
          endYmd: election.endYmd ?? '',
          violatingTypes: violations.map((v) => v.typeName).join('; '),
          conflictingBenefits: violations
            .map(
              (v) =>
                `${v.typeName} (${v.benefitNames.length}): ${v.benefitNames.join(', ')}`,
            )
            .join('; '),
          electionLink: {
            url: `/trust/election/${election.id}`,
            label: 'View Election',
          },
        });
      }

      if (onProgress) onProgress({ processed: i + 1, total });
    }

    // Deterministic row order regardless of storage ordering.
    records.sort((a, b) => {
      const byWorker = String(a.workerName).localeCompare(String(b.workerName));
      if (byWorker !== 0) return byWorker;
      const byStart = String(a.startYmd).localeCompare(String(b.startYmd));
      if (byStart !== 0) return byStart;
      return String(a.electionId).localeCompare(String(b.electionId));
    });

    return records;
  }
}
