import { wizardRegistry } from './registry.js';
import { gbhetLegalWorkersMonthly } from './types/gbhet_legal_workers_monthly.js';
import { gbhetLegalWorkersCorrections } from './types/gbhet_legal_workers_corrections.js';
// Report wizards (missing/invalid/duplicate SSN, employer users, ledger
// integrity, BTU invalid cardcheck) now live in the plugin framework under
// server/plugins/wizards/plugins/. The legacy report classes in ./types are
// reused by those plugins but are no longer registered on the legacy
// wizardRegistry.
import { btuWorkerImport } from './types/btu_worker_import.js';
import { btuDuesAllocation } from './types/btu_dues_allocation.js';
import { btuCardcheckImport } from './types/btu_cardcheck_import.js';
import { btuCardcheckSigImport } from './types/btu_cardcheck_sig_import.js';
import { btuCardcheckScrapeImport } from './types/btu_cardcheck_scrape_import.js';
import { btuBuildingRepImport } from './types/btu_building_rep_import.js';
import { htaUnionImport } from './types/hta_union_import.js';
import { employerOnboarding } from './types/employer_onboarding.js';

wizardRegistry.register(gbhetLegalWorkersMonthly);
wizardRegistry.register(gbhetLegalWorkersCorrections);
wizardRegistry.register(btuWorkerImport);
wizardRegistry.register(btuDuesAllocation);
wizardRegistry.register(btuCardcheckImport);
wizardRegistry.register(btuCardcheckSigImport);
wizardRegistry.register(btuCardcheckScrapeImport);
wizardRegistry.register(btuBuildingRepImport);
wizardRegistry.register(htaUnionImport);
wizardRegistry.register(employerOnboarding);

export { wizardRegistry, getWizardType, getAllWizardTypes, registerWizardType } from './registry.js';
export { BaseWizard, type WizardTypeDefinition, type WizardStep, type WizardStatus } from './base.js';
export { FeedWizard, type FeedConfig, type FeedData } from './feed.js';
export { WizardReport, type ReportConfig, type ReportData } from './report.js';
