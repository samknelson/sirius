import { BaseWizard } from '../base.js';
import { WizardStatus, WizardStep, createStandardStatuses, LaunchArgument } from '../base.js';

export class BtuCardcheckSigImportWizard extends BaseWizard {
  name = 'btu_cardcheck_sig_import';
  displayName = 'BTU Card Check Signature Import';
  description = 'Import signed card check signature images from a ZIP file, matching workers by BPS Employee ID';
  isFeed = false;
  entityType = undefined;
  requiredComponent = 'sitespecific.btu';

  getSteps(): WizardStep[] {
    return [
      { id: 'upload', name: 'Upload', description: 'Upload a ZIP file containing signature PDFs' },
      { id: 'configure', name: 'Configure', description: 'Select the card check definition' },
      { id: 'preview', name: 'Preview', description: 'Review matched and unmatched files' },
      { id: 'process', name: 'Process', description: 'Import signatures and create records' },
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

export const btuCardcheckSigImport = new BtuCardcheckSigImportWizard();
