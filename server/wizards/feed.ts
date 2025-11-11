import { BaseWizard, WizardStep, WizardStatus, createStandardStatuses } from './base.js';
import { storage } from '../storage/index.js';
import type { InsertFile, File } from '@shared/schema';

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
}

export abstract class FeedWizard extends BaseWizard {
  isFeed: boolean = true;

  getSteps(): WizardStep[] {
    return [
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
