import { FeedWizard, FeedField } from '../feed.js';
import { WizardStatus, WizardStep } from '../base.js';

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
}
