import { BaseWizard, WizardStep, WizardStatus, createStandardStatuses } from './base.js';
import { storage } from '../storage/index.js';
import type { InsertFile, File } from '@shared/schema';
import { parse as parseCSV } from 'csv-parse/sync';
import { stringify as stringifyCSV } from 'csv-stringify/sync';
import * as XLSX from 'xlsx';
import { objectStorageService } from '../services/objectStorage.js';

export interface FeedConfig {
  outputFormat?: 'csv' | 'json' | 'excel';
  includeHeaders?: boolean;
  dateRange?: {
    start: Date;
    end: Date;
  };
}

export interface FeedData {
  recordCount?: number;
  generatedAt?: Date;
  filters?: Record<string, any>;
  outputPath?: string;
  uploadedFileId?: string;
  columnMapping?: Record<string, string>; // Maps source columns to field IDs
  hasHeaders?: boolean; // Whether the first row contains headers
  mode?: 'create' | 'update'; // Whether this feed creates new records or updates existing ones
  validationResults?: ValidationResults;
  processResults?: ProcessResults;
}

export interface ValidationError {
  rowIndex: number;
  field: string;
  message: string;
  value?: any;
}

export interface ValidationResults {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  errors: ValidationError[];
  errorSummary: Record<string, number>; // Count of each error type
  completedAt?: Date;
}

export interface ProcessError {
  rowIndex: number;
  message: string;
  data?: Record<string, any>;
}

export interface RowResult {
  rowIndex: number;
  status: 'success' | 'error';
  message: string;
}

export interface ProcessResults {
  totalRows: number;
  createdCount: number;
  updatedCount: number;
  successCount: number;
  failureCount: number;
  errors: ProcessError[]; // Legacy - derived from rowResults for backward compatibility
  rowResults: RowResult[]; // Detailed results for each row
  resultsFileId?: string; // ID of the generated results CSV file
  completedAt?: Date;
}

export interface FeedField {
  id: string;
  name: string;
  type: 'string' | 'number' | 'date';
  required: boolean; // Required in all cases
  requiredForCreate?: boolean; // Required only when creating new records
  requiredForUpdate?: boolean; // Required only when updating existing records
  description?: string;
  format?: 'ssn' | 'date' | 'currency' | 'phone' | 'email';
  options?: string[];
  maxLength?: number;
  pattern?: string;
  displayOrder?: number;
}

export abstract class FeedWizard extends BaseWizard {
  isFeed: boolean = true;

  /**
   * Get field definitions for this feed wizard (optional)
   * Override in subclasses that support field mapping
   */
  getFields?(): FeedField[];

  /**
   * Validate a single row of data
   * Override in subclasses to implement specific validation logic
   * @param row The data row as a key-value object (after column mapping)
   * @param rowIndex The row number (0-based, excluding headers if present)
   * @param mode The feed mode ('create' or 'update')
   * @returns Array of validation errors for this row
   */
  async validateRow(row: Record<string, any>, rowIndex: number, mode: 'create' | 'update'): Promise<ValidationError[]> {
    const errors: ValidationError[] = [];
    const fields = this.getFields?.() || [];

    for (const field of fields) {
      const value = row[field.id];
      const isEmpty = value === null || value === undefined || value === '';

      // Check required fields
      const isRequired = field.required || 
        (mode === 'create' && field.requiredForCreate) || 
        (mode === 'update' && field.requiredForUpdate);

      if (isRequired && isEmpty) {
        errors.push({
          rowIndex,
          field: field.id,
          message: `${field.name} is required`,
          value
        });
        continue;
      }

      if (isEmpty) continue;

      // Type validation
      if (field.type === 'number' && isNaN(Number(value))) {
        errors.push({
          rowIndex,
          field: field.id,
          message: `${field.name} must be a number`,
          value
        });
        continue;
      }

      // SSN validation using centralized utility
      if (field.format === 'ssn') {
        const { parseSSN, validateSSN } = await import('@shared/utils/ssn');
        try {
          // Parse SSN to normalize format
          const parsed = parseSSN(String(value));
          // Validate SSN according to SSA rules
          const validation = validateSSN(parsed);
          if (!validation.valid) {
            errors.push({
              rowIndex,
              field: field.id,
              message: validation.error || 'Invalid SSN',
              value
            });
          } else {
            // Store the normalized SSN back into the row for downstream processing
            row[field.id] = parsed;
          }
        } catch (error) {
          errors.push({
            rowIndex,
            field: field.id,
            message: error instanceof Error ? error.message : 'Invalid SSN format',
            value
          });
        }
      }

      // Max length validation
      if (field.maxLength && String(value).length > field.maxLength) {
        errors.push({
          rowIndex,
          field: field.id,
          message: `${field.name} exceeds maximum length of ${field.maxLength}`,
          value: String(value).substring(0, 20) + '...'
        });
      }

      // Pattern validation
      if (field.pattern && !field.format) {
        const regex = new RegExp(field.pattern);
        if (!regex.test(String(value))) {
          errors.push({
            rowIndex,
            field: field.id,
            message: `${field.name} does not match required pattern`,
            value
          });
        }
      }
    }

    return errors;
  }

