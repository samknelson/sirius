import { registerDenormPlugin } from "../registry";
import type { DenormPlugin } from "../types";
import { EventType } from "../../../../services/event-bus";
import { storage } from "../../../../storage";
import type { GrievanceWorkerName } from "../../../../storage/grievances/grievances";

/**
 * Denorm payload for a grievance's display name: a single computed string.
 */
export interface GrievanceNameDenormPayload {
  name: string;
}

/** Combine a worker's given + family name, falling back to the display name. */
function workerFullName(worker: GrievanceWorkerName): string {
  const parts = [worker.given, worker.family]
    .map((s) => (s ?? "").trim())
    .filter(Boolean);
  const joined = parts.join(" ");
  return joined || (worker.displayName ?? "").trim();
}

/**
 * Normalize a free-text class description for use in the denormalized name:
 * strip control characters, collapse runs of whitespace, and truncate to 100
 * characters.
 */
function cleanClassDescription(raw: string | null): string {
  if (!raw) return "";
  // eslint-disable-next-line no-control-regex
  const withoutControl = raw.replace(/[\u0000-\u001F\u007F]/g, " ");
  const collapsed = withoutControl.replace(/\s+/g, " ").trim();
  return collapsed.length > 100 ? collapsed.slice(0, 100) : collapsed;
}

/**
 * `grievance_name_denorm` denorm plugin — sole maintainer of the
 * `grievance_name_denorm` table. Gated by the `grievance` component.
 *
 * Subscribes to GRIEVANCE_SAVED (emitted after a grievance, its worker links,
 * or its employer links change and commit). On each event the registry
 * recomputes the display name and routes it through the shared apply helper,
 * which marks the `denorm` status row `ok` and calls this plugin's payload-only
 * `write` (both in one transaction).
 *
 * The name is up to three parts joined by " - " (empty parts omitted):
 *   1. the grievance's Grievance ID (`sirius_id`);
 *   2. the first (alphabetical) linked employer's name;
 *   3. a cardinality-dependent worker summary:
 *      - individual          → the single worker's name;
 *      - multiple-with-lead  → the lead worker's name + " (+N)" others;
 *      - multiple            → "N workers";
 *      - class               → the cleaned class description.
 */
const grievanceNameDenormPlugin: DenormPlugin<GrievanceNameDenormPayload> = {
  metadata: {
    id: "grievance_name_denorm",
    name: "Grievance Name",
    description:
      "Keeps a denormalized display name for each grievance in sync from its Grievance ID, employers, and workers.",
    requiredComponent: "grievance",
    singleton: true,
  },
  entityType: "grievance",
  eventHandlers: [
    {
      event: EventType.GRIEVANCE_SAVED,
      getEntityId: (payload) => (payload as { grievanceId: string }).grievanceId,
    },
  ],

  async compute(grievanceId: string): Promise<GrievanceNameDenormPayload> {
    const grievance = await storage.grievances.get(grievanceId);
    if (!grievance) return { name: "" };

    const employers = await storage.grievances.listEmployers(grievanceId);
    const workers = await storage.grievances.getWorkersForName(grievanceId);

    const part1 = (grievance.siriusId ?? "").trim();
    const part2 = employers.length > 0 ? employers[0].name.trim() : "";

    let part3 = "";
    switch (grievance.cardinality) {
      case "individual": {
        const worker = workers[0];
        part3 = worker ? workerFullName(worker) : "";
        break;
      }
      case "multiple-with-lead": {
        const lead = workers.find((w) => w.primary) ?? workers[0];
        const leadName = lead ? workerFullName(lead) : "";
        const others = workers.length > 0 ? workers.length - 1 : 0;
        part3 = leadName && others > 0 ? `${leadName} (+${others})` : leadName;
        break;
      }
      case "multiple": {
        part3 = workers.length > 0 ? `${workers.length} workers` : "";
        break;
      }
      case "class": {
        part3 = cleanClassDescription(grievance.classDescription);
        break;
      }
    }

    const name = [part1, part2, part3]
      .map((s) => s.trim())
      .filter(Boolean)
      .join(" - ");

    return { name };
  },

  async backfill(configId: string, limit: number): Promise<string[]> {
    return storage.grievances.findIdsMissingDenorm(configId, limit);
  },

  async findWidows(configId: string, limit: number): Promise<string[]> {
    return storage.grievances.findDenormWidowIds(configId, limit);
  },

  async write(
    grievanceId: string,
    payload: GrievanceNameDenormPayload,
    denormRowId: string,
  ): Promise<void> {
    await storage.grievanceNameDenorm.replaceForGrievance(grievanceId, denormRowId, payload.name);
  },
};

registerDenormPlugin(grievanceNameDenormPlugin);
