import { randomUUID } from "node:crypto";
import { workerCommsDefinitionSchema, complianceViewSchema, WORKER_COMMS_COMPONENT, type WorkerCommsDefinition } from "@shared/worker-comms-compliance";
import type { IStorage } from "../storage";
import type { User } from "@shared/schema";
import { z } from "zod";
import { isComponentEnabled } from "../modules/components";
import { checkAccess } from "./access-policy-evaluator";

const PREFIX = "worker_comms_compliance_definition:";
export class WorkerCommsError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export async function listWorkerCommsDefinitions(storage: IStorage): Promise<WorkerCommsDefinition[]> {
  const rows = await storage.variables.getByNamePrefix(PREFIX);
  return rows.map(row => ({
    ...workerCommsDefinitionSchema.parse(row.value),
    id: row.name.slice(PREFIX.length),
  })).sort((a,b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
export async function getWorkerCommsDefinition(storage: IStorage, id: string) {
  const row = await storage.variables.getByName(`${PREFIX}${id}`);
  if (!row) throw new WorkerCommsError("Compliance definition not found", 404);
  return { ...workerCommsDefinitionSchema.parse(row.value), id };
}
export async function validateWorkerCommsReferences(
  storage: IStorage, definition: WorkerCommsDefinition,
  suppliedOptions?: Awaited<ReturnType<IStorage["workerCommsCompliance"]["options"]>>,
) {
  const options = suppliedOptions ?? await storage.workerCommsCompliance.options();
  const p = definition.population;
  for (const [label, selected, available] of [
    ["comm tag", [definition.commTagId], options.tags],
    ["member status", p.memberStatusIds.filter(id => id !== "none"), options.memberStatuses],
    ["benefit", p.benefitIds, options.benefits],
    ["employer", p.employerId ? [p.employerId] : [], options.employers],
    ["employer type", p.employerTypeId ? [p.employerTypeId] : [], options.employerTypes],
    ["bargaining unit", p.bargainingUnitId ? [p.bargainingUnitId] : [], options.bargainingUnits],
    ["representative", p.representativeId ? [p.representativeId] : [], options.representatives],
  ] as const) {
    if (selected.some(id => !available.some(option => option.id === id))) {
      throw new WorkerCommsError(`A selected ${label} is unavailable. Edit the definition before running it.`, 409);
    }
  }
}
export async function saveWorkerCommsDefinition(storage: IStorage, body: unknown, id?: string): Promise<WorkerCommsDefinition> {
  const parsed = workerCommsDefinitionSchema.safeParse(body);
  if (!parsed.success) throw new WorkerCommsError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const definition = { ...parsed.data, id: id ?? randomUUID() };
  await validateWorkerCommsReferences(storage, definition);
  if (id) {
    const row = await storage.variables.getByName(`${PREFIX}${id}`);
    if (!row) throw new WorkerCommsError("Compliance definition not found", 404);
    const updated = await storage.variables.update(row.id, { value: parsed.data });
    if (!updated) throw new WorkerCommsError("Compliance definition no longer exists", 404);
  } else {
    await storage.variables.create({ name: `${PREFIX}${definition.id}`, value: parsed.data });
  }
  return definition;
}
export async function deleteWorkerCommsDefinition(storage: IStorage, id: string) {
  const row = await storage.variables.getByName(`${PREFIX}${id}`);
  if (!row) throw new WorkerCommsError("Compliance definition not found", 404);
  await storage.variables.delete(row.id);
}

const reportSelectionSchema = z.object({
  definitionId: z.string().min(1),
  view: complianceViewSchema,
}).strict();

/** Re-evaluate current report membership at the bulk handoff, never trust UI IDs. */
export async function assertWorkerCommsSelection(storage: IStorage, user: User | null | undefined, selection: unknown, contactIds: string[]) {
  if (!user || !(await checkAccess("staff", user)).granted ||
      !(await isComponentEnabled(WORKER_COMMS_COMPONENT))) {
    throw new WorkerCommsError("Worker Comms Compliance access is required", 403);
  }
  const parsed = reportSelectionSchema.safeParse(selection);
  if (!parsed.success) throw new WorkerCommsError("Invalid compliance report selection");
  const definition = await getWorkerCommsDefinition(storage, parsed.data.definitionId);
  await validateWorkerCommsReferences(storage, definition);
  const allowed = new Set(await storage.workerCommsCompliance.contacts(definition, parsed.data.view));
  if (contactIds.some(id => !allowed.has(id))) {
    throw new WorkerCommsError("Some selected workers no longer match this report. Refresh and select the workers again.", 409);
  }
}
