import type { ComponentStartup } from "../../../server/services/component/startup-types";
import { storage } from "../../../server/storage/database";
import { registerWorkerStewardAssignmentRoutes } from "./modules/worker-steward-assignments";
import "../shared/access-policies/employer/steward-view";
import "./plugins/dashboard/plugins/my-steward";
import "./plugins/wizards/plugins/btu-building-rep-import";
import "./building-rep-token";
import "./plugins/ledger/charge/plugins/btuStewardAttendance";
import { registerStewardEmployerAccess } from "./employer-access";
import { registerStewardHostParticipation } from "./host-participation";
export function register() {
  registerStewardEmployerAccess();
  registerStewardHostParticipation();
}
import "./plugins/event-notifier/plugins/steward-assignment-notifier";
export const registerRoutes: NonNullable<ComponentStartup["registerRoutes"]> =
  (app, auth, _permission, access) => registerWorkerStewardAssignmentRoutes(app, auth, access, storage);
