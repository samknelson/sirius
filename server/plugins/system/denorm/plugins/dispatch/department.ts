import { registerDenormPlugin } from "../../registry";
import type { DenormPlugin } from "../../types";
import { EventType } from "../../../../../services/event-bus";
import { createWorkerDispatchDepartmentStorage } from "../../../../../storage/dispatch/worker-departments";
import {
  type DispatchEligDenormPayload,
  dispatchEligBackfill,
  dispatchEligFindWidows,
  writeDispatchElig,
} from "./_shared";

export const DEPT_INCLUDE_CATEGORY = "dept_include";
export const DEPT_EXCLUDE_CATEGORY = "dept_exclude";

/**
 * `dispatch_department` denorm plugin — maintains the `dept_include` /
 * `dept_exclude` facts (one per department preference row for the worker).
 * Gated by the `dispatch.department` component.
 */
const dispatchDepartmentDenormPlugin: DenormPlugin<DispatchEligDenormPayload> = {
  metadata: {
    id: "dispatch_department",
    name: "Department Preferences",
    description: "Filters workers by their department include/exclude preferences against the job's department",
    requiredComponent: "dispatch.department",
    singleton: true,
  },
  entityType: "worker",
  reads: ["workers", "workerDispatchDepartments"],
  writes: [{ storage: "workerDispatchEligDenorm", soleWriter: false }],
  eventHandlers: [
    {
      event: EventType.DISPATCH_DEPARTMENT_SAVED,
      getEntityId: (payload) => (payload as { workerId: string }).workerId,
    },
  ],

  async compute(workerId: string): Promise<DispatchEligDenormPayload> {
    const departmentStorage = createWorkerDispatchDepartmentStorage();
    const entries = await departmentStorage.getByWorker(workerId);

    return {
      entries: entries.map((entry) => ({
        workerId: entry.workerId,
        category: entry.preference === "include" ? DEPT_INCLUDE_CATEGORY : DEPT_EXCLUDE_CATEGORY,
        value: entry.departmentId,
      })),
    };
  },

  backfill: dispatchEligBackfill,
  findWidows: dispatchEligFindWidows,
  write: writeDispatchElig,
};

registerDenormPlugin(dispatchDepartmentDenormPlugin);
