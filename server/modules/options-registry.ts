import { storage } from "../storage";
import type { OptionsStorage } from "../storage/options";

export interface OptionsTypeConfig {
  name: string;
  storageKey: keyof OptionsStorage;
  getAll: () => Promise<any[]>;
  get: (id: string) => Promise<any | undefined>;
  create: (data: any) => Promise<any>;
  update: (id: string, data: any) => Promise<any | undefined>;
  delete: (id: string) => Promise<boolean>;
  requiredFields: string[];
  optionalFields: string[];
}

function createTypeConfig(
  name: string,
  storageKey: keyof OptionsStorage,
  requiredFields: string[],
  optionalFields: string[]
): OptionsTypeConfig {
  const storageObj = storage.options[storageKey] as any;
  
  const getAllMethod = storageObj.getAll || storageObj.getAllGenderOptions || 
    storageObj.getAllWorkerIdTypes || storageObj.getAllTrustBenefitTypes || 
    storageObj.getAllLedgerPaymentTypes;
  const getMethod = storageObj.get || storageObj.getGenderOption || 
    storageObj.getWorkerIdType || storageObj.getTrustBenefitType ||
    storageObj.getLedgerPaymentType;
  const createMethod = storageObj.create || storageObj.createGenderOption || 
    storageObj.createWorkerIdType || storageObj.createTrustBenefitType ||
    storageObj.createLedgerPaymentType;
  const updateMethod = storageObj.update || storageObj.updateGenderOption || 
    storageObj.updateWorkerIdType || storageObj.updateTrustBenefitType ||
    storageObj.updateLedgerPaymentType;
  const deleteMethod = storageObj.delete || storageObj.deleteGenderOption || 
    storageObj.deleteWorkerIdType || storageObj.deleteTrustBenefitType ||
    storageObj.deleteLedgerPaymentType;
    
  return {
    name,
    storageKey,
    getAll: getAllMethod.bind(storageObj),
    get: getMethod.bind(storageObj),
    create: createMethod.bind(storageObj),
    update: updateMethod.bind(storageObj),
    delete: deleteMethod.bind(storageObj),
    requiredFields,
    optionalFields,
  };
}

export const optionsTypeRegistry: Record<string, OptionsTypeConfig> = {
  "department": createTypeConfig(
    "Department",
    "departments",
    ["name"],
    ["description"]
  ),
  "employer-type": createTypeConfig(
    "Employer Type",
    "employerTypes",
    ["name"],
    ["description", "data", "sequence"]
  ),
  "employer-contact-type": createTypeConfig(
    "Employer Contact Type",
    "employerContactTypes",
    ["name"],
    ["description"]
  ),
  "worker-id-type": createTypeConfig(
    "Worker ID Type",
    "workerIdTypes",
    ["name"],
    ["sequence", "validator", "data"]
  ),
  "gender": createTypeConfig(
    "Gender",
    "gender",
    ["name", "code"],
    ["nota", "sequence", "data"]
  ),
  "trust-benefit-type": createTypeConfig(
    "Trust Benefit Type",
    "trustBenefitTypes",
    ["name"],
    ["description", "sequence", "data"]
  ),
  "trust-provider-type": createTypeConfig(
    "Trust Provider Type",
    "trustProviderTypes",
    ["name"],
    ["description"]
  ),
  "worker-ws": createTypeConfig(
    "Work Status",
    "workerWs",
    ["name"],
    ["shortName", "description", "sequence", "data"]
  ),
  "employment-status": createTypeConfig(
    "Employment Status",
    "employmentStatus",
    ["name"],
    ["description", "sequence", "data"]
  ),
  "event-type": createTypeConfig(
    "Event Type",
    "eventTypes",
    ["name"],
    ["description", "data"]
  ),
  "dispatch-job-type": createTypeConfig(
    "Dispatch Job Type",
    "dispatchJobTypes",
    ["name"],
    ["description", "data"]
  ),
  "ledger-payment-type": createTypeConfig(
    "Ledger Payment Type",
    "ledgerPaymentTypes",
    ["name", "category"],
    ["description", "sequence", "currencyCode", "data"]
  ),
  "skill": createTypeConfig(
    "Skill",
    "skills",
    ["name"],
    ["description", "data"]
  ),
};

export function getOptionsType(type: string): OptionsTypeConfig | undefined {
  return optionsTypeRegistry[type];
}

export function getAllOptionsTypes(): string[] {
  return Object.keys(optionsTypeRegistry);
}
