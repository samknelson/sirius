import { FeedWizard, FeedField, FeedConfig, FeedData, ValidationError, ProcessResults, ProcessError, RowResult } from '../feed.js';
import { WizardStatus, WizardStep, createStandardStatuses, LaunchArgument } from '../base.js';
import { storage } from '../../storage/index.js';
import { createBtuWorkerImportStorage } from '../../storage/btu-worker-import.js';
import { parse as parseCSV } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { objectStorageService } from '../../services/objectStorage.js';

export interface CardcheckImportWorkerInfo {
  workerId: string;
  bpsEmployeeId: string;
  workerName: string;
  signedDate: string;
  bargainingUnitName?: string;
}

export interface BtuCardcheckImportResults extends ProcessResults {
  cardchecksCreated: CardcheckImportWorkerInfo[];
  skippedDuplicate: CardcheckImportWorkerInfo[];
  notFoundBpsIds: Array<{ bpsEmployeeId: string; rowIndex: number }>;
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
  let str = String(value).trim();
  if (!str) return null;

  if (/^\d{5}$/.test(str)) {
    const excelEpoch = new Date(1899, 11, 30);
    const days = parseInt(str, 10);
    const result = new Date(excelEpoch.getTime() + days * 86400000);
    if (!isNaN(result.getTime())) return result;
  }

  str = str.replace(/\s*[-–]\s*\d{1,2}:\d{2}(:\d{2})?\s*$/, '').trim();
  str = str.replace(/\s+\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM)?\s*$/i, '').trim();

  const mmddyyyy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (mmddyyyy) {
    let year = parseInt(mmddyyyy[3]);
    if (year < 100) year += 2000;
    const result = new Date(year, parseInt(mmddyyyy[1]) - 1, parseInt(mmddyyyy[2]));
    if (!isNaN(result.getTime())) return result;
  }

  const yyyymmdd = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (yyyymmdd) {
    const result = new Date(parseInt(yyyymmdd[1]), parseInt(yyyymmdd[2]) - 1, parseInt(yyyymmdd[3]));
    if (!isNaN(result.getTime())) return result;
  }

  const fallback = new Date(str);
  if (!isNaN(fallback.getTime())) return fallback;

  return null;
}

export class BtuCardcheckImportWizard extends FeedWizard {
  name = 'btu_cardcheck_import';
  displayName = 'BTU Card Check Import';
  description = 'Import card check records from a file, matching workers by BPS Employee ID';
  isFeed = true;
  entityType = undefined;
  requiredComponent = 'sitespecific.btu';

