import { withStorageLogging } from "../../../server/storage/middleware/logging";
import { createGrievanceStorage, grievanceLoggingConfig } from "./storage/grievances/grievances";
import { createGrievanceStatusHistoryStorage, grievanceStatusHistoryLoggingConfig } from "./storage/grievances/grievance-status-history";
import { createGrievanceTimelineTemplateStorage, grievanceTimelineTemplateLoggingConfig } from "./storage/grievances/grievance-timeline-templates";
import { createGrievanceNameDenormStorage } from "./storage/system/grievance-name-denorm";
import { createGrievanceStepsDenormStorage } from "./storage/system/grievance-steps-denorm";

export function createStorage() {
  return {
    grievanceNameDenorm: createGrievanceNameDenormStorage(),
    grievanceStepsDenorm: createGrievanceStepsDenormStorage(),
    grievances: withStorageLogging(createGrievanceStorage(), grievanceLoggingConfig),
    grievanceStatusHistory: withStorageLogging(createGrievanceStatusHistoryStorage(), grievanceStatusHistoryLoggingConfig),
    grievanceTimelineTemplates: withStorageLogging(createGrievanceTimelineTemplateStorage(), grievanceTimelineTemplateLoggingConfig),
  };
}
