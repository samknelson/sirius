import { WizardReport, ReportConfig, ReportColumn, ReportRecord } from '../report.js';
import { storage } from '../../storage/index.js';

export class ReportWorkersMissingSSN extends WizardReport {
  name = 'report_workers_missing_ssn';
  displayName = 'Workers Missing SSN';
  description = 'Generate a report of all workers with missing or empty Social Security Numbers';

  getColumns(): ReportColumn[] {
    return [
      {
        id: 'siriusId',
        name: 'Sirius ID',
        type: 'number',
        width: 120
      },
      {
        id: 'displayName',
        name: 'Name',
        type: 'string',
        width: 250
      },
      {
        id: 'email',
        name: 'Email',
        type: 'string',
        width: 200
      },
      {
        id: 'birthDate',
        name: 'Birth Date',
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
    // Use database query with JOIN to fetch workers and contacts efficiently
    const { db } = await import('../../db.js');
    const { workers, contacts } = await import('@shared/schema');
    const { eq, or, isNull } = await import('drizzle-orm');

    // Query workers with missing SSN, joining with contacts table
    const workersWithMissingSSN = await db
      .select({
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

    const records: ReportRecord[] = workersWithMissingSSN.map(worker => ({
      siriusId: worker.siriusId,
      displayName: worker.displayName || '',
      email: worker.email || '',
      birthDate: worker.birthDate || null
    }));

    // Report progress
    if (onProgress) {
      onProgress({
        processed: records.length,
        total: records.length
      });
    }

    return records;
  }
}
