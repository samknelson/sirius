import { WizardReport, ReportConfig, ReportColumn, ReportRecord } from '../report.js';
import { storage } from '../../storage';
import { workers, contacts } from '@shared/schema';
import { eq, or, isNull } from 'drizzle-orm';

export class ReportWorkersMissingSSN extends WizardReport {
  name = 'report_workers_missing_ssn';
  displayName = 'Workers Missing SSN';
  description = 'Generate a report of all workers with missing or empty Social Security Numbers';
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
        id: 'email',
        header: 'Email',
        type: 'string',
        width: 200
      },
      {
        id: 'birthDate',
        header: 'Birth Date',
        type: 'date',
        width: 120
      }
    ];
  }

  async fetchRecords(
    config: ReportConfig,
    batchSize: number = 100,
    onProgress?: (progress: { processed: number; total: number }) => void
  ): Promise<ReportRecord[]> {
    const workersWithMissingSSN = await storage.readOnly.query(async (db) => {
      return db
        .select({
          workerId: workers.id,
          siriusId: workers.siriusId,
          displayName: contacts.displayName,
          email: contacts.email,
          birthDate: contacts.birthDate
        })
        .from(workers)
        .innerJoin(contacts, eq(workers.contactId, contacts.id))
        .where(
          or(
            isNull(workers.ssn),
            eq(workers.ssn, '')
          )
        );
    });

    const records: ReportRecord[] = workersWithMissingSSN.map(worker => ({
      workerId: worker.workerId,
      siriusId: worker.siriusId,
      displayName: worker.displayName || '',
      email: worker.email || '',
      birthDate: worker.birthDate || null
    }));

    if (onProgress) {
      onProgress({
        processed: records.length,
        total: records.length
      });
    }

    return records;
  }
}
