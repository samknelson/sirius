import { BaseWizard } from '../base.js';
import { WizardStatus, WizardStep, createStandardStatuses, LaunchArgument } from '../base.js';

export class BtuCardcheckScrapeImportWizard extends BaseWizard {
  name = 'btu_cardcheck_scrape_import';
  displayName = 'BTU Card Check Scraper Import';
  description = 'Automatically scrape and import signed card checks from the external BTU site';
  isFeed = false;
  entityType = undefined;
  requiredComponent = 'sitespecific.btu';

  getSteps(): WizardStep[] {
    return [
      { id: 'configure', name: 'Configure', description: 'Select the card check definition' },
      { id: 'scrape', name: 'Scrape', description: 'Scrape signed card checks from external site' },
      { id: 'preview', name: 'Preview', description: 'Review matched and unmatched workers' },
      { id: 'process', name: 'Process', description: 'Generate PDFs and create records' },
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
