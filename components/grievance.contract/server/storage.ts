import { withStorageLogging } from "../../../server/storage/middleware/logging";
import { createGrievanceContractStorage, grievanceContractLoggingConfig } from "./storage/grievances/grievance-contract-links";

export function createStorage() {
  return { grievanceContracts: withStorageLogging(createGrievanceContractStorage(), grievanceContractLoggingConfig) };
}
