import { FeedWizard, FeedField, FeedConfig, FeedData, ValidationError, ProcessResults, ProcessError, RowResult } from '../feed.js';
import { WizardStatus, WizardStep, createStandardStatuses, LaunchArgument } from '../base.js';
import { storage } from '../../storage/index.js';
import { createBtuWorkerImportStorage } from '../../storage/btu-worker-import.js';
import { executeChargePlugins, TriggerType, DuesImportSavedContext } from '../../charge-plugins/index.js';
import { parse as parseCSV } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { objectStorageService } from '../../services/objectStorage.js';
import { logger } from '../../logger.js';

function filterEmptyColumns(rows: any[][]): any[][] {
  if (rows.length === 0) return rows;
  
  const maxCols = Math.max(...rows.map(row => row.length));
  const nonEmptyColIndices: number[] = [];
  
  for (let colIdx = 0; colIdx < maxCols; colIdx++) {
    const hasData = rows.some(row => {
      const cell = row[colIdx];
      return cell !== null && cell !== undefined && cell !== '';
    });
    if (hasData) {
      nonEmptyColIndices.push(colIdx);
    }
  }
  
  return rows.map(row => nonEmptyColIndices.map(colIdx => row[colIdx] ?? ''));
}

function parseDate(value: any): Date | null {
  if (!value) return null;
  
  const str = String(value).trim();
  
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(str)) {
    const parts = str.split('/');
    const month = parseInt(parts[0], 10) - 1;
    const day = parseInt(parts[1], 10);
    let year = parseInt(parts[2], 10);
    if (year < 100) {
      year += year < 50 ? 2000 : 1900;
    }
    return new Date(year, month, day);
  }
  
  const parsed = new Date(str);
  return isNaN(parsed.getTime()) ? null : parsed;
}

export class BtuDuesAllocationWizard extends FeedWizard {
  name = 'btu_dues_allocation';
  displayName = 'BTU Dues Allocation Import';
  description = 'Import dues allocations from payroll deduction files, creating payment records for workers';
  isFeed = true;
  entityType = undefined;
  requiredComponent = 'sitespecific.btu';

  getSteps(): WizardStep[] {
    return [
      { id: 'upload', name: 'Upload', description: 'Upload the dues allocation file' },
      { id: 'map', name: 'Map Columns', description: 'Map file columns to dues fields' },
      { id: 'configure', name: 'Configure', description: 'Select ledger account for dues' },
      { id: 'validate', name: 'Validate', description: 'Validate data before processing' },
      { id: 'process', name: 'Process', description: 'Create payment and ledger records' },
      { id: 'results', name: 'Results', description: 'Review import results' },
    ];
  }

  getStatuses(): WizardStatus[] {
    return createStandardStatuses();
  }

  getLaunchArguments(): LaunchArgument[] {
    return [];
  }

  getFields(): FeedField[] {
    return [
      {
        id: 'bpsEmployeeId',
        name: 'Employee ID',
        type: 'string',
        required: true,
        description: 'BPS Employee ID to match with workers',
        displayOrder: 1
      },
      {
        id: 'amount',
        name: 'Amount Deducted',
        type: 'number',
        required: true,
        description: 'Dues amount deducted',
        displayOrder: 2
      },
      {
        id: 'date',
        name: 'Date',
        type: 'date',
        required: true,
        description: 'Date of the deduction',
        displayOrder: 3
      },
      {
        id: 'deductionCode',
        name: 'Deduction Code',
        type: 'string',
        required: false,
        description: 'Payroll deduction code (optional)',
        displayOrder: 4
      },
      {
        id: 'workerName',
        name: 'Worker Name',
        type: 'string',
        required: false,
        description: 'Worker name for reference (optional)',
        displayOrder: 5
      },
    ];
  }

