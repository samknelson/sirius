import { WizardReport, ReportConfig, ReportColumn, ReportRecord } from '../report.js';

export class ReportWorkersDuplicateSSN extends WizardReport {
  name = 'report_workers_duplicate_ssn';
  displayName = 'Workers with Duplicate SSN';
  description = 'Generate a report of Social Security Numbers that are associated with more than one worker';

  /**
   * Override to use SSN as the primary key instead of workerId
   */
  getPrimaryKeyField(): string {
    return 'ssn';
  }

  getColumns(): ReportColumn[] {
    return [
      {
        id: 'ssn',
        header: 'SSN',
        type: 'string',
        width: 130
      },
      {
        id: 'workerCount',
        header: 'Worker Count',
        type: 'number',
        width: 120
      },
      {
        id: 'workers',
        header: 'Workers',
        type: 'string',
        width: 400
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

    const records: ReportRecord[] = [];
    const total = duplicateSSNs.length;

    // For each duplicate SSN, fetch all workers with that SSN and create one record
    for (let i = 0; i < total; i++) {
      const { ssn, count } = duplicateSSNs[i];

      // Fetch all workers with this SSN
      const workersWithSSN = await db
        .select({
          workerId: workers.id,
          siriusId: workers.siriusId,
          displayName: contacts.displayName
        })
        .from(workers)
        .innerJoin(contacts, eq(workers.contactId, contacts.id))
        .where(eq(workers.ssn, ssn!));

      // Create one record per SSN with embedded worker details
      records.push({
        ssn: ssn!,
        workerCount: count,
        workers: workersWithSSN.map(w => `${w.displayName} (ID: ${w.siriusId})`).join(', '),
        workerIds: workersWithSSN.map(w => w.workerId), // For linking
        workerDetails: workersWithSSN // For frontend rendering with links
      });

      if (onProgress) {
        onProgress({
          processed: i + 1,
          total
        });
      }
    }

    return records;
  }
}