  getSteps(): WizardStep[] {
    return [
      { id: 'upload', name: 'Upload', description: 'Upload the card check file' },
      { id: 'map', name: 'Map Columns', description: 'Map file columns to card check fields' },
      { id: 'configure', name: 'Configure', description: 'Select the card check definition' },
      { id: 'validate', name: 'Validate', description: 'Validate data before processing' },
      { id: 'process', name: 'Process', description: 'Create card check records' },
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
        name: 'BPS Employee ID',
        type: 'string',
        required: true,
        description: 'BPS Employee ID to match workers',
        displayOrder: 1,
      },
      {
        id: 'signatureDate',
        name: 'Signature Date',
        type: 'date',
        required: true,
        description: 'Date the card check was signed',
        format: 'date',
        displayOrder: 2,
      },
      {
        id: 'bargainingUnit',
        name: 'Bargaining Unit',
        type: 'string',
        required: false,
        description: 'Bargaining unit name (optional, overrides worker default)',
        displayOrder: 3,
      },
    ];
  }

  async validateRow(row: Record<string, any>, rowIndex: number, mode: 'create' | 'update'): Promise<ValidationError[]> {
    const errors = await super.validateRow(row, rowIndex, mode);

    const bpsEmployeeId = row.bpsEmployeeId;
    if (!bpsEmployeeId || String(bpsEmployeeId).trim() === '') {
      errors.push({
        rowIndex,
        field: 'bpsEmployeeId',
        message: 'BPS Employee ID is required',
        value: bpsEmployeeId,
      });
    }

    const signatureDate = row.signatureDate;
    if (signatureDate) {
      const parsed = parseDate(signatureDate);
      if (!parsed) {
        errors.push({
          rowIndex,
          field: 'signatureDate',
          message: 'Invalid date format for Signature Date',
          value: signatureDate,
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
    }) => void,
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
    const cardcheckDefinitionId = wizardData?.cardcheckDefinitionId;

    if (!fileId) {
      throw new Error('No uploaded file found');
    }

    if (!cardcheckDefinitionId) {
      throw new Error('No card check definition selected');
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
        relax_column_count: true,
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

    const bargainingUnitsResult = await storage.bargainingUnits.getAllBargainingUnits();
    const buNameMap = new Map<string, string>();
    for (const bu of bargainingUnitsResult) {
      buNameMap.set(bu.name.toLowerCase().trim(), bu.id);
      const shortName = bu.name.toLowerCase().replace(/\s*unit\s*/gi, '').trim();
      buNameMap.set(shortName, bu.id);
    }

    const totalRows = mappedRows.length;
    let createdCount = 0;
    let updatedCount = 0;
    let failureCount = 0;
    const allErrors: ProcessError[] = [];
    const rowResults: RowResult[] = [];
    const cardchecksCreated: CardcheckImportWorkerInfo[] = [];
    const skippedDuplicate: CardcheckImportWorkerInfo[] = [];
    const notFoundBpsIds: Array<{ bpsEmployeeId: string; rowIndex: number }> = [];

    for (let i = 0; i < totalRows; i += batchSize) {
      const batch = mappedRows.slice(i, Math.min(i + batchSize, totalRows));

      for (let j = 0; j < batch.length; j++) {
        const rowIndex = i + j;
        const row = batch[j];

        try {
          const bpsEmployeeId = row.bpsEmployeeId?.toString().trim();
          if (!bpsEmployeeId) {
            throw new Error('BPS Employee ID is missing');
          }

          const worker = await btuStorage.findWorkerByBpsEmployeeId(bpsEmployeeId);
          if (!worker) {
            notFoundBpsIds.push({ bpsEmployeeId, rowIndex });
            failureCount++;
            rowResults.push({
              rowIndex,
              status: 'error',
              message: `Worker not found for BPS Employee ID: ${bpsEmployeeId}`,
            });
            continue;
          }

          const signedDate = parseDate(row.signatureDate);
          if (!signedDate) {
            throw new Error(`Invalid signature date: ${row.signatureDate}`);
          }

          let bargainingUnitId = worker.bargainingUnitId;
          if (row.bargainingUnit) {
            const buName = String(row.bargainingUnit).toLowerCase().trim();
            const matchedBuId = buNameMap.get(buName);
            if (matchedBuId) {
              bargainingUnitId = matchedBuId;
            }
          }

          const workerContact = await storage.contacts.getContact(worker.contactId);
          const workerName = workerContact
            ? `${workerContact.family || ''}, ${workerContact.given || ''}`.trim().replace(/^,\s*|,\s*$/g, '') || workerContact.displayName || `Worker #${worker.siriusId}`
            : `Worker #${worker.siriusId}`;

          const buMatch = bargainingUnitId ? bargainingUnitsResult.find((b: any) => b.id === bargainingUnitId) : null;

          const workerInfo: CardcheckImportWorkerInfo = {
            workerId: worker.id,
            bpsEmployeeId,
            workerName,
            signedDate: signedDate.toISOString().split('T')[0],
            bargainingUnitName: buMatch?.name,
          };

          try {
            await storage.cardchecks.createCardcheck({
              workerId: worker.id,
              cardcheckDefinitionId,
              status: 'signed',
              signedDate,
              bargainingUnitId,
            });

            createdCount++;
            cardchecksCreated.push(workerInfo);
            rowResults.push({
              rowIndex,
              status: 'success',
              message: `Created card check for ${workerName} (BPS ID: ${bpsEmployeeId})`,
            });
          } catch (createErr: any) {
            if (createErr?.message?.includes('DUPLICATE_SIGNED')) {
              skippedDuplicate.push(workerInfo);
              updatedCount++;
              rowResults.push({
                rowIndex,
                status: 'success',
                message: `Skipped duplicate signed card check for ${workerName} (BPS ID: ${bpsEmployeeId})`,
              });
            } else {
              throw createErr;
            }
          }
        } catch (err) {
          failureCount++;
          const errorMessage = err instanceof Error ? err.message : 'Unknown error';
          allErrors.push({
            rowIndex,
            message: errorMessage,
            data: row,
          });
          rowResults.push({
            rowIndex,
            status: 'error',
            message: errorMessage,
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

    const results: BtuCardcheckImportResults = {
      totalRows,
      createdCount,
      updatedCount,
      successCount: createdCount + updatedCount,
      failureCount,
      errors: allErrors,
      rowResults,
      completedAt: new Date(),
      cardchecksCreated,
      skippedDuplicate,
      notFoundBpsIds,
    };

    await storage.wizards.update(wizardId, {
      data: {
        ...wizardData,
        processResults: results,
      },
      status: failureCount === 0 ? 'completed' : 'completed_with_errors',
    });

    return results;
  }
}

export const btuCardcheckImport = new BtuCardcheckImportWizard();
