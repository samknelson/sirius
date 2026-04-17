import { BaseWizard } from '../base.js';
import { WizardStatus, WizardStep, createStandardStatuses, LaunchArgument } from '../base.js';

export class BtuBuildingRepImportWizard extends BaseWizard {
  name = 'btu_building_rep_import';
  displayName = 'BTU Building Rep Import';
  description = 'Import building representatives from a CSV file (Name, ID/Badge #, Phone, Email) and create shop steward assignments';
  isFeed = false;
  entityType = undefined;
  requiredComponent = 'sitespecific.btu';

  getSteps(): WizardStep[] {
    return [
      { id: 'upload', name: 'Upload', description: 'Upload a CSV file with building rep data' },
      { id: 'preview', name: 'Preview', description: 'Review matched and unmatched workers' },
      { id: 'process', name: 'Process', description: 'Create steward assignments' },
      { id: 'results', name: 'Results', description: 'Review import results' },
    ];
  }

  getStatuses(): WizardStatus[] {
    return createStandardStatuses();
  }

  getLaunchArguments(): LaunchArgument[] {
    return [];
  }
}

export const btuBuildingRepImport = new BtuBuildingRepImportWizard();
