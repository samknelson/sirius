export interface WizardStep {
  id: string;
  name: string;
  description?: string;
}

export interface Wizard {
  id: string;
  date: string;
  type: string;
  status: string;
  currentStep?: string | null;
  entityId: string | null;
  data: any;
}

export interface WizardType {
  name: string;
  displayName: string;
  description?: string;
  isFeed?: boolean;
  isReport?: boolean;
  isMonthly?: boolean;
  entityType?: string;
  category?: string;
}

export interface WizardStatus {
  id: string;
  name: string;
  description?: string;
}