  /**
   * Process validation in batches with progress tracking
   * @param wizardId The wizard instance ID
   * @param batchSize Number of rows to process per batch (default: 100)
   * @param onProgress Callback for progress updates
   * @returns Validation results
   */
  async validateFeedData(
    wizardId: string,
    batchSize: number = 100,
    onProgress?: (progress: { processed: number; total: number; validRows: number; invalidRows: number }) => void
  ): Promise<ValidationResults> {
    const wizard = await storage.wizards.getById(wizardId);
    if (!wizard) {
      throw new Error('Wizard not found');
    }

    const wizardData = wizard.data as any;
    const fileId = wizardData?.uploadedFileId;
    const columnMapping: Record<string, string> = wizardData?.columnMapping || {};
    const hasHeaders = wizardData?.hasHeaders ?? true;
    const mode = wizardData?.mode || 'create';

    // Validate column mapping for duplicate field IDs (catch legacy data)
    const fieldIds = Object.values(columnMapping).filter(id => id && id !== '_unmapped');
    const duplicates = fieldIds.filter((id, index) => fieldIds.indexOf(id) !== index);
    if (duplicates.length > 0) {
      const uniqueDuplicates = Array.from(new Set(duplicates));
      throw new Error(`Column mapping contains duplicate field assignments: ${uniqueDuplicates.join(', ')}. Please return to the Map step and ensure each field is mapped only once.`);
    }

    if (!fileId) {
      throw new Error('No uploaded file found');
    }

    // Load file from object storage
    const file = await storage.files.getById(fileId);
    if (!file) {
      throw new Error('File not found');
    }

    // Download file content
    const buffer = await objectStorageService.downloadFile(file.storagePath);

    // Parse file based on type
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

    // Skip header row if present
    const dataRows = hasHeaders ? rawRows.slice(1) : rawRows;

    // Map columns to fields
    const mappedRows = dataRows.map((row: any[]) => {
      const mapped: Record<string, any> = {};
      Object.entries(columnMapping).forEach(([sourceCol, fieldId]) => {
        if (fieldId && fieldId !== '_unmapped') {
          // Extract numeric index from "col_0", "col_1", etc.
          const colIndex = parseInt(sourceCol.replace('col_', ''));
          mapped[fieldId] = row[colIndex];
        }
      });
      return mapped;
    });

    // Process in batches
    const totalRows = mappedRows.length;
    let validRows = 0;
    let invalidRows = 0;
    const allErrors: ValidationError[] = [];
    const errorCounts: Record<string, number> = {};
    const errorLimitPerType = 12;

    for (let i = 0; i < totalRows; i += batchSize) {
      const batch = mappedRows.slice(i, Math.min(i + batchSize, totalRows));
      
      // Validate each row in the batch
      for (let j = 0; j < batch.length; j++) {
        const rowIndex = i + j;
        const row = batch[j];
        const rowErrors = await this.validateRow(row, rowIndex, mode);

        if (rowErrors.length === 0) {
          validRows++;
        } else {
          invalidRows++;
          
          // Add errors with limiting per type
          for (const error of rowErrors) {
            const errorKey = `${error.field}:${error.message}`;
            errorCounts[errorKey] = (errorCounts[errorKey] || 0) + 1;
            
            // Only store first 12 of each error type
            if (errorCounts[errorKey] <= errorLimitPerType) {
              allErrors.push(error);
            }
          }
        }
      }

      // Report progress
      if (onProgress) {
        onProgress({
          processed: Math.min(i + batchSize, totalRows),
          total: totalRows,
          validRows,
          invalidRows
        });
      }
    }

    // Build error summary
    const errorSummary: Record<string, number> = {};
    for (const error of allErrors) {
      const key = `${error.field}: ${error.message}`;
      errorSummary[key] = (errorSummary[key] || 0) + 1;
    }

    const results: ValidationResults = {
      totalRows,
      validRows,
      invalidRows,
      errors: allErrors,
      errorSummary,
      completedAt: new Date()
    };

    // Save validation results to wizard data
    await storage.wizards.update(wizardId, {
      data: {
        ...wizardData,
        validationResults: results
      }
    });

    return results;
  }

