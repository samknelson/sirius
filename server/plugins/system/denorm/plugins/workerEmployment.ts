import { registerDenormPlugin } from "../registry";
import type { DenormPlugin } from "../types";

/**
 * Denormalized employment payload for a worker. Mirrors the `denorm_*` columns
 * on the `workers` table: current work site, member statuses, job title, home
 * employer, all employers, active flag, and policy.
 */
export interface WorkerEmploymentDenorm {
  denormWsId: string | null;
  denormMsIds: string[] | null;
  denormJobTitle: string | null;
  denormHomeEmployerId: string | null;
  denormEmployerIds: string[] | null;
  denormActive: boolean | null;
  denormPolicyId: string | null;
}

/**
 * STUB — Task #482. This registers the first denorm plugin TYPE so the new
 * "denorm" plugin kind has a concrete member, but carries NO real logic yet.
 *
 * `compute` and `write` throw "not implemented" on purpose: nothing calls them
 * at boot (no event handlers are wired), and throwing keeps the stub explicit
 * rather than silently doing the wrong thing. The real compute/write/event
 * wiring lands in a follow-up task.
 */
const workerEmploymentDenormPlugin: DenormPlugin<WorkerEmploymentDenorm> = {
  metadata: {
    id: "worker_employment",
    name: "Worker Employment",
    description:
      "Keeps a worker's denormalized employment fields (work site, member statuses, job title, employers, active, policy) in sync.",
    singleton: true,
  },
  entityType: "worker",
  // Placeholder — real event handlers (e.g. work-site / status changes) land
  // with the compute/write logic in a follow-up task.
  eventHandlers: [],
  async compute(_entityId: string): Promise<WorkerEmploymentDenorm> {
    throw new Error("worker_employment denorm compute() is not implemented yet");
  },
  async write(_entityId: string, _payload: WorkerEmploymentDenorm): Promise<void> {
    throw new Error("worker_employment denorm write() is not implemented yet");
  },
};

registerDenormPlugin(workerEmploymentDenormPlugin);
