import type { ComponentStartup } from "../../../server/services/component/startup-types";
import "./options";
import "./plugins/dispatch/eligibility/plugins/skill";
import "./plugins/system/denorm/plugins/dispatch/skill";
import { registerSkillRecordGo } from "./record-go";
export const register = registerSkillRecordGo;
import { registerWorkerSkillsRoutes } from "./modules/workers/skills";
export const registerRoutes: NonNullable<ComponentStartup["registerRoutes"]> =
  (app, auth, _permission, access) => registerWorkerSkillsRoutes(app, auth, access);
