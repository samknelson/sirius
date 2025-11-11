import { BaseWizard, WizardStep, WizardStatus, createStandardStatuses } from './base.js';
import { storage } from '../storage/index.js';
import type { InsertFile, File } from '@shared/schema';
import { parse as parseCSV } from 'csv-parse/sync';
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

      // Format validation
      if (field.format === 'ssn' && field.pattern) {
        const regex = new RegExp(field.pattern);
        if (!regex.test(String(value))) {
          errors.push({
            rowIndex,
            field: field.id,
            message: `${field.name} must match format XXX-XX-XXXX`,
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
          const colIndex = parseInt(sourceCol);
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
      
      await storage.wizards.update(wizardId, {
        data: {
          ...wizardData,
          uploadedFileId: file.id
        }
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
