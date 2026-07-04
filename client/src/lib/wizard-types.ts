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

/**
 * The standard wizard workflow statuses. Mirrors the server-side
 * `createStandardStatuses()` used by the BTU import wizards. Launcher pages
 * use it to render a status badge label without a per-type API call.
 */
export const standardWizardStatuses: WizardStatus[] = [
  { id: "draft", name: "Draft", description: "Initial state" },
  { id: "in_progress", name: "In Progress", description: "Wizard is actively being worked on" },
  { id: "completed", name: "Completed", description: "Wizard has been completed" },
  { id: "cancelled", name: "Cancelled", description: "Wizard was cancelled" },
  { id: "error", name: "Error", description: "An error occurred during processing" },
];