  async validateRow(row: Record<string, any>, rowIndex: number, mode: 'create' | 'update'): Promise<ValidationError[]> {
    const errors = await super.validateRow(row, rowIndex, mode);
    const btuStorage = createBtuWorkerImportStorage();

    const bpsEmployeeId = row.bpsEmployeeId;
    if (!bpsEmployeeId || String(bpsEmployeeId).trim() === '') {
      errors.push({
        rowIndex,
        field: 'bpsEmployeeId',
        message: 'Employee ID is required',
        value: bpsEmployeeId
      });
    } else {
      const worker = await btuStorage.findWorkerByBpsEmployeeId(String(bpsEmployeeId).trim());
      if (!worker) {
        errors.push({
          rowIndex,
          field: 'bpsEmployeeId',
          message: `No worker found with Employee ID: ${bpsEmployeeId}`,
          value: bpsEmployeeId
        });
      }
    }

    const amount = row.amount;
    if (amount === undefined || amount === null || amount === '') {
      errors.push({
        rowIndex,
        field: 'amount',
        message: 'Amount is required',
        value: amount
      });
    } else {
      const numAmount = parseFloat(String(amount).replace(/[,$]/g, ''));
      if (isNaN(numAmount) || numAmount <= 0) {
        errors.push({
          rowIndex,
          field: 'amount',
          message: 'Amount must be a positive number',
          value: amount
        });
      }
    }

    const date = row.date;
    if (!date) {
      errors.push({
        rowIndex,
        field: 'date',
        message: 'Date is required',
        value: date
      });
    } else {
      const parsedDate = parseDate(date);
      if (!parsedDate) {
        errors.push({
          rowIndex,
          field: 'date',
          message: 'Invalid date format',
          value: date
        });
      }
    }

    return errors;
  }

  async generateFeed(config: FeedConfig, data: any): Promise<FeedData> {
    return {
      recordCount: 0,
      generatedAt: new Date(),
    };
  }

