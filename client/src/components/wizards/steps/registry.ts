import { UploadStep } from './gbhet-legal-workers/UploadStep';
import { MapStep } from './gbhet-legal-workers/MapStep';
import { BenefitsStep } from './gbhet-legal-workers/BenefitsStep';
import { ValidateStep } from './gbhet-legal-workers/ValidateStep';
import { ProcessStep } from './gbhet-legal-workers/ProcessStep';
import { ReviewStep } from './gbhet-legal-workers/ReviewStep';
import { ConfigureStep as BTUConfigureStep } from './btu-worker-import/ConfigureStep';
import { ProcessStep as BTUProcessStep } from './btu-worker-import/ProcessStep';
import { ResultsStep as BTUResultsStep } from './btu-worker-import/ResultsStep';
import { ProcessStep as BTUDuesProcessStep } from './btu-dues-allocation/ProcessStep';
import { ResultsStep as BTUDuesResultsStep } from './btu-dues-allocation/ResultsStep';
import { ConfigureStep as BTUCardcheckConfigureStep } from './btu-cardcheck-import/ConfigureStep';
import { ProcessStep as BTUCardcheckProcessStep } from './btu-cardcheck-import/ProcessStep';
import { ResultsStep as BTUCardcheckResultsStep } from './btu-cardcheck-import/ResultsStep';

export interface WizardStepComponent {
  (props: { wizardId: string; wizardType: string; data?: any; onDataChange?: (data: any) => void }): JSX.Element;
}

export interface StepCompletionEvaluator {
  (context: { wizard: any; files?: any[]; fields?: any[] }): boolean;
}

export interface StepController {
  Component: WizardStepComponent;
  evaluateCompletion: StepCompletionEvaluator;
}

type StepComponentRegistry = {
  [wizardType: string]: {
    [stepId: string]: WizardStepComponent;
  };
};

type StepControllerRegistry = {
  [wizardType: string]: {
    [stepId: string]: StepController;
  };
};

const evaluateUploadComplete: StepCompletionEvaluator = ({ wizard, files }) => {
  return !!wizard?.data?.uploadedFileId && (files?.length ?? 0) > 0;
};

const evaluateMapComplete: StepCompletionEvaluator = ({ wizard, fields }) => {
  const mode = wizard?.data?.mode || 'create';
  const columnMapping = wizard?.data?.columnMapping || {};
  
  if (!fields || fields.length === 0) return false;
  
  const requiredFields = fields.filter((f: any) => {
    if (f.required) return true;
    if (mode === 'create' && f.requiredForCreate) return true;
    if (mode === 'update' && f.requiredForUpdate) return true;
    return false;
  });
  
  if (requiredFields.length === 0) return true;
  
  const keys = Object.keys(columnMapping);
  const isOldFormat = keys.length > 0 && keys.every(k => k.startsWith('col_'));

  if (isOldFormat) {
    const mappedFieldIds = Object.values(columnMapping).filter(v => v && v !== '_unmapped');
    const mappedRequiredFields = requiredFields.filter((f: any) => mappedFieldIds.includes(f.id));
    return requiredFields.length === mappedRequiredFields.length;
  }

  const mappedRequiredFields = requiredFields.filter((f: any) => {
    const colValue = columnMapping[f.id];
    return colValue && colValue !== '_unmapped';
  });
  return requiredFields.length === mappedRequiredFields.length;
};

const evaluateValidateComplete: StepCompletionEvaluator = ({ wizard }) => {
  const validationResults = wizard?.data?.validationResults;
  
  if (!validationResults) return false;
  
  if (validationResults.unmappedStatuses && validationResults.unmappedStatuses.length > 0) {
    return false;
  }
  
  return validationResults.invalidRows === 0;
};

const alwaysComplete: StepCompletionEvaluator = () => true;

const evaluateConfigureComplete: StepCompletionEvaluator = ({ wizard }) => {
  return !!wizard?.data?.asOfDate;
};

const evaluateCardcheckConfigureComplete: StepCompletionEvaluator = ({ wizard }) => {
  return !!wizard?.data?.cardcheckDefinitionId;
};

const evaluateValidateCompleteSkipInvalid: StepCompletionEvaluator = ({ wizard }) => {
  const validationResults = wizard?.data?.validationResults;
  if (!validationResults) return false;
  return validationResults.validRows > 0;
};

