import { BaseWizard } from '../base.js';
import { WizardStatus, WizardStep, createStandardStatuses, LaunchArgument } from '../base.js';

export class BtuCardcheckScrapeImportWizard extends BaseWizard {
  name = 'btu_cardcheck_scrape_import';
  displayName = 'BTU Card Check Scraper Import';
  description = 'Fetch PDF signatures from the external BTU site for card checks that have a NID but are missing a signature';
  isFeed = false;
  entityType = undefined;
  requiredComponent = 'sitespecific.btu';

  getSteps(): WizardStep[] {
    return [
      { id: 'configure', name: 'Configure', description: 'Select the card check definition' },
      { id: 'process', name: 'Process', description: 'Fetch PDFs and create e-signatures' },
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

export const btuCardcheckScrapeImport = new BtuCardcheckScrapeImportWizard();
