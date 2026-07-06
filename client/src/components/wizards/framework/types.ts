export type WizardStepState =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed";

export interface WizardStepManifest {
  id: string;
  name: string;
  description?: string;
  kind: string;
  schema?: any;
  uiSchema?: Record<string, unknown>;
  /** Fully-qualified "<wizardType>:<ComponentName>" for the escape hatch. */
  component?: string;
  state: WizardStepState;
  requiredComponent?: string;
  requiredPolicy?: string;
  progress?: {
    status?: string;
    percentComplete?: number;
    error?: string;
  };
}

export interface WizardManifest {
  wizardType: string;
  displayName: string;
  description: string;
  isReport: boolean;
  currentStep: string;
  steps: WizardStepManifest[];
}

/**
 * Props handed to an escape-hatch wizard step component (auto-discovered
 * via the client component registry). The default path — a `form` step
 * rendered by SchemaForm — never touches this.
 */
export interface WizardStepComponentProps {
  wizardId: string;
  wizardType: string;
  step: WizardStepManifest;
  data?: any;
}
