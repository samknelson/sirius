import { UploadStep } from './gbhet-legal-workers/UploadStep';
import { MapStep } from './gbhet-legal-workers/MapStep';
import { BenefitsStep } from './gbhet-legal-workers/BenefitsStep';
import { ValidateStep } from './gbhet-legal-workers/ValidateStep';
import { ProcessStep } from './gbhet-legal-workers/ProcessStep';
import { ReviewStep } from './gbhet-legal-workers/ReviewStep';
import { InputsStep } from './report/InputsStep';
import { RunStep } from './report/RunStep';
import { ResultsStep } from './report/ResultsStep';
import { LedgerIntegrityInputsStep } from './report/LedgerIntegrityInputsStep';
import { GbhetLegalComplianceInputsStep } from './report/GbhetLegalComplianceInputsStep';
import { BTUWorkersInvalidCardcheckInputsStep } from './report/BTUWorkersInvalidCardcheckInputsStep';
import { ConfigureStep as BTUConfigureStep } from './btu-worker-import/ConfigureStep';
import { ProcessStep as BTUProcessStep } from './btu-worker-import/ProcessStep';
import { ResultsStep as BTUResultsStep } from './btu-worker-import/ResultsStep';
import { ConfigureStep as BTUDuesConfigureStep } from './btu-dues-allocation/ConfigureStep';
import { ProcessStep as BTUDuesProcessStep } from './btu-dues-allocation/ProcessStep';
import { ResultsStep as BTUDuesResultsStep } from './btu-dues-allocation/ResultsStep';

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
  
  // Get required fields based on mode
  const requiredFields = fields.filter((f: any) => {
    if (f.required) return true;
    if (mode === 'create' && f.requiredForCreate) return true;
    if (mode === 'update' && f.requiredForUpdate) return true;
    return false;
  });
  
  // If no required fields, consider the step complete (edge case)
  if (requiredFields.length === 0) return true;
  
  // Check if all required fields are mapped
  const mappedValues = Object.values(columnMapping).filter(v => v && v !== '_unmapped');
  const mappedRequiredFields = requiredFields.filter((f: any) => mappedValues.includes(f.id));
  
  return requiredFields.length === mappedRequiredFields.length;
};

const evaluateValidateComplete: StepCompletionEvaluator = ({ wizard }) => {
  const validationResults = wizard?.data?.validationResults;
  
  // Validation must have been run
  if (!validationResults) return false;
  
  // All rows must be valid (no invalid rows)
  return validationResults.invalidRows === 0;
};

const alwaysComplete: StepCompletionEvaluator = () => true;

const evaluateRunComplete: StepCompletionEvaluator = ({ wizard }) => {
  const progress = wizard?.data?.progress?.run;
  return progress?.status === 'completed';
};

const evaluateBTUInputsComplete: StepCompletionEvaluator = ({ wizard }) => {
  const cardcheckDefinitionId = wizard?.data?.config?.filters?.cardcheckDefinitionId;
  return !!cardcheckDefinitionId;
};

const evaluateConfigureComplete: StepCompletionEvaluator = ({ wizard }) => {
  return !!wizard?.data?.asOfDate;
};

const evaluateDuesConfigureComplete: StepCompletionEvaluator = ({ wizard }) => {
  return !!wizard?.data?.accountId;
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
  'report_workers_missing_ssn': {
    'inputs': { Component: InputsStep, evaluateCompletion: alwaysComplete },
    'run': { Component: RunStep, evaluateCompletion: evaluateRunComplete },
    'results': { Component: ResultsStep, evaluateCompletion: alwaysComplete },
  },
  'report_workers_invalid_ssn': {
    'inputs': { Component: InputsStep, evaluateCompletion: alwaysComplete },
    'run': { Component: RunStep, evaluateCompletion: evaluateRunComplete },
    'results': { Component: ResultsStep, evaluateCompletion: alwaysComplete },
  },
  'report_workers_duplicate_ssn': {
    'inputs': { Component: InputsStep, evaluateCompletion: alwaysComplete },
    'run': { Component: RunStep, evaluateCompletion: evaluateRunComplete },
    'results': { Component: ResultsStep, evaluateCompletion: alwaysComplete },
  },
  'report_employer_users': {
    'inputs': { Component: InputsStep, evaluateCompletion: alwaysComplete },
    'run': { Component: RunStep, evaluateCompletion: evaluateRunComplete },
    'results': { Component: ResultsStep, evaluateCompletion: alwaysComplete },
  },
  'report_ledger_integrity': {
    'inputs': { Component: LedgerIntegrityInputsStep, evaluateCompletion: alwaysComplete },
    'run': { Component: RunStep, evaluateCompletion: evaluateRunComplete },
    'results': { Component: ResultsStep, evaluateCompletion: alwaysComplete },
  },
  'report_gbhet_legal_compliance': {
    'inputs': { Component: GbhetLegalComplianceInputsStep, evaluateCompletion: alwaysComplete },
    'run': { Component: RunStep, evaluateCompletion: evaluateRunComplete },
    'results': { Component: ResultsStep, evaluateCompletion: alwaysComplete },
  },
  'report_btu_workers_invalid_cardcheck': {
    'inputs': { Component: BTUWorkersInvalidCardcheckInputsStep, evaluateCompletion: evaluateBTUInputsComplete },
    'run': { Component: RunStep, evaluateCompletion: evaluateRunComplete },
    'results': { Component: ResultsStep, evaluateCompletion: alwaysComplete },
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
    'configure': { Component: BTUDuesConfigureStep, evaluateCompletion: evaluateDuesConfigureComplete },
    'validate': { Component: ValidateStep, evaluateCompletion: evaluateValidateComplete },
    'process': { Component: BTUDuesProcessStep, evaluateCompletion: alwaysComplete },
    'results': { Component: BTUDuesResultsStep, evaluateCompletion: alwaysComplete },
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
  'report_workers_missing_ssn': {
    'inputs': InputsStep,
    'run': RunStep,
    'results': ResultsStep,
  },
  'report_workers_invalid_ssn': {
    'inputs': InputsStep,
    'run': RunStep,
    'results': ResultsStep,
  },
  'report_workers_duplicate_ssn': {
    'inputs': InputsStep,
    'run': RunStep,
    'results': ResultsStep,
  },
  'report_employer_users': {
    'inputs': InputsStep,
    'run': RunStep,
    'results': ResultsStep,
  },
  'report_ledger_integrity': {
    'inputs': LedgerIntegrityInputsStep,
    'run': RunStep,
    'results': ResultsStep,
  },
  'report_gbhet_legal_compliance': {
    'inputs': GbhetLegalComplianceInputsStep,
    'run': RunStep,
    'results': ResultsStep,
  },
  'report_btu_workers_invalid_cardcheck': {
    'inputs': BTUWorkersInvalidCardcheckInputsStep,
    'run': RunStep,
    'results': ResultsStep,
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
    'configure': BTUDuesConfigureStep,
    'validate': ValidateStep,
    'process': BTUDuesProcessStep,
    'results': BTUDuesResultsStep,
  },
};

export function getStepComponent(wizardType: string, stepId: string): WizardStepComponent | null {
  return stepComponentRegistry[wizardType]?.[stepId] || null;
}

export function getStepController(wizardType: string, stepId: string): StepController | null {
  return stepControllerRegistry[wizardType]?.[stepId] || null;
}
