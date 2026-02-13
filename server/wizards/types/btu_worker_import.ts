import { FeedWizard, FeedField, FeedConfig, FeedData, ValidationError, ProcessResults, ProcessError, RowResult } from '../feed.js';
import { WizardStatus, WizardStep, createStandardStatuses, LaunchArgument } from '../base.js';
import { storage } from '../../storage/index.js';
import { createBtuWorkerImportStorage, TerminatedWorkerInfo } from '../../storage/btu-worker-import.js';
import { parse as parseCSV } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { objectStorageService } from '../../services/objectStorage.js';

export interface ImportedWorkerInfo {
  workerId: string;
  bpsEmployeeId: string;
  workerName: string;
  isNew: boolean;
  deptTitle?: string;
  locationTitle?: string;
  jobTitle?: string;
}

export interface BtuWorkerImportResults extends ProcessResults {
  withEmployerMatch: {
    created: ImportedWorkerInfo[];
    updated: ImportedWorkerInfo[];
  };
  withoutEmployerMatch: {
    created: ImportedWorkerInfo[];
    updated: ImportedWorkerInfo[];
  };
  terminatedByAbsence: TerminatedWorkerInfo[];
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

export class BtuWorkerImportWizard extends FeedWizard {
  name = 'btu_worker_import';
  displayName = 'BTU Worker Import';
  description = 'Import workers from BTU roster files, creating employment records based on employer mappings';
  isFeed = true;
  entityType = undefined;
  requiredComponent = 'sitespecific.btu';

  getSteps(): WizardStep[] {
    return [
      { id: 'upload', name: 'Upload', description: 'Upload the worker roster file' },
      { id: 'map', name: 'Map Columns', description: 'Map file columns to worker fields' },
      { id: 'configure', name: 'Configure', description: 'Set import options including as-of date' },
      { id: 'validate', name: 'Validate', description: 'Validate data before processing' },
      { id: 'process', name: 'Process', description: 'Create/update workers and employment records' },
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
        description: 'Unique employee identifier from BPS',
        displayOrder: 1
      },
      {
        id: 'lastName',
        name: 'Last Name',
        type: 'string',
        required: false,
        requiredForCreate: true,
        description: 'Worker last name',
        maxLength: 100,
        displayOrder: 2
      },
      {
        id: 'firstName',
        name: 'First Name',
        type: 'string',
        required: false,
        requiredForCreate: true,
        description: 'Worker first name',
        maxLength: 100,
        displayOrder: 3
      },
      {
        id: 'middleName',
        name: 'Middle Name',
        type: 'string',
        required: false,
        description: 'Worker middle name (optional)',
        maxLength: 100,
        displayOrder: 4
      },
      {
        id: 'deptId',
        name: 'Department ID',
        type: 'string',
        required: true,
        description: 'Department ID for employer mapping lookup',
        displayOrder: 5
      },
      {
        id: 'deptTitle',
        name: 'Department Title',
        type: 'string',
        required: false,
        description: 'Department title/name',
        displayOrder: 6
      },
      {
        id: 'locationId',
        name: 'Location ID',
        type: 'string',
        required: false,
        description: 'Location ID for employer mapping lookup',
        displayOrder: 7
      },
      {
        id: 'locationTitle',
        name: 'Location Title',
        type: 'string',
        required: false,
        description: 'Location title/name',
        displayOrder: 8
      },
      {
        id: 'jobCode',
        name: 'Job Code',
        type: 'string',
        required: false,
        description: 'Job code for employer mapping lookup',
        displayOrder: 9
      },
      {
        id: 'jobTitle',
        name: 'Job Title',
        type: 'string',
        required: false,
        description: 'Job title/name',
        displayOrder: 10
      },
      {
        id: 'phone',
        name: 'Phone',
        type: 'string',
        required: false,
        description: 'Worker phone number',
        format: 'phone',
        displayOrder: 11
      },
      {
        id: 'email',
        name: 'Email',
        type: 'string',
        required: false,
        description: 'Worker email address',
        format: 'email',
        displayOrder: 12
      },
      {
        id: 'address1',
        name: 'Address Line 1',
        type: 'string',
        required: false,
        description: 'Street address',
        displayOrder: 13
      },
      {
        id: 'address2',
        name: 'Address Line 2',
        type: 'string',
        required: false,
        description: 'Apartment, suite, etc.',
        displayOrder: 14
      },
      {
        id: 'city',
        name: 'City',
        type: 'string',
        required: false,
        description: 'City',
        displayOrder: 15
      },
      {
        id: 'state',
        name: 'State',
        type: 'string',
        required: false,
        description: 'State abbreviation',
        displayOrder: 16
      },
      {
        id: 'zip',
        name: 'ZIP Code',
        type: 'string',
        required: false,
        description: 'ZIP or postal code',
        displayOrder: 17
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
        value: bpsEmployeeId
      });
    }