export const stepControllerRegistry: StepControllerRegistry = {
  'gbhet_legal_workers_monthly': {
    'upload': { Component: UploadStep, evaluateCompletion: evaluateUploadComplete },
    'map': { Component: MapStep, evaluateCompletion: evaluateMapComplete },
    'benefits': { Component: BenefitsStep, evaluateCompletion: alwaysComplete },
    'validate': { Component: ValidateStep, evaluateCompletion: evaluateValidateComplete },
    'process': { Component: ProcessStep, evaluateCompletion: alwaysComplete },
    'review': { Component: ReviewStep, evaluateCompletion: alwaysComplete },
  },
  'gbhet_legal_workers_corrections': {
    'upload': { Component: UploadStep, evaluateCompletion: evaluateUploadComplete },
    'map': { Component: MapStep, evaluateCompletion: evaluateMapComplete },
    'benefits': { Component: BenefitsStep, evaluateCompletion: alwaysComplete },
    'validate': { Component: ValidateStep, evaluateCompletion: evaluateValidateComplete },
    'process': { Component: ProcessStep, evaluateCompletion: alwaysComplete },
    'review': { Component: ReviewStep, evaluateCompletion: alwaysComplete },
  },
  'btu_worker_import': {
    'upload': { Component: UploadStep, evaluateCompletion: evaluateUploadComplete },
    'map': { Component: MapStep, evaluateCompletion: evaluateMapComplete },
    'configure': { Component: BTUConfigureStep, evaluateCompletion: evaluateConfigureComplete },
    'validate': { Component: ValidateStep, evaluateCompletion: evaluateValidateComplete },
    'process': { Component: BTUProcessStep, evaluateCompletion: alwaysComplete },
    'results': { Component: BTUResultsStep, evaluateCompletion: alwaysComplete },
  },
  'btu_dues_allocation': {
    'upload': { Component: UploadStep, evaluateCompletion: evaluateUploadComplete },
    'map': { Component: MapStep, evaluateCompletion: evaluateMapComplete },
    'validate': { Component: ValidateStep, evaluateCompletion: evaluateValidateComplete },
    'process': { Component: BTUDuesProcessStep, evaluateCompletion: alwaysComplete },
    'results': { Component: BTUDuesResultsStep, evaluateCompletion: alwaysComplete },
  },
  'btu_cardcheck_import': {
    'upload': { Component: UploadStep, evaluateCompletion: evaluateUploadComplete },
    'map': { Component: MapStep, evaluateCompletion: evaluateMapComplete },
    'configure': { Component: BTUCardcheckConfigureStep, evaluateCompletion: evaluateCardcheckConfigureComplete },
    'validate': { Component: ValidateStep, evaluateCompletion: evaluateValidateCompleteSkipInvalid },
    'process': { Component: BTUCardcheckProcessStep, evaluateCompletion: alwaysComplete },
    'results': { Component: BTUCardcheckResultsStep, evaluateCompletion: alwaysComplete },
  },
};

export const stepComponentRegistry: StepComponentRegistry = {
  'gbhet_legal_workers_monthly': {
    'upload': UploadStep,
    'map': MapStep,
    'benefits': BenefitsStep,
    'validate': ValidateStep,
    'process': ProcessStep,
    'review': ReviewStep,
  },
  'gbhet_legal_workers_corrections': {
    'upload': UploadStep,
    'map': MapStep,
    'benefits': BenefitsStep,
    'validate': ValidateStep,
    'process': ProcessStep,
    'review': ReviewStep,
  },
  'btu_worker_import': {
    'upload': UploadStep,
    'map': MapStep,
    'configure': BTUConfigureStep,
    'validate': ValidateStep,
    'process': BTUProcessStep,
    'results': BTUResultsStep,
  },
  'btu_dues_allocation': {
    'upload': UploadStep,
    'map': MapStep,
    'validate': ValidateStep,
    'process': BTUDuesProcessStep,
    'results': BTUDuesResultsStep,
  },
  'btu_cardcheck_import': {
    'upload': UploadStep,
    'map': MapStep,
    'configure': BTUCardcheckConfigureStep,
    'validate': ValidateStep,
    'process': BTUCardcheckProcessStep,
    'results': BTUCardcheckResultsStep,
  },
};

export function getStepComponent(wizardType: string, stepId: string): WizardStepComponent | null {
  return stepComponentRegistry[wizardType]?.[stepId] || null;
}

export function getStepController(wizardType: string, stepId: string): StepController | null {
  return stepControllerRegistry[wizardType]?.[stepId] || null;
}
