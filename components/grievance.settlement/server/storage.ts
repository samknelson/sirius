import { withStorageLogging } from "../../../server/storage/middleware/logging";
import { createGrievanceSettlementStorage, grievanceSettlementLoggingConfig } from "./storage/grievances/grievance-settlements";

export function createStorage() {
  return { grievanceSettlements: withStorageLogging(createGrievanceSettlementStorage(), grievanceSettlementLoggingConfig) };
}
