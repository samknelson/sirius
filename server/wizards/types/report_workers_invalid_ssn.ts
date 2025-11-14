import { WizardReport, ReportConfig, ReportColumn, ReportRecord } from '../report.js';
import { storage } from '../../storage/index.js';
import { validateSSN } from '@shared/utils/ssn';

export class ReportWorkersInvalidSSN extends WizardReport {
  name = 'report_workers_invalid_ssn';
  displayName = 'Workers with Invalid SSN';
  description = 'Generate a report of all workers with invalid Social Security Numbers (fails SSA validation rules)';

  getColumns(): ReportColumn[] {
    return [
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
        id: 'ssn',
        header: 'SSN',
        type: 'string',
        width: 130
      },
      {
        id: 'validationError',
        header: 'Validation Error',
        type: 'string',
        width: 300
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
    // Use database query with JOIN to fetch workers and contacts efficiently
    const { db } = await import('../../db.js');
    const { workers, contacts } = await import('@shared/schema');
    const { eq, and, isNotNull, ne } = await import('drizzle-orm');

    // Query workers with non-empty SSN, joining with contacts table
    const workersWithSSN = await db
      .select({
        workerId: workers.id,
        siriusId: workers.siriusId,
        ssn: workers.ssn,
        displayName: contacts.displayName,
        email: contacts.email
      })
      .from(workers)
      .innerJoin(contacts, eq(workers.contactId, contacts.id))
      .where(
        and(
          isNotNull(workers.ssn),
          ne(workers.ssn, '')
        )
      );

    const records: ReportRecord[] = [];
    const total = workersWithSSN.length;

    // Validate SSNs and filter invalid ones
    for (let i = 0; i < total; i++) {
      const worker = workersWithSSN[i];
      const validation = validateSSN(worker.ssn!);
      
      // Only include workers with invalid SSNs
      if (!validation.valid) {
        records.push({
          workerId: worker.workerId,
          siriusId: worker.siriusId,
          displayName: worker.displayName || '',
          ssn: worker.ssn,
          validationError: validation.error || 'Unknown validation error',
          email: worker.email || ''
        });
      }

      // Report progress periodically
      if (onProgress && (i + 1) % batchSize === 0) {
        onProgress({
          processed: i + 1,
          total
        });
      }
    }

    // Final progress update
    if (onProgress) {
      onProgress({
        processed: total,
        total
      });
    }

    return records;
  }
}
