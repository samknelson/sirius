import { wizardRegistry } from './registry.js';
import { gbhetLegalWorkersMonthly } from './types/gbhet_legal_workers_monthly.js';
import { gbhetLegalWorkersCorrections } from './types/gbhet_legal_workers_corrections.js';
import { ReportWorkersMissingSSN } from './types/report_workers_missing_ssn.js';
import { ReportWorkersInvalidSSN } from './types/report_workers_invalid_ssn.js';
import { ReportWorkersDuplicateSSN } from './types/report_workers_duplicate_ssn.js';

wizardRegistry.register(gbhetLegalWorkersMonthly);
wizardRegistry.register(gbhetLegalWorkersCorrections);
wizardRegistry.register(new ReportWorkersMissingSSN());
wizardRegistry.register(new ReportWorkersInvalidSSN());
wizardRegistry.register(new ReportWorkersDuplicateSSN());

export { wizardRegistry, getWizardType, getAllWizardTypes, registerWizardType } from './registry.js';
export { BaseWizard, type WizardTypeDefinition, type WizardStep, type WizardStatus } from './base.js';
export { FeedWizard, type FeedConfig, type FeedData } from './feed.js';
export { WizardReport, type ReportConfig, type ReportData } from './report.js';
