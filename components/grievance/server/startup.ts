import type { ComponentStartup } from "../../../server/services/component/startup-types";
import { alterHooks } from "../../../shared/alter";
import { tabEntityPolicyHook } from "../../../shared/tab-visibility";
import { eventBus } from "../../../server/services/event-bus";
import { registerVariableEntry } from "../../../server/modules/system/variable-registry";
import { registerEntityNoteContext } from "../../../server/services/entity-notes/registry";
import { registerEntityFileContext } from "../../../server/services/entity-files/registry";
import { staffOnly as notesStaffOnly } from "../../../server/modules/entity-notes-contexts";
import { staffOnly as filesStaffOnly } from "../../../server/modules/entity-files-contexts";
import { cleanUpNotesForDeletedRecord } from "../../../server/services/entity-notes/delete-cleanup";
import { cleanUpFilesForDeletedRecord } from "../../../server/services/entity-files/delete-cleanup";
import { grievances } from "../shared/schema/grievance/schema";
import { GRIEVANCE_DELETE_AFTER } from "./events";
import { registerGrievanceRoutes } from "./modules/grievances/grievances";
import { registerGrievanceTimelineTemplateRoutes } from "./modules/grievances/grievance-timeline-templates";

const COMPONENT = "grievance";

async function grievanceExists(entityId: string): Promise<boolean> {
  const { storage } = await import("../../../server/storage");
  return Boolean(await storage.grievances.get(entityId));
}

/** Base access for the tab trees this component contributes. */
const TAB_ENTITY_POLICIES: Record<string, string> = {
  grievance: "staff",
  grievanceTimelineTemplate: "admin",
};

export function register(): void {
  // Contexts register whether or not the component is enabled: the orphan
  // sweep must know the table of retained notes and files, and asks the
  // component state itself (`component`) before querying it.
  registerEntityNoteContext({
    id: "grievance",
    table: grievances,
    label: "Grievances",
    recordLabel: "Grievance",
    component: COMPONENT,
    entityExists: grievanceExists,
    ...notesStaffOnly(),
  });
  registerEntityFileContext({
    id: "grievance",
    table: grievances,
    label: "Grievances",
    recordLabel: "Grievance",
    component: COMPONENT,
    entityExists: grievanceExists,
    ...filesStaffOnly(),
  });

  // A deleted grievance's notes and attachments go with it.
  eventBus.on({
    name: "entity-notes-cleanup-grievance",
    description: "Removes a deleted grievance record's notes, one note at a time.",
    event: GRIEVANCE_DELETE_AFTER,
    handler: async (payload) => cleanUpNotesForDeletedRecord("grievance", payload.grievanceId),
  });
  eventBus.on({
    name: "entity-files-cleanup-grievance",
    description: "Removes a deleted grievance record's file attachments, one at a time.",
    event: GRIEVANCE_DELETE_AFTER,
    handler: async (payload) => cleanUpFilesForDeletedRecord("grievance", payload.grievanceId),
  });

  // Staff-readable deadline colouring thresholds.
  registerVariableEntry("grievance.deadline_thresholds", { readTier: "staff", component: COMPONENT });

  alterHooks.register(tabEntityPolicyHook, {
    id: "grievance.tab-entity-policy",
    description: "Base access for grievance and timeline-template tabs",
    component: COMPONENT,
    priority: 0,
    metadata: {},
    async alter(policy, { entityType }) {
      return TAB_ENTITY_POLICIES[entityType] ?? policy;
    },
  });
}

export const registerRoutes: NonNullable<ComponentStartup["registerRoutes"]> = (app, auth, _permission, access) => {
  registerGrievanceRoutes(app, auth, access);
  registerGrievanceTimelineTemplateRoutes(app, auth, access);
};
