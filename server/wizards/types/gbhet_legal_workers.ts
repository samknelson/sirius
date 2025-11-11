import { FeedWizard, FeedField, ValidationError } from '../feed.js';
import { WizardStatus, WizardStep } from '../base.js';
import { storage } from '../../storage/index.js';

/**
 * Preprocess SSN value to normalize format
 * - Removes all non-digit characters
 * - Prepends zeros if needed to make it 9 digits
 * - Formats as XXX-XX-XXXX
 * - Returns null if the result doesn't look like a valid SSN
 */
function preprocessSSN(value: any): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  // Convert to string and remove all non-digit characters
  const digitsOnly = String(value).replace(/\D/g, '');
  
  // If empty after removing non-digits, return null
  if (digitsOnly.length === 0) {
    return null;
  }
  
  // If more than 9 digits, it's invalid
  if (digitsOnly.length > 9) {
    return null;
  }
  
  // Prepend zeros to make it 9 digits
  const paddedSSN = digitsOnly.padStart(9, '0');
  
  // Format as XXX-XX-XXXX
  return `${paddedSSN.substring(0, 3)}-${paddedSSN.substring(3, 5)}-${paddedSSN.substring(5, 9)}`;
}

export abstract class GbhetLegalWorkersWizard extends FeedWizard {
  entityType = 'employer';

  /**
   * Get the field definitions for the GBHET Legal Workers feed
   */
  getFields(): FeedField[] {
    return [
      { 
        id: 'ssn', 
        name: 'SSN', 
        type: 'string', 
        required: true, // Always required
        description: 'Social Security Number',
        format: 'ssn',
        pattern: '^\\d{3}-\\d{2}-\\d{4}$',
        displayOrder: 1
      },
      { 
        id: 'firstName', 
        name: 'First Name', 
        type: 'string', 
        required: false, // Not always required
        requiredForCreate: true, // Required only when creating new records
        description: 'Worker first name',
        maxLength: 100,
        displayOrder: 2
      },
      { 
        id: 'middleName', 
        name: 'Middle Name', 
        type: 'string', 
        required: false,
        description: 'Worker middle name (optional)',
        maxLength: 100,
        displayOrder: 3
      },
      { 
        id: 'lastName', 
        name: 'Last Name', 
        type: 'string', 
        required: false, // Not always required
        requiredForCreate: true, // Required only when creating new records
        description: 'Worker last name',
        maxLength: 100,
        displayOrder: 4
      },
      { 
        id: 'dateOfBirth', 
        name: 'Date of Birth', 
        type: 'date', 
        required: false, // Not always required
        requiredForCreate: true, // Required only when creating new records
        description: 'Worker date of birth',
        format: 'date',
        displayOrder: 5
      },
      { 
        id: 'employmentStatus', 
        name: 'Employment Status', 
        type: 'string', 
        required: true, // Always required
        description: 'Current employment status',
        displayOrder: 6
      },
      { 
        id: 'numberOfHours', 
        name: 'Number of Hours', 
        type: 'number', 
        required: true, // Always required
        description: 'Number of hours worked',
        displayOrder: 7
      }
    ];
  }

  getSteps(): WizardStep[] {
    return [
      { id: 'upload', name: 'Upload', description: 'Upload data file' },
      { id: 'map', name: 'Map', description: 'Map fields to schema' },
      { id: 'validate', name: 'Validate', description: 'Validate data integrity' },
      { id: 'process', name: 'Process', description: 'Process and transform data' },
      { id: 'review', name: 'Review', description: 'Review results' }
    ];
  }

  getStatuses(): WizardStatus[] {
    return [
      { id: 'draft', name: 'Draft', description: 'Initial draft state' },
      { id: 'complete', name: 'Complete', description: 'Feed generation complete' }
    ];
  }

  async getRecordCount(filters?: Record<string, any>): Promise<number> {
    return 0;
  }

  protected async fetchWorkerData(filters: Record<string, any>): Promise<any[]> {
    return [];
  }

  protected validatePeriod(year: number, month: number): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];
    
    if (year < 2000 || year > 2100) {
      errors.push('Year must be between 2000 and 2100');
    }
    
    if (month < 1 || month > 12) {
      errors.push('Month must be between 1 and 12');
    }
    
    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  /**
   * Override validateRow to preprocess SSN and add worker existence check for update mode
   */
  async validateRow(row: Record<string, any>, rowIndex: number, mode: 'create' | 'update'): Promise<ValidationError[]> {
    // Preprocess SSN if present
    if (row.ssn !== undefined && row.ssn !== null) {
      const preprocessed = preprocessSSN(row.ssn);
      
      // If preprocessing fails (returns null), keep original value so parent validation catches it
      if (preprocessed !== null) {
        row.ssn = preprocessed;
      }
    }
    
    // Call parent validation to get standard field validation errors
    const errors = await super.validateRow(row, rowIndex, mode);
    
    // For update mode, verify that a worker with the given SSN exists
    if (mode === 'update') {
      const ssn = row.ssn;
      
      // Only check if SSN is present and passed format validation
      if (ssn && !errors.some(e => e.field === 'ssn')) {
        const existingWorker = await storage.workers.getWorkerBySSN(ssn);
        
        if (!existingWorker) {
          errors.push({
            rowIndex,
            field: 'ssn',
            message: 'Worker with this SSN does not exist',
            value: ssn
          });
        }
      }
    }
    
    return errors;
  }
}
