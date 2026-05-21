import { BaseWizard, createStandardStatuses, type WizardStep, type WizardStatus } from '../base.js';

export class EmployerOnboardingWizard extends BaseWizard {
  name = 'employer_onboarding';
  displayName = 'Employer Onboarding';
  description = 'Create and configure a new employer with contacts, benefits, and initial worker load';
  isFeed = false;
  isMonthly = false;
  category = 'onboarding';

  getSteps(): WizardStep[] {
    return [
      { id: 'employer_name', name: 'Employer Name', description: 'Enter the employer name' },
      { id: 'attributes', name: 'Attributes', description: 'Set employer type, industry, and benefit funds' },
      { id: 'contacts', name: 'Contacts', description: 'Add employer contacts and optionally promote to users' },
      { id: 'worker_load', name: 'Worker Load', description: 'Create the employer and load initial workers via GBHET Legal wizard' },
      { id: 'review', name: 'Review', description: 'Review everything created during onboarding' },
    ];
  }

  getStatuses(): WizardStatus[] {
    return createStandardStatuses();
  }
}

export const employerOnboarding = new EmployerOnboardingWizard();
