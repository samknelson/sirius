import { BaseWizard, WizardStep, WizardStatus, createStandardStatuses } from './base.js';
import { storage } from '../storage/index.js';

export interface ReportConfig {
  filters?: Record<string, any>;
  dateRange?: {
    start: Date;
    end: Date;
  };
}

export interface ReportMeta {
  generatedAt: string; // ISO string
  recordCount: number;
  columns: ReportColumn[];
  primaryKeyField?: string; // Field name used as primary key (e.g., 'workerId', 'ssn')
}

export interface ReportData {
  config?: ReportConfig;
  reportMeta?: ReportMeta; // Metadata from last report generation
  recordCount?: number; // Deprecated: maintained for backward compatibility, use reportMeta.recordCount
  generatedAt?: string; // Deprecated: maintained for backward compatibility (ISO string), use reportMeta.generatedAt
  reportDataId?: string; // Reference to wizard_report_data entry
  progress?: {
    [key: string]: {
      status: string;
      completedAt?: string;
      percentComplete?: number;
    };
  };
}

export interface ReportRecord {
  [key: string]: any;
}

export interface ReportResults {
  totalRecords: number;
  recordCount: number; // Alias for totalRecords for frontend compatibility
  records: ReportRecord[];
  generatedAt: Date;
  columns: ReportColumn[];
}

export interface ReportColumn {
  id: string;
  header: string;
  type: 'string' | 'number' | 'date' | 'boolean';
  width?: number;
}

export abstract class WizardReport extends BaseWizard {
  isReport: boolean = true;

  /**
   * Get column definitions for this report
   * Override in subclasses to define the structure of the report output
   */
  abstract getColumns(): ReportColumn[];

  /**
   * Fetch records for the report
   * Override in subclasses to implement the actual data fetching logic
   * @param config Report configuration (filters, date range, etc.)
   * @param batchSize Number of records to fetch per batch
   * @param onProgress Callback for progress updates
   * @returns Array of records to include in the report
   */
  abstract fetchRecords(
    config: ReportConfig,
    batchSize?: number,
    onProgress?: (progress: { processed: number; total: number }) => void
  ): Promise<ReportRecord[]>;

  /**
   * Get the field name to use as the primary key for this report
   * Override in subclasses to use a different primary key field
   * @returns Field name (e.g., 'workerId', 'ssn')
   */
  getPrimaryKeyField(): string {
    return 'workerId'; // Default to workerId for backward compatibility
  }

  /**
   * Extract the primary key value from a record
   * Override in subclasses if custom logic is needed
   * @param record The record to extract the primary key from
   * @returns The primary key value
   */
  getPrimaryKeyValue(record: ReportRecord): string {
    const pkField = this.getPrimaryKeyField();
    const pkValue = record[pkField];
    if (!pkValue) {
      throw new Error(`Record missing ${pkField} - cannot save to report data`);
    }
    return String(pkValue);
  }

  /**
   * Standard three-step flow for report wizards
   */
  getSteps(): WizardStep[] {
    return [
      {
        id: 'inputs',
        name: 'Inputs',
        description: 'Configure report parameters and filters'
      },
      {
        id: 'run',
        name: 'Run',
        description: 'Execute the report and generate results'
      },
      {
        id: 'results',
        name: 'Results',
        description: 'View and download report results'
      }
    ];
  }

  /**
   * Standard statuses for report wizards
   */
  getStatuses(): WizardStatus[] {
    return createStandardStatuses();
  }

  /**
   * Generate the report by fetching records and saving to wizard_report_data
   * @param wizardId The wizard instance ID
   * @param batchSize Number of records to process per batch
   * @param onProgress Callback for progress updates
   * @returns Report results
   */
  async generateReport(
    wizardId: string,
    batchSize: number = 100,
    onProgress?: (progress: { processed: number; total: number }) => void
  ): Promise<ReportResults> {
    const wizard = await storage.wizards.getById(wizardId);
    if (!wizard) {
      throw new Error('Wizard not found');
    }

    const wizardData = wizard.data as ReportData;
    const config = wizardData?.config || {};

    // Clear stale metadata before re-run
    await storage.wizards.update(wizardId, {
      data: {
        ...wizardData,
        reportMeta: undefined,
        recordCount: undefined,
        generatedAt: undefined
      }
    });

    // Fetch records using the subclass implementation
    const records = await this.fetchRecords(config, batchSize, onProgress);

    // Get column definitions
    const columns = this.getColumns();
    const generatedAt = new Date();

    // Delete any existing report data for this wizard to allow re-runs
    await storage.wizards.deleteReportData(wizardId);

    // Save each record as a separate row in wizard_report_data
    // Using the report-defined primary key field (e.g., workerId, ssn)
    // Note: Zero-result reports will have no rows in wizard_report_data
    const pkField = this.getPrimaryKeyField();
    for (const record of records) {
      const pk = this.getPrimaryKeyValue(record);
      await storage.wizards.saveReportData(wizardId, pk, record);
    }

    // Update wizard with metadata and completion status in a single update
    await storage.wizards.update(wizardId, {
      status: 'completed',
      data: {
        ...wizardData,
        reportMeta: {
          generatedAt: generatedAt.toISOString(),
          recordCount: records.length,
          columns,
          primaryKeyField: pkField
        },
        // Legacy fields for backward compatibility - stored as primitives to avoid serialization issues
        recordCount: records.length,
        generatedAt: generatedAt.toISOString(), // Store as ISO string to match reportMeta
        progress: {
          ...(wizardData?.progress || {}),
          run: {
            status: 'completed',
            completedAt: generatedAt.toISOString(),
            percentComplete: 100
          }
        }
      }
    });

    // Build results to return
    const results: ReportResults = {
      totalRecords: records.length,
      recordCount: records.length,
      records,
      generatedAt,
      columns
    };

    return results;
  }

  /**
   * Get the latest report results for a wizard
   * Reconstructs the full report from wizard metadata and individual worker rows
   * @param wizardId The wizard instance ID
   * @returns Report results or null if no report has been generated
   */
  async getReportResults(wizardId: string): Promise<ReportResults | null> {
    // Fetch the wizard to get metadata from wizards.data.reportMeta
    const wizard = await storage.wizards.getById(wizardId);
    if (!wizard) {
      return null;
    }

    const wizardData = wizard.data as ReportData;
    
    // Check if a report has been generated (reportMeta exists)
    if (!wizardData?.reportMeta) {
      return null;
    }

    // Extract metadata from wizards.data.reportMeta - trust this as source of truth
    const { generatedAt: generatedAtISO, recordCount, columns: metaColumns } = wizardData.reportMeta;
    const columns = metaColumns || this.getColumns();
    const generatedAt = new Date(generatedAtISO);

    // Fetch all report data rows for this wizard
    const reportDataRows = await storage.wizards.getReportData(wizardId);
    
    // Extract records from wizard_report_data rows
    // For zero-result reports, this will be an empty array
    const records: ReportRecord[] = reportDataRows
      .map(row => row.data as ReportRecord);

    // Build the full report results using metadata as the source of truth
    // recordCount comes from reportMeta, not from actual rows to handle edge cases
    const results: ReportResults = {
      totalRecords: recordCount,
      recordCount: recordCount, // Use metadata count, not records.length
      records,
      generatedAt,
      columns
    };

    return results;
  }
}