    const deptId = row.deptId;
    if (!deptId || String(deptId).trim() === '') {
      errors.push({
        rowIndex,
        field: 'deptId',
        message: 'Department ID is required for employer mapping',
        value: deptId
      });
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
      terminatedCount?: number;
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
    const asOfDate = wizardData?.asOfDate || new Date().toISOString().split('T')[0];
    const terminateByAbsence = wizardData?.terminateByAbsence ?? true;

    if (!fileId) {
      throw new Error('No uploaded file found');
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
    const processedBpsIds = new Set<string>();
    const processedEmployerIds = new Set<string>();
    
    // Track workers by employer match status
    const withEmployerMatch: { created: ImportedWorkerInfo[]; updated: ImportedWorkerInfo[] } = {
      created: [],
      updated: []
    };
    const withoutEmployerMatch: { created: ImportedWorkerInfo[]; updated: ImportedWorkerInfo[] } = {
      created: [],
      updated: []
    };

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

          processedBpsIds.add(bpsEmployeeId);

          const deptId = row.deptId?.toString().trim() || '';
          const locationId = row.locationId?.toString().trim() || '';
          const jobCode = row.jobCode?.toString().trim() || '';

          // Find employer mapping (may be null if not found)
          const mappingResult = await btuStorage.findEmployerMapping(deptId, locationId, jobCode);
          const hasEmployerMatch = mappingResult !== null;

          // Track employer IDs for termination scoping (only if mapping exists)
          if (mappingResult) {
            processedEmployerIds.add(mappingResult.primaryEmployer.employerId);
            if (mappingResult.secondaryEmployer) {
              processedEmployerIds.add(mappingResult.secondaryEmployer.employerId);
            }
          }

          const existingWorker = await btuStorage.findWorkerByBpsEmployeeId(bpsEmployeeId);
          const firstName = row.firstName?.toString().trim() || '';
          const lastName = row.lastName?.toString().trim() || '';
          const middleName = row.middleName?.toString().trim();
          const workerName = middleName 
            ? `${lastName}, ${firstName} ${middleName}`
            : `${lastName}, ${firstName}`;

          if (existingWorker) {
            // Update existing worker contact info
            await btuStorage.updateWorkerContact(existingWorker.id, {
              firstName,
              lastName,
              middleName,
              email: row.email?.toString().trim(),
              phone: row.phone?.toString().trim(),
              address1: row.address1?.toString().trim(),
              address2: row.address2?.toString().trim(),
              city: row.city?.toString().trim(),
              state: row.state?.toString().trim(),
              zip: row.zip?.toString().trim(),
            });

            // Only create employment records if we have an employer mapping
            if (mappingResult) {
              const jobTitle = row.jobTitle?.toString().trim() || undefined;

              // Create primary employment record
              await btuStorage.upsertEmploymentRecord(existingWorker.id, {
                employerId: mappingResult.primaryEmployer.employerId,
                isPrimary: true,
                asOfDate,
                bargainingUnitId: mappingResult.bargainingUnitId || undefined,
                employmentStatusId: mappingResult.employmentStatusId || undefined,
                jobTitle,
              });

              // Create secondary employment record if secondary employer exists
              if (mappingResult.secondaryEmployer) {
                await btuStorage.upsertEmploymentRecord(existingWorker.id, {
                  employerId: mappingResult.secondaryEmployer.employerId,
                  isPrimary: false,
                  asOfDate,
                  bargainingUnitId: mappingResult.bargainingUnitId || undefined,
                  employmentStatusId: mappingResult.employmentStatusId || undefined,
                  jobTitle,
                });
              }
            }

            updatedCount++;
            const workerInfo: ImportedWorkerInfo = {
              workerId: existingWorker.id,
              bpsEmployeeId,
              workerName,
              isNew: false,
              deptTitle: row.deptTitle?.toString().trim() || undefined,
              locationTitle: row.locationTitle?.toString().trim() || undefined,
              jobTitle: row.jobTitle?.toString().trim() || undefined,
            };
            
            if (hasEmployerMatch) {
              withEmployerMatch.updated.push(workerInfo);
            } else {
              withoutEmployerMatch.updated.push(workerInfo);
            }
            
            rowResults.push({
              rowIndex,
              status: 'success',
              message: hasEmployerMatch 
                ? `Updated worker ${bpsEmployeeId}`
                : `Updated worker ${bpsEmployeeId} (no employer mapping)`
            });
          } else {
            // Create new worker
            const newWorker = await btuStorage.createWorkerWithContact({
              bpsEmployeeId,
              firstName,
              lastName,
              middleName,
              email: row.email?.toString().trim(),
              phone: row.phone?.toString().trim(),
              address1: row.address1?.toString().trim(),
              address2: row.address2?.toString().trim(),
              city: row.city?.toString().trim(),
              state: row.state?.toString().trim(),
              zip: row.zip?.toString().trim(),
              bargainingUnitId: mappingResult?.bargainingUnitId || undefined,
            });

            // Only create employment records if we have an employer mapping
            if (mappingResult) {
              const jobTitle = row.jobTitle?.toString().trim() || undefined;

              // Create primary employment record
              await btuStorage.upsertEmploymentRecord(newWorker.id, {
                employerId: mappingResult.primaryEmployer.employerId,
                isPrimary: true,
                asOfDate,
                bargainingUnitId: mappingResult.bargainingUnitId || undefined,
                employmentStatusId: mappingResult.employmentStatusId || undefined,
                jobTitle,
              });

              // Create secondary employment record if secondary employer exists
              if (mappingResult.secondaryEmployer) {
                await btuStorage.upsertEmploymentRecord(newWorker.id, {
                  employerId: mappingResult.secondaryEmployer.employerId,
                  isPrimary: false,
                  asOfDate,
                  bargainingUnitId: mappingResult.bargainingUnitId || undefined,
                  employmentStatusId: mappingResult.employmentStatusId || undefined,
                  jobTitle,
                });
              }
            }

            createdCount++;
            const workerInfo: ImportedWorkerInfo = {
              workerId: newWorker.id,
              bpsEmployeeId,
              workerName,
              isNew: true,
              deptTitle: row.deptTitle?.toString().trim() || undefined,
              locationTitle: row.locationTitle?.toString().trim() || undefined,
              jobTitle: row.jobTitle?.toString().trim() || undefined,
            };
            
            if (hasEmployerMatch) {
              withEmployerMatch.created.push(workerInfo);
            } else {
              withoutEmployerMatch.created.push(workerInfo);
            }
            
            rowResults.push({
              rowIndex,
              status: 'success',
              message: hasEmployerMatch 
                ? `Created worker ${bpsEmployeeId}`
                : `Created worker ${bpsEmployeeId} (no employer mapping)`
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

    // Handle termination by absence (only for employers we have mappings for)
    let terminationResult = { count: 0, terminatedWorkers: [] as TerminatedWorkerInfo[] };
    if (terminateByAbsence && processedEmployerIds.size > 0) {
      try {
        terminationResult = await btuStorage.terminateWorkersNotInList(
          Array.from(processedBpsIds),
          asOfDate,
          Array.from(processedEmployerIds)
        );
      } catch (err) {
        console.error('Error during termination by absence:', err);
      }
    }

    const results: BtuWorkerImportResults = {
      totalRows,
      createdCount,
      updatedCount,
      successCount: createdCount + updatedCount,
      failureCount,
      errors: allErrors,
      rowResults,
      completedAt: new Date(),
      withEmployerMatch,
      withoutEmployerMatch,
      terminatedByAbsence: terminationResult.terminatedWorkers,
    };

    if (terminationResult.count > 0) {
      (results as any).terminatedCount = terminationResult.count;
    }

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

export const btuWorkerImport = new BtuWorkerImportWizard();
