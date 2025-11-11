import { FeedWizard } from '../feed.js';
import { WizardStatus, WizardStep } from '../base.js';

export abstract class GbhetLegalWorkersWizard extends FeedWizard {
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
