import { FeedWizard, FeedField, FeedConfig, FeedData, ValidationError, ProcessResults, ProcessError, RowResult } from '../feed.js';
import { WizardStatus, WizardStep, createStandardStatuses, LaunchArgument } from '../base.js';
import { storage } from '../../storage/index.js';
import { createBtuWorkerImportStorage } from '../../storage/btu-worker-import.js';
import { createCardcheckStorage, SignedCardcheckWithDetails } from '../../storage/cardchecks.js';
import { createBargainingUnitStorage, type BargainingUnitData } from '../../storage/bargaining-units.js';
import { executeChargePlugins, TriggerType, DuesImportSavedContext } from '../../charge-plugins/index.js';
import { parse as parseCSV } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { objectStorageService } from '../../services/objectStorage.js';
import { logger } from '../../logger.js';

export interface CardCheckComparisonEntry {
  workerId: string;
  workerSiriusId: number;
  workerName: string;
  bargainingUnitName: string | null;
  employerNames: string[];
  allocatedAmount?: number;
  cardCheckRate?: number | null;
}

export interface WorkerNotFoundEntry {
  rowIndex: number;
  bpsEmployeeId: string;
  workerNameFromFile: string | null;
  amount: number;
  date: string;
  deductionCode: string | null;
}

export interface CardCheckComparisonReport {
  matchingRate: CardCheckComparisonEntry[];
  mismatchingRate: CardCheckComparisonEntry[];
  noCardCheck: CardCheckComparisonEntry[];
  cardCheckMissingRate: CardCheckComparisonEntry[];
  cardCheckNoAllocation: CardCheckComparisonEntry[];
  workerNotFound: WorkerNotFoundEntry[];
}

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
  
  // Handle Excel serial dates (number of days since 1900-01-01)
  // Excel serial dates are typically between 1 (1900-01-01) and ~60000 (2064)
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value.trim()))) {
    const serialNumber = typeof value === 'number' ? value : parseInt(value.trim(), 10);
    // Excel serial dates are reasonable between 1 and 100000 (covers 1900-2173)
    if (serialNumber > 0 && serialNumber < 100000) {
      // Excel epoch is January 1, 1900, but Excel has a bug treating 1900 as leap year
      // Days 1-59 are 1900-01-01 to 1900-02-28, day 60 is the fake Feb 29
      // Days 61+ need to subtract 1 to account for the fake leap day
      const excelEpoch = new Date(1899, 11, 30); // Dec 30, 1899 (accounts for Excel's 1-based and leap year bug)
      const date = new Date(excelEpoch.getTime() + serialNumber * 24 * 60 * 60 * 1000);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }
  }
  
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
    }
    // Note: Worker not found is no longer a validation error - these rows are tracked separately in results

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

    if (!fileId) {
      throw new Error('No uploaded file found');
    }

    const pluginConfigs = await storage.chargePluginConfigs.getEnabledForPlugin('btu-dues-allocation', null);
    if (pluginConfigs.length === 0) {
      throw new Error('BTU Dues Allocation plugin is not configured. Please configure it in Ledger > Charge Plugins.');
    }

    const settings = pluginConfigs[0].settings as { accountIds?: string[] } | null;
    const configuredAccountIds = settings?.accountIds || [];
    if (configuredAccountIds.length === 0) {
      throw new Error('No ledger accounts configured for BTU Dues Allocation plugin.');
    }

    const accountId = configuredAccountIds[0];

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
    let workerNotFoundCount = 0;
    const allErrors: ProcessError[] = [];
    const rowResults: RowResult[] = [];
    
    const allocatedWorkers: Map<string, {
      workerId: string;
      workerSiriusId: number;
      workerName: string;
      bargainingUnitId: string | null;
      bargainingUnitName: string | null;
      employerNames: string[];
      amount: number;
    }> = new Map();
    
    const workersNotFound: WorkerNotFoundEntry[] = [];

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
            // Track worker not found - don't treat as error, just track separately
            const amountStr = String(row.amount || '0').replace(/[,$]/g, '');
            const amount = parseFloat(amountStr);
            const transactionDate = parseDate(row.date);
            
            workersNotFound.push({
              rowIndex,
              bpsEmployeeId,
              workerNameFromFile: row.workerName?.toString().trim() || null,
              amount: isNaN(amount) ? 0 : amount,
              date: transactionDate ? transactionDate.toISOString().split('T')[0] : row.date?.toString() || '',
              deductionCode: row.deductionCode?.toString().trim() || null,
            });
            
            workerNotFoundCount++;
            // Use 'skipped' status to distinguish from actual errors
            rowResults.push({
              rowIndex,
              status: 'success',
              message: `Worker not found with Employee ID: ${bpsEmployeeId} - tracked for review`
            });
            
            logger.warn("Worker not found during dues allocation", {
              service: "btu-dues-allocation-wizard",
              wizardId,
              rowIndex,
              bpsEmployeeId,
            });
            
            continue; // Skip to next row
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
            
            if (!allocatedWorkers.has(worker.id)) {
              let bargainingUnitName: string | null = null;
              if (worker.bargainingUnitId) {
                const bu = await storage.bargainingUnits.getBargainingUnitById(worker.bargainingUnitId);
                bargainingUnitName = bu?.name || null;
              }
              
              const employerNames: string[] = [];
              if (worker.denormEmployerIds && worker.denormEmployerIds.length > 0) {
                for (const empId of worker.denormEmployerIds) {
                  const emp = await storage.employers.getEmployer(empId);
                  if (emp) employerNames.push(emp.name);
                }
              }
              
              allocatedWorkers.set(worker.id, {
                workerId: worker.id,
                workerSiriusId: worker.siriusId,
                workerName,
                bargainingUnitId: worker.bargainingUnitId,
                bargainingUnitName,
                employerNames,
                amount,
              });
            } else {
              const existing = allocatedWorkers.get(worker.id)!;
              existing.amount += amount;
            }
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

    const cardcheckStorage = createCardcheckStorage();
    const signedCardchecks = await cardcheckStorage.getAllSignedCardchecksWithDetails();
    
    const cardCheckByWorkerId = new Map<string, SignedCardcheckWithDetails>();
    for (const cc of signedCardchecks) {
      cardCheckByWorkerId.set(cc.workerId, cc);
    }
    
    const bargainingUnitStorage = createBargainingUnitStorage();
    const allBargainingUnits = await bargainingUnitStorage.getAllBargainingUnits();
    const buRateMap = new Map<string, number>();
    for (const bu of allBargainingUnits) {
      const data = bu.data as BargainingUnitData | null;
      const rate = data?.accountRates?.[accountId];
      if (rate !== undefined) {
        buRateMap.set(bu.id, rate);
      }
    }
    
    const comparisonReport: CardCheckComparisonReport = {
      matchingRate: [],
      mismatchingRate: [],
      noCardCheck: [],
      cardCheckMissingRate: [],
      cardCheckNoAllocation: [],
      workerNotFound: workersNotFound,
    };
    
    const allocatedEntries = Array.from(allocatedWorkers.entries());
    for (const [workerId, allocated] of allocatedEntries) {
      const cardCheck = cardCheckByWorkerId.get(workerId);
      
      let effectiveRate: number | null = null;
      if (cardCheck) {
        if (cardCheck.rate !== null) {
          effectiveRate = cardCheck.rate;
        } else if (cardCheck.bargainingUnitId) {
          effectiveRate = buRateMap.get(cardCheck.bargainingUnitId) ?? null;
        }
      }
      
      const entry: CardCheckComparisonEntry = {
        workerId: allocated.workerId,
        workerSiriusId: allocated.workerSiriusId,
        workerName: allocated.workerName,
        bargainingUnitName: allocated.bargainingUnitName,
        employerNames: allocated.employerNames,
        allocatedAmount: allocated.amount,
        cardCheckRate: effectiveRate,
      };
      
      if (!cardCheck) {
        comparisonReport.noCardCheck.push(entry);
      } else if (effectiveRate === null) {
        comparisonReport.cardCheckMissingRate.push(entry);
      } else if (Math.abs(effectiveRate - allocated.amount) < 0.01) {
        comparisonReport.matchingRate.push(entry);
      } else {
        comparisonReport.mismatchingRate.push(entry);
      }
    }
    
    for (const cardCheck of signedCardchecks) {
      if (!allocatedWorkers.has(cardCheck.workerId)) {
        let effectiveCardRate: number | null = cardCheck.rate;
        if (effectiveCardRate === null && cardCheck.bargainingUnitId) {
          effectiveCardRate = buRateMap.get(cardCheck.bargainingUnitId) ?? null;
        }
        comparisonReport.cardCheckNoAllocation.push({
          workerId: cardCheck.workerId,
          workerSiriusId: cardCheck.workerSiriusId,
          workerName: cardCheck.workerName,
          bargainingUnitName: cardCheck.bargainingUnitName,
          employerNames: cardCheck.employerNames,
          cardCheckRate: effectiveCardRate,
        });
      }
    }
    
    logger.info("Card check comparison report generated", {
      service: "btu-dues-allocation-wizard",
      wizardId,
      matchingRate: comparisonReport.matchingRate.length,
      mismatchingRate: comparisonReport.mismatchingRate.length,
      noCardCheck: comparisonReport.noCardCheck.length,
      cardCheckMissingRate: comparisonReport.cardCheckMissingRate.length,
      cardCheckNoAllocation: comparisonReport.cardCheckNoAllocation.length,
      workerNotFound: comparisonReport.workerNotFound.length,
    });

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
        processResults: results,
        cardCheckComparisonReport: comparisonReport,
      },
      status: failureCount === 0 ? 'completed' : 'completed_with_errors'
    });

    return results;
  }
}

export const btuDuesAllocation = new BtuDuesAllocationWizard();
