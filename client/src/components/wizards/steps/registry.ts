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
import { EmployerNameStep } from './employer-onboarding/EmployerNameStep';
import { AttributesStep } from './employer-onboarding/AttributesStep';
import { ContactsStep } from './employer-onboarding/ContactsStep';
import { WorkerLoadStep } from './employer-onboarding/WorkerLoadStep';
import { ReviewStep as OnboardingReviewStep } from './employer-onboarding/ReviewStep';

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

const evaluateEmployerNameComplete: StepCompletionEvaluator = ({ wizard }) => {
  return !!wizard?.data?.employerName?.trim();
};

const evaluateAttributesComplete: StepCompletionEvaluator = () => true;

const evaluateContactsComplete: StepCompletionEvaluator = ({ wizard }) => {
  const contacts = wizard?.data?.contacts || [];
  if (contacts.length === 0) return true;
  return contacts.every((c: any) => c.email?.trim());
};

const evaluateWorkerLoadComplete: StepCompletionEvaluator = ({ wizard }) => {
  return !!wizard?.data?.employerId;
};

const evaluateRunComplete: StepCompletionEvaluator = ({ wizard }) => {
  const progress = wizard?.data?.progress?.run;
  return progress?.status === 'completed';
};

const evaluateBTUInputsComplete: StepCompletionEvaluator = ({ wizard }) => {
  const cardcheckDefinitionId = wizard?.data?.config?.filters?.cardcheckDefinitionId;
  return !!cardcheckDefinitionId;
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
  'hta_union_import': {
    'upload': { Component: UploadStep, evaluateCompletion: evaluateUploadComplete },
    'map': { Component: MapStep, evaluateCompletion: evaluateMapComplete },
    'validate': { Component: ValidateStep, evaluateCompletion: evaluateValidateComplete },
    'process': { Component: ProcessStep, evaluateCompletion: alwaysComplete },
    'review': { Component: ReviewStep, evaluateCompletion: alwaysComplete },
  },
  'employer_onboarding': {
    'employer_name': { Component: EmployerNameStep, evaluateCompletion: evaluateEmployerNameComplete },
    'attributes': { Component: AttributesStep, evaluateCompletion: evaluateAttributesComplete },
    'contacts': { Component: ContactsStep, evaluateCompletion: evaluateContactsComplete },
    'worker_load': { Component: WorkerLoadStep, evaluateCompletion: evaluateWorkerLoadComplete },
    'review': { Component: OnboardingReviewStep, evaluateCompletion: alwaysComplete },
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
  'hta_union_import': {
    'upload': UploadStep,
    'map': MapStep,
    'validate': ValidateStep,
    'process': ProcessStep,
    'review': ReviewStep,
  },
  'employer_onboarding': {
    'employer_name': EmployerNameStep,
    'attributes': AttributesStep,
    'contacts': ContactsStep,
    'worker_load': WorkerLoadStep,
    'review': OnboardingReviewStep,
  },
};

export function getStepComponent(wizardType: string, stepId: string): WizardStepComponent | null {
  return stepComponentRegistry[wizardType]?.[stepId] || null;
}

export function getStepController(wizardType: string, stepId: string): StepController | null {
  return stepControllerRegistry[wizardType]?.[stepId] || null;
}
