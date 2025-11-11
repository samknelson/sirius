import { UploadStep } from './gbhet-legal-workers/UploadStep';
import { MapStep } from './gbhet-legal-workers/MapStep';
import { ValidateStep } from './gbhet-legal-workers/ValidateStep';
import { ProcessStep } from './gbhet-legal-workers/ProcessStep';
import { ReviewStep } from './gbhet-legal-workers/ReviewStep';

export interface WizardStepComponent {
  (props: { wizardId: string; data?: any; onDataChange?: (data: any) => void }): JSX.Element;
}

type StepComponentRegistry = {
  [wizardType: string]: {
    [stepId: string]: WizardStepComponent;
  };
};

export const stepComponentRegistry: StepComponentRegistry = {
  'gbhet_legal_workers_monthly': {
    'upload': UploadStep,
    'map': MapStep,
    'validate': ValidateStep,
    'process': ProcessStep,
    'review': ReviewStep,
  },
  'gbhet_legal_workers_corrections': {
    'upload': UploadStep,
    'map': MapStep,
    'validate': ValidateStep,
    'process': ProcessStep,
    'review': ReviewStep,
  },
};

export function getStepComponent(wizardType: string, stepId: string): WizardStepComponent | null {
  return stepComponentRegistry[wizardType]?.[stepId] || null;
}
