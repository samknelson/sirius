import { 
  createUnifiedOptionsStorage, 
  type UnifiedOptionsStorage,
  type OptionsTypeName,
  optionsMetadata,
} from "../storage/unified-options";

export interface OptionsTypeConfig {
  name: string;
  type: OptionsTypeName;
  getAll: () => Promise<any[]>;
  get: (id: string) => Promise<any | undefined>;
  create: (data: any) => Promise<any>;
  update: (id: string, data: any) => Promise<any | undefined>;
  delete: (id: string) => Promise<boolean>;
  requiredFields: readonly string[];
  optionalFields: readonly string[];
}

let unifiedStorage: UnifiedOptionsStorage | null = null;

function getUnifiedStorage(): UnifiedOptionsStorage {
  if (!unifiedStorage) {
    unifiedStorage = createUnifiedOptionsStorage();
  }
  return unifiedStorage;
}

function createTypeConfig(type: OptionsTypeName): OptionsTypeConfig {
  const storage = getUnifiedStorage();
  const metadata = optionsMetadata[type];
  
  return {
    name: metadata.displayName,
    type,
    getAll: () => storage.list(type),
    get: (id: string) => storage.get(type, id),
    create: (data: any) => storage.create(type, data),
    update: (id: string, data: any) => storage.update(type, id, data),
    delete: (id: string) => storage.delete(type, id),
    requiredFields: metadata.requiredFields,
    optionalFields: metadata.optionalFields,
  };
}

export const optionsTypeRegistry: Record<string, OptionsTypeConfig> = {
  "department": createTypeConfig("department"),
  "employer-type": createTypeConfig("employer-type"),
  "employer-contact-type": createTypeConfig("employer-contact-type"),
  "worker-id-type": createTypeConfig("worker-id-type"),
  "gender": createTypeConfig("gender"),
  "trust-benefit-type": createTypeConfig("trust-benefit-type"),
  "trust-provider-type": createTypeConfig("trust-provider-type"),
  "worker-ws": createTypeConfig("worker-ws"),
  "employment-status": createTypeConfig("employment-status"),
  "event-type": createTypeConfig("event-type"),
  "dispatch-job-type": createTypeConfig("dispatch-job-type"),
  "ledger-payment-type": createTypeConfig("ledger-payment-type"),
  "skill": createTypeConfig("skill"),
  "edls-task": createTypeConfig("edls-task"),
  "certification": createTypeConfig("certification"),
  "worker-rating": createTypeConfig("worker-rating"),
};

export function getOptionsType(type: string): OptionsTypeConfig | undefined {
  return optionsTypeRegistry[type];
}

export function getAllOptionsTypes(): string[] {
  return Object.keys(optionsTypeRegistry);
}

export function getOptionsStorage(): UnifiedOptionsStorage {
  return getUnifiedStorage();
}