  /**
   * Parse various date formats and convert to YYYY-MM-DD
   */
  private parseDate(dateStr: string): string | null {
    if (!dateStr || dateStr.trim() === '') {
      return null;
    }

    const trimmed = dateStr.trim();
    
    // Already in YYYY-MM-DD format
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }

    // Try to parse common formats
    let parsed: Date | null = null;

    // M/D/YYYY or MM/DD/YYYY (e.g., 6/8/1955, 01/02/2015)
    const mdyMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (mdyMatch) {
      const [, month, day, year] = mdyMatch;
      parsed = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    }

    // M-D-YYYY or MM-DD-YYYY
    const mdyDashMatch = trimmed.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (mdyDashMatch) {
      const [, month, day, year] = mdyDashMatch;
      parsed = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    }

    // YYYY/MM/DD
    const ymdMatch = trimmed.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
    if (ymdMatch) {
      const [, year, month, day] = ymdMatch;
      parsed = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    }

    if (!parsed || isNaN(parsed.getTime())) {
      throw new Error(`Invalid date format: ${dateStr}. Supported formats: M/D/YYYY, MM/DD/YYYY, YYYY-MM-DD`);
    }

    // Convert to YYYY-MM-DD
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    
    return `${year}-${month}-${day}`;
  }

  /**
   * Process validated feed data to create/update workers
   * @param wizardId The wizard instance ID
   * @param batchSize Number of rows to process per batch (default: 100)
   * @param onProgress Callback for progress updates
   * @returns Processing results
   */
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
    const wizard = await storage.wizards.getById(wizardId);
    if (!wizard) {
      throw new Error('Wizard not found');
    }

    const wizardData = wizard.data as any;
    const fileId = wizardData?.uploadedFileId;
    const columnMapping: Record<string, string> = wizardData?.columnMapping || {};
    const hasHeaders = wizardData?.hasHeaders ?? true;
    const mode = wizardData?.mode || 'create';
    const validationResults = wizardData?.validationResults;

    if (!validationResults) {
      throw new Error('No validation results found. Please validate the data first.');
    }

    if (!fileId) {
      throw new Error('No uploaded file found');
    }

    // Load file from object storage
    const file = await storage.files.getById(fileId);
    if (!file) {
      throw new Error('File not found');
    }

    // Download file content
    const buffer = await objectStorageService.downloadFile(file.storagePath);

    // Parse file based on type
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

    // Skip header row if present
    const dataRows = hasHeaders ? rawRows.slice(1) : rawRows;

    // Map columns to fields
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

    // Process in batches
    const totalRows = mappedRows.length;
    let createdCount = 0;
    let updatedCount = 0;
    let failureCount = 0;
    const allErrors: ProcessError[] = [];
    const rowResults: RowResult[] = [];

    for (let i = 0; i < totalRows; i += batchSize) {
      const batch = mappedRows.slice(i, Math.min(i + batchSize, totalRows));
      
      // Process each row in the batch
      for (let j = 0; j < batch.length; j++) {
        const rowIndex = i + j;
        const row = batch[j];
        
        try {
          // Extract worker data from row
          const rawSSN = row.ssn?.toString().trim();
          const firstName = row.firstName?.toString().trim();
          const lastName = row.lastName?.toString().trim();
          const rawBirthDate = row.dateOfBirth?.toString().trim();

          // Parse SSN early to normalize format (strips non-digits, pads with zeros)
          const { parseSSN } = await import('@shared/utils/ssn');
          let ssn: string | undefined;
          if (rawSSN) {
            try {
              ssn = parseSSN(rawSSN);
            } catch (error) {
              throw new Error(`Invalid SSN format: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
          }

          // Parse birth date to YYYY-MM-DD format if provided
          const birthDate = rawBirthDate ? this.parseDate(rawBirthDate) : null;

          if (mode === 'update') {
            // Update mode: find existing worker by SSN
            if (!ssn) {
              throw new Error('SSN is required for update mode');
            }

            const existingWorker = await storage.workers.getWorkerBySSN(ssn);
            if (!existingWorker) {
              throw new Error(`No worker found with SSN ${ssn}`);
            }

            // Update worker name components if provided
            if (firstName || lastName) {
              await storage.workers.updateWorkerContactNameComponents(existingWorker.id, {
                given: firstName || undefined,
                family: lastName || undefined
              });
            }

            // Update birth date if provided
            if (birthDate) {
              await storage.workers.updateWorkerContactBirthDate(existingWorker.id, birthDate);
            }

            let hoursProcessed = true;
            let hoursError: string | undefined;
            let contactInfoProcessed = true;
            let contactInfoError: string | undefined;

            // Process worker hours if this wizard type supports it (for gbhet_legal_workers wizards)
            if (typeof (this as any).processWorkerHours === 'function') {
              try {
                await (this as any).processWorkerHours(existingWorker.id, row, wizard);
              } catch (err: any) {
                hoursProcessed = false;
                hoursError = err.message || 'Hours processing failed';
              }
            }

            // Process worker contact info if this wizard type supports it (for gbhet_legal_workers wizards)
            if (typeof (this as any).processWorkerContactInfo === 'function') {
              try {
                await (this as any).processWorkerContactInfo(existingWorker.id, row);
              } catch (err: any) {
                contactInfoProcessed = false;
                contactInfoError = err.message || 'Contact info processing failed';
              }
            }

            updatedCount++;
            const processingIssues: string[] = [];
            if (!hoursProcessed) processingIssues.push(`hours: ${hoursError}`);
            if (!contactInfoProcessed) processingIssues.push(`contact info: ${contactInfoError}`);
            
            rowResults.push({
              rowIndex,
              status: 'success',
              message: processingIssues.length === 0 ? 'Worker updated' : `Worker updated (issues: ${processingIssues.join('; ')})`
            });
            
            if (onProgress) {
              onProgress({
                processed: rowIndex + 1,
                total: totalRows,
                createdCount,
                updatedCount,
                successCount: createdCount + updatedCount,
                failureCount,
                currentRow: { index: rowIndex, status: 'success' }
              });
            }

          } else {
            // Create mode: upsert behavior (update if SSN exists, create if not)
            // SSN is REQUIRED for all workers in feed
            if (!ssn) {
              throw new Error('SSN is required for all workers in the feed');
            }

            if (!firstName && !lastName) {
              throw new Error('First name or last name is required');
            }

            let workerId: string;
            let isNewWorker = false;
            
            // Check if worker with this SSN already exists
            const existingWorker = await storage.workers.getWorkerBySSN(ssn);
            if (existingWorker) {
              // Worker exists, update it
              workerId = existingWorker.id;
            } else {
              // Worker doesn't exist, create new one
              const fullName = [firstName, lastName].filter(Boolean).join(' ');
              const newWorker = await storage.workers.createWorker(fullName);
              workerId = newWorker.id;
              // Set SSN for the new worker
              await storage.workers.updateWorkerSSN(workerId, ssn);
              isNewWorker = true;
            }

            // Update name components if provided
            if (firstName || lastName) {
              await storage.workers.updateWorkerContactNameComponents(workerId, {
                given: firstName || undefined,
                family: lastName || undefined
              });
            }

            // Update birth date if provided
            if (birthDate) {
              await storage.workers.updateWorkerContactBirthDate(workerId, birthDate);
            }

            let hoursProcessed = true;
            let hoursError: string | undefined;
            let contactInfoProcessed = true;
            let contactInfoError: string | undefined;

            // Process worker hours if this wizard type supports it (for gbhet_legal_workers wizards)
            if (typeof (this as any).processWorkerHours === 'function') {
              try {
                await (this as any).processWorkerHours(workerId, row, wizard);
              } catch (err: any) {
                hoursProcessed = false;
                hoursError = err.message || 'Hours processing failed';
              }
            }

            // Process worker contact info if this wizard type supports it (for gbhet_legal_workers wizards)
            if (typeof (this as any).processWorkerContactInfo === 'function') {
              try {
                await (this as any).processWorkerContactInfo(workerId, row);
              } catch (err: any) {
                contactInfoProcessed = false;
                contactInfoError = err.message || 'Contact info processing failed';
              }
            }

            // Increment appropriate counter and add row result
            if (isNewWorker) {
              createdCount++;
            } else {
              updatedCount++;
            }

            const workerAction = isNewWorker ? 'created' : 'updated';
            const processingIssues: string[] = [];
            if (!hoursProcessed) processingIssues.push(`hours: ${hoursError}`);
            if (!contactInfoProcessed) processingIssues.push(`contact info: ${contactInfoError}`);
            
            rowResults.push({
              rowIndex,
              status: 'success',
              message: processingIssues.length === 0 ? `Worker ${workerAction}` : `Worker ${workerAction} (issues: ${processingIssues.join('; ')})`
            });

            if (onProgress) {
              onProgress({
                processed: rowIndex + 1,
                total: totalRows,
                createdCount,
                updatedCount,
                successCount: createdCount + updatedCount,
                failureCount,
                currentRow: { index: rowIndex, status: 'success' }
              });
            }
          }

        } catch (error: any) {
          failureCount++;
          const errorMessage = error.message || 'Unknown error';
          
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

          if (onProgress) {
            onProgress({
              processed: rowIndex + 1,
              total: totalRows,
              createdCount,
              updatedCount,
              successCount: createdCount + updatedCount,
              failureCount,
              currentRow: { 
                index: rowIndex, 
                status: 'error',
                error: errorMessage
              }
            });
          }
        }
      }
    }

    // Generate results CSV file
    let resultsFileId: string | undefined;
    try {
      resultsFileId = await this.generateResultsCsv(wizardId, file, rawRows, hasHeaders, rowResults);
    } catch (csvError) {
      console.error('Failed to generate results CSV:', csvError);
      // Continue without results file - don't fail the whole process
    }

    const results: ProcessResults = {
      totalRows,
      createdCount,
      updatedCount,
      successCount: createdCount + updatedCount,
      failureCount,
      errors: allErrors,
      rowResults,
      resultsFileId,
      completedAt: new Date()
    };

    // Save processing results to wizard data
    await storage.wizards.update(wizardId, {
      data: {
        ...wizardData,
        processResults: results
      }
    });

    return results;
  }

  /**
   * Generate a results CSV file with Status and Message columns
   * @param wizardId The wizard instance ID
   * @param originalFile The original uploaded file
   * @param rawRows The raw rows from the original file
   * @param hasHeaders Whether the file has headers
   * @param rowResults The processing results for each row
   * @returns The file ID of the generated results CSV
   */
  private async generateResultsCsv(
    wizardId: string,
    originalFile: File,
    rawRows: any[],
    hasHeaders: boolean,
    rowResults: RowResult[]
  ): Promise<string> {
    // Create lookup map for row results (data rows are 0-indexed)
    const resultsMap = new Map<number, RowResult>();
    rowResults.forEach(result => {
      resultsMap.set(result.rowIndex, result);
    });

    // Prepare output rows
    const outputRows: any[][] = [];

    // Add header row with Status and Message columns
    if (hasHeaders && rawRows.length > 0) {
      const headerRow = rawRows[0];
      outputRows.push([...headerRow, 'Status', 'Message']);
    } else {
      // No headers - just add Status and Message column labels
      if (rawRows.length > 0) {
        const firstRow = rawRows[0];
        const headers = firstRow.map((_: any, i: number) => `Column ${i + 1}`);
        outputRows.push([...headers, 'Status', 'Message']);
      }
    }

    // Add data rows with status and message
    const dataStartIndex = hasHeaders ? 1 : 0;
    for (let i = dataStartIndex; i < rawRows.length; i++) {
      const dataRowIndex = i - dataStartIndex; // 0-indexed data row
      const originalRow = rawRows[i];
      const result = resultsMap.get(dataRowIndex);
      
      if (result) {
        outputRows.push([
          ...originalRow,
          result.status === 'success' ? 'success' : 'error',
          result.message
        ]);
      } else {
        // Row wasn't processed (shouldn't happen, but handle gracefully)
        outputRows.push([
          ...originalRow,
          'unknown',
          'Not processed'
        ]);
      }
    }

    // Convert to CSV
    const csvContent = stringifyCSV(outputRows);
    const csvBuffer = Buffer.from(csvContent, 'utf-8');

    // Generate filename
    const baseName = originalFile.fileName.replace(/\.[^.]+$/, ''); // Remove extension
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const resultsFileName = `${baseName}-results-${timestamp}.csv`;

    // Upload to object storage in same folder as wizard attachments
    const customPath = `wizards/${wizardId}/${Date.now()}_${resultsFileName}`;
    const uploadResult = await objectStorageService.uploadFile({
      fileName: resultsFileName,
      fileContent: csvBuffer,
      mimeType: 'text/csv',
      accessLevel: 'private',
      customPath
    });

    // Use the same uploadedBy as the original file
    const uploadedBy = originalFile.uploadedBy;

    // Create file record attached to wizard
    const resultsFile = await storage.files.create({
      fileName: resultsFileName,
      mimeType: 'text/csv',
      size: uploadResult.size,
      storagePath: uploadResult.storagePath,
      uploadedBy,
      entityType: 'wizard',
      entityId: wizardId,
      accessLevel: 'private'
    });

    return resultsFile.id;
  }

  getSteps(): WizardStep[] {
    return [
      { id: 'upload', name: 'Upload', description: 'Upload data file' },
      { id: 'map', name: 'Map', description: 'Map columns to fields' },
      { id: 'configure', name: 'Configure Feed', description: 'Set feed parameters and filters' },
      { id: 'generate', name: 'Generate Data', description: 'Generate the feed data' },
      { id: 'review', name: 'Review Output', description: 'Review generated feed' },
      { id: 'complete', name: 'Complete', description: 'Feed generation complete' }
    ];
  }

  getStatuses(): WizardStatus[] {
    return [
      ...createStandardStatuses(),
      { id: 'generating', name: 'Generating', description: 'Feed data is being generated' },
      { id: 'ready', name: 'Ready', description: 'Feed is ready for download' }
    ];
  }

  async generateFeed(config: FeedConfig, data: any): Promise<FeedData> {
    throw new Error('generateFeed must be implemented by subclass');
  }

  async validateConfig(config: FeedConfig): Promise<{ valid: boolean; errors?: string[] }> {
    const errors: string[] = [];

    if (config.dateRange) {
      if (config.dateRange.start > config.dateRange.end) {
        errors.push('Start date must be before end date');
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  formatOutputFilename(baseName: string, format: string = 'csv'): string {
    const timestamp = new Date().toISOString().split('T')[0];
    return `${baseName}_${timestamp}.${format}`;
  }

  async getRecordCount(filters?: Record<string, any>): Promise<number> {
    return 0;
  }

  serializeToCSV(records: any[], headers?: string[]): string {
    if (records.length === 0) return '';

    const allHeaders = headers || Object.keys(records[0]);
    const csvHeaders = allHeaders.join(',');
    
    const csvRows = records.map(record => {
      return allHeaders.map(header => {
        const value = record[header];
        if (value === null || value === undefined) return '';
        if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      }).join(',');
    });

    return [csvHeaders, ...csvRows].join('\n');
  }

  serializeToJSON(records: any[]): string {
    return JSON.stringify(records, null, 2);
  }

  /**
   * Associate an uploaded file with this wizard instance
   * @param wizardId The wizard instance ID
   * @param fileData File metadata to create
   * @returns The created file record
   */
  async associateFile(wizardId: string, fileData: InsertFile): Promise<File> {
    // Validate file type for spreadsheets
    const allowedMimeTypes = [
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
    
    if (fileData.mimeType && !allowedMimeTypes.includes(fileData.mimeType)) {
      throw new Error('Invalid file type. Only CSV and XLSX files are supported.');
    }

    // Normalize metadata to handle null/string cases
    const existingMetadata = typeof fileData.metadata === 'object' && fileData.metadata !== null 
      ? fileData.metadata 
      : {};

    // Create the file record with wizard association
    const file = await storage.files.create({
      fileName: fileData.fileName,
      storagePath: fileData.storagePath,
      mimeType: fileData.mimeType,
      size: fileData.size,
      uploadedBy: fileData.uploadedBy,
      entityType: fileData.entityType,
      entityId: fileData.entityId,
      accessLevel: fileData.accessLevel,
      metadata: {
        ...existingMetadata,
        wizardId
      }
    });

    // Update wizard data to store the file ID
    const wizard = await storage.wizards.getById(wizardId);
    if (wizard) {
      const wizardData = typeof wizard.data === 'object' && wizard.data !== null 
        ? wizard.data as any
        : {};
      
      // Clear all downstream step data when a new file is uploaded
      const updatedData: any = {
        ...wizardData,
        uploadedFileId: file.id
      };
      
      // Clear map step data
      delete updatedData.columnMapping;
      delete updatedData.hasHeaders;
      
      // Clear validate step data
      delete updatedData.validationResults;
      
      // Clear progress for downstream steps
      if (updatedData.progress) {
        delete updatedData.progress.map;
        delete updatedData.progress.validate;
        delete updatedData.progress.process;
        delete updatedData.progress.review;
      }
      
      await storage.wizards.update(wizardId, {
        data: updatedData
      });
    }

    return file;
  }

  /**
   * Get all files associated with a wizard instance
   * @param wizardId The wizard instance ID
   * @returns Array of file records
   */
  async getAssociatedFiles(wizardId: string): Promise<File[]> {
    const allFiles = await storage.files.list();
    return allFiles.filter((file) => {
      const metadata = file.metadata as any;
      return metadata?.wizardId === wizardId;
    });
  }

  /**
   * Delete a file associated with a wizard instance
   * @param fileId The file ID to delete
   * @param wizardId The wizard instance ID for verification
   */
  async deleteAssociatedFile(fileId: string, wizardId: string): Promise<boolean> {
    const file = await storage.files.getById(fileId);
    
    if (!file) {
      return false;
    }

    const metadata = file.metadata as any;
    if (metadata?.wizardId !== wizardId) {
      throw new Error('File is not associated with this wizard');
    }

    // Delete from database (storage middleware handles object storage cleanup)
    const deleted = await storage.files.delete(fileId);
    
    if (deleted) {
      // Update wizard data to remove the file ID
      const wizard = await storage.wizards.getById(wizardId);
      if (wizard) {
        const wizardData = typeof wizard.data === 'object' && wizard.data !== null 
          ? wizard.data as any
          : {};
        
        if (wizardData.uploadedFileId === fileId) {
          await storage.wizards.update(wizardId, {
            data: {
              ...wizardData,
              uploadedFileId: undefined
            }
          });
        }
      }
    }

    return deleted;
  }
}

export function createMonthlyDateRange(year: number, month: number): { start: Date; end: Date } {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  return { start, end };
}

export function getCurrentMonth(): { year: number; month: number } {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1
  };
}

export function formatMonthYear(year: number, month: number): string {
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return `${monthNames[month - 1]} ${year}`;
}
