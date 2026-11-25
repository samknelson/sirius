import type { ComponentDefinition } from "../../../shared/components";
import "./types";
export const component: ComponentDefinition = {
  id: "dispatch.bullpen", name: "Dispatch Bullpen",
  description: "Bullpen functionality for dispatch job types (host/shared bullpens tied to event types)",
  enabledByDefault: false, category: "dispatch", managesSchema: true,
  schemaManifest: { version: 1, schemaPath: "./components/dispatch.bullpen/shared/schema/dispatch/bullpen-schema.ts", tables: ["dispatch_job_event"], dependsOnComponents: ["dispatch"] },
};
