import { BaseWizard, WizardStep, WizardStatus, createStandardStatuses } from './base.js';
import { storage } from '../storage/index.js';

export interface ReportConfig {
  filters?: Record<string, any>;
  dateRange?: {
    start: Date;
    end: Date;
  };
}

export interface ReportData {
  config?: ReportConfig;
  recordCount?: number;
  generatedAt?: Date;
  reportDataId?: string; // Reference to wizard_report_data entry
}

export interface ReportRecord {
  [key: string]: any;
}

export interface ReportResults {
  totalRecords: number;
  records: ReportRecord[];
  generatedAt: Date;
  columns: ReportColumn[];
}

export interface ReportColumn {
  id: string;
  name: string;
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

    // Fetch records using the subclass implementation
    const records = await this.fetchRecords(config, batchSize, onProgress);

    // Get column definitions
    const columns = this.getColumns();

    // Build results
    const results: ReportResults = {
      totalRecords: records.length,
      records,
      generatedAt: new Date(),
      columns
    };

    // Save results to wizard_report_data table
    const reportData = await storage.wizards.saveReportData(wizardId, results);

    // Update wizard data with reference to report data
    await storage.wizards.update(wizardId, {
      data: {
        ...wizardData,
        recordCount: records.length,
        generatedAt: new Date(),
        reportDataId: reportData.id
      }
    });

    return results;
  }

  /**
   * Get the latest report results for a wizard
   * @param wizardId The wizard instance ID
   * @returns Report results or null if no report has been generated
   */
  async getReportResults(wizardId: string): Promise<ReportResults | null> {
    const reportData = await storage.wizards.getLatestReportData(wizardId);
    if (!reportData) {
      return null;
    }
    return reportData.data as ReportResults;
  }
}
