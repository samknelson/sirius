import { WizardReport, ReportConfig, ReportColumn, ReportRecord } from '../report.js';

export class ReportWorkersDuplicateSSN extends WizardReport {
  name = 'report_workers_duplicate_ssn';
  displayName = 'Workers with Duplicate SSN';
  description = 'Generate a report of workers whose Social Security Numbers are duplicated';

  getColumns(): ReportColumn[] {
    return [
      {
        id: 'ssn',
        header: 'SSN',
        type: 'string',
        width: 130
      },
      {
        id: 'duplicateCount',
        header: 'Duplicate Count',
        type: 'number',
        width: 150
      },
      {
        id: 'siriusId',
        header: 'Sirius ID',
        type: 'number',
        width: 120
      },
      {
        id: 'displayName',
        header: 'Name',
        type: 'string',
        width: 250
      },
      {
        id: 'email',
        header: 'Email',
        type: 'string',
        width: 200
      }
    ];
  }

  async fetchRecords(
    config: ReportConfig,
    batchSize: number = 100,
    onProgress?: (progress: { processed: number; total: number }) => void
  ): Promise<ReportRecord[]> {
    const { db } = await import('../../db.js');
    const { workers, contacts } = await import('@shared/schema');
    const { eq, and, isNotNull, ne, sql, inArray } = await import('drizzle-orm');

    // First, find all SSNs that appear more than once
    const duplicateSSNs = await db
      .select({
        ssn: workers.ssn,
        count: sql<number>`count(*)::int`
      })
      .from(workers)
      .where(
        and(
          isNotNull(workers.ssn),
          ne(workers.ssn, '')
        )
      )
      .groupBy(workers.ssn)
      .having(sql`count(*) > 1`);

    if (duplicateSSNs.length === 0) {
      return [];
    }

    // Create a map of SSN -> count for quick lookup
    const ssnCountMap = new Map(
      duplicateSSNs.map(({ ssn, count }) => [ssn!, count])
    );

    // Fetch all workers that have duplicate SSNs
    const duplicateSSNValues = duplicateSSNs.map(d => d.ssn!);
    const workersWithDuplicateSSN = await db
      .select({
        workerId: workers.id,
        siriusId: workers.siriusId,
        ssn: workers.ssn,
        displayName: contacts.displayName,
        email: contacts.email
      })
      .from(workers)
      .innerJoin(contacts, eq(workers.contactId, contacts.id))
      .where(inArray(workers.ssn, duplicateSSNValues))
      .orderBy(workers.ssn, workers.siriusId);

    // Create one record per worker, including the duplicate count
    const records: ReportRecord[] = workersWithDuplicateSSN.map((worker, index) => {
      if (onProgress && index % 10 === 0) {
        onProgress({
          processed: index,
          total: workersWithDuplicateSSN.length
        });
      }

      return {
        workerId: worker.workerId,
        ssn: worker.ssn!,
        duplicateCount: ssnCountMap.get(worker.ssn!) || 0,
        siriusId: worker.siriusId,
        displayName: worker.displayName || '',
        email: worker.email || ''
      };
    });

    if (onProgress) {
      onProgress({
        processed: records.length,
        total: records.length
      });
    }

    return records;
  }
}
