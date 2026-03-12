import { WizardReport, ReportConfig, ReportColumn, ReportRecord } from '../report.js';
import { storage } from '../../storage';
import { workers, contacts } from '@shared/schema';
import { eq, and, isNotNull, ne } from 'drizzle-orm';
import { validateSSN } from '@shared/utils/ssn';

export class ReportWorkersInvalidSSN extends WizardReport {
  name = 'report_workers_invalid_ssn';
  displayName = 'Workers with Invalid SSN';
  description = 'Generate a report of all workers with invalid Social Security Numbers (fails SSA validation rules)';
  category = 'Workers';

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
    const workersWithSSN = await storage.readOnly.query(async (db) => {
      return db
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
    });

    const records: ReportRecord[] = [];
    const total = workersWithSSN.length;

    for (let i = 0; i < total; i++) {
      const worker = workersWithSSN[i];
      const validation = validateSSN(worker.ssn!);
      
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

      if (onProgress && (i + 1) % batchSize === 0) {
        onProgress({
          processed: i + 1,
          total
        });
      }
    }

    if (onProgress) {
      onProgress({
        processed: total,
        total
      });
    }

    return records;
  }
}