  async processFeedData(
    wizardId: string,
    batchSize: number = 100,
    onProgress?: (progress: { 
      processed: number; 
      total: number;
      createdCount: number;
      updatedCount: number;
      successCount: number; 
      failureCount: number;
      currentRow?: { index: number; status: 'success' | 'error'; error?: string };
    }) => void
  ): Promise<ProcessResults> {
    const btuStorage = createBtuWorkerImportStorage();
    
    const wizard = await storage.wizards.getById(wizardId);
    if (!wizard) {
      throw new Error('Wizard not found');
    }

    const wizardData = wizard.data as any;
    const fileId = wizardData?.uploadedFileId;
    const columnMapping: Record<string, string> = wizardData?.columnMapping || {};
    const hasHeaders = wizardData?.hasHeaders ?? true;
    const accountId = wizardData?.accountId;

    if (!fileId) {
      throw new Error('No uploaded file found');
    }

    if (!accountId) {
      throw new Error('No ledger account selected');
    }

    const file = await storage.files.getById(fileId);
    if (!file) {
      throw new Error('File not found');
    }

    const buffer = await objectStorageService.downloadFile(file.storagePath);

    let rawRows: any[] = [];
    if (file.mimeType === 'text/csv') {
      rawRows = parseCSV(buffer, {
        columns: false,
        skip_empty_lines: true,
        relax_column_count: true
      });
    } else if (file.mimeType?.includes('spreadsheet') || file.mimeType?.includes('excel')) {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      rawRows = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
    } else {
      throw new Error('Unsupported file type');
    }

    rawRows = filterEmptyColumns(rawRows);
    const dataRows = hasHeaders ? rawRows.slice(1) : rawRows;

    const mappedRows = dataRows.map((row: any[]) => {
      const mapped: Record<string, any> = {};
      Object.entries(columnMapping).forEach(([sourceCol, fieldId]) => {
        if (fieldId && fieldId !== '_unmapped') {
          const colIndex = parseInt(sourceCol.replace('col_', ''));
          mapped[fieldId] = row[colIndex];
        }
      });
      return mapped;
    });

    const totalRows = mappedRows.length;
    let createdCount = 0;
    let updatedCount = 0;
    let failureCount = 0;
    const allErrors: ProcessError[] = [];
    const rowResults: RowResult[] = [];

    for (let i = 0; i < totalRows; i += batchSize) {
      const batch = mappedRows.slice(i, Math.min(i + batchSize, totalRows));
      
      for (let j = 0; j < batch.length; j++) {
        const rowIndex = i + j;
        const row = batch[j];
        
        try {
          const bpsEmployeeId = row.bpsEmployeeId?.toString().trim();
          if (!bpsEmployeeId) {
            throw new Error('Employee ID is missing');
          }

          const worker = await btuStorage.findWorkerByBpsEmployeeId(bpsEmployeeId);
          if (!worker) {
            throw new Error(`Worker not found with Employee ID: ${bpsEmployeeId}`);
          }

          const contact = await storage.contacts.getContact(worker.contactId);
          let workerName = `Worker ${bpsEmployeeId}`;
          if (contact) {
            const nameParts = [contact.family, contact.given].filter(Boolean);
            workerName = nameParts.length > 0 ? nameParts.join(', ') : workerName;
          }

          const amountStr = String(row.amount).replace(/[,$]/g, '');
          const amount = parseFloat(amountStr);
          if (isNaN(amount) || amount <= 0) {
            throw new Error('Invalid amount');
          }

          const transactionDate = parseDate(row.date);
          if (!transactionDate) {
            throw new Error('Invalid date');
          }

          const deductionCode = row.deductionCode?.toString().trim() || null;

          const duesContext: DuesImportSavedContext = {
            trigger: TriggerType.DUES_IMPORT_SAVED,
            wizardId,
            rowIndex,
            workerId: worker.id,
            workerName,
            bpsEmployeeId,
            amount: amount.toFixed(2),
            transactionDate,
            accountId,
            deductionCode,
            memo: `Dues deduction ${deductionCode ? `(${deductionCode})` : ''} - ${bpsEmployeeId}`,
          };

          const result = await executeChargePlugins(duesContext);

          if (result.totalTransactions.length > 0) {
            createdCount++;
            rowResults.push({
              rowIndex,
              status: 'success',
              message: `Created dues entry for ${workerName}: $${amount.toFixed(2)}`
            });
          } else {
            const pluginError = result.executed.find(e => !e.success)?.error;
            if (pluginError) {
              throw new Error(pluginError);
            }
            failureCount++;
            rowResults.push({
              rowIndex,
              status: 'error',
              message: 'No ledger entries created - check plugin configuration'
            });
            allErrors.push({
              rowIndex,
              message: 'No ledger entries created',
              data: row
            });
          }
        } catch (err) {
          failureCount++;
          const errorMessage = err instanceof Error ? err.message : 'Unknown error';
          allErrors.push({
            rowIndex,
            message: errorMessage,
            data: row
          });
          rowResults.push({
            rowIndex,
            status: 'error',
            message: errorMessage
          });
          
          logger.error("Dues allocation processing error", {
            service: "btu-dues-allocation-wizard",
            wizardId,
            rowIndex,
            error: errorMessage,
          });
        }
      }

      if (onProgress) {
        onProgress({
          processed: Math.min(i + batchSize, totalRows),
          total: totalRows,
          createdCount,
          updatedCount,
          successCount: createdCount + updatedCount,
          failureCount,
        });
      }
    }

    const results: ProcessResults = {
      totalRows,
      createdCount,
      updatedCount,
      successCount: createdCount,
      failureCount,
      errors: allErrors,
      rowResults,
      completedAt: new Date(),
    };

    await storage.wizards.update(wizardId, {
      data: {
        ...wizardData,
        processResults: results
      },
      status: failureCount === 0 ? 'completed' : 'completed_with_errors'
    });

    return results;
  }
}

export const btuDuesAllocation = new BtuDuesAllocationWizard();
