import type { Express, Request, Response, NextFunction } from "express";
import { storage as defaultStorage } from "../../../storage/database";
import type { IStorage } from "../../../storage/database";
import {
  createUnifiedOptionsStorage,
  type UnifiedOptionsStorage,
} from "../../../storage/unified-options";
import { requireComponent } from "../../components";
import { optionsWorkerIdType } from "@shared/schema";

type OptionsWorkerIdTypeRow = typeof optionsWorkerIdType.$inferSelect;

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type AccessMiddleware = (policyId: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

type MissingSiriusId = "freeman" | "2nd";

export interface FreemanTypeIdsResolved {
  ok: true;
  freemanTypeId: string;
  secondTypeId: string;
}

export interface FreemanTypeIdsMissing {
  ok: false;
  missing: MissingSiriusId[];
}

export type FreemanTypeIdsResult = FreemanTypeIdsResolved | FreemanTypeIdsMissing;

export interface SecondShiftLink {
  workerId: string;
  displayName: string;
  value: string;
}

export type SecondShiftResponse =
  | { configError: { missing: MissingSiriusId[] } }
  | { link: SecondShiftLink | null };

export interface SecondShiftDeps {
  storage: IStorage;
  unifiedOptions: UnifiedOptionsStorage;
}

function defaultDeps(): SecondShiftDeps {
  return { storage: defaultStorage, unifiedOptions: createUnifiedOptionsStorage() };
}

async function resolveTypeIds(deps: SecondShiftDeps): Promise<FreemanTypeIdsResult> {
  const rows = (await deps.unifiedOptions.list("worker-id-type")) as OptionsWorkerIdTypeRow[];
  const freeman = rows.find((r) => r.siriusId === "freeman");
  const second = rows.find((r) => r.siriusId === "2nd");
  const missing: MissingSiriusId[] = [];
  if (!freeman) missing.push("freeman");
  if (!second) missing.push("2nd");
  if (missing.length > 0) {
    return { ok: false, missing };
  }
  return { ok: true, freemanTypeId: freeman!.id, secondTypeId: second!.id };
}

async function resolvePartner(
  deps: SecondShiftDeps,
  workerId: string,
  value: string,
): Promise<SecondShiftLink | null> {
  const partner = await deps.storage.workers.getWorker(workerId);
  if (!partner) return null;
  const contact = await deps.storage.contacts.getContact(partner.contactId);
  const displayName = contact?.displayName ?? "(unknown)";
  return { workerId: partner.id, displayName, value };
}

/**
 * Find the primary worker that the given worker is a 2nd shift OF.
 *
 * The given worker must carry a worker_id row of type "2nd"; we then
 * look up the worker that has a "freeman" worker_id with the same value.
 */
export async function findSecondShiftFrom(
  deps: SecondShiftDeps,
  workerId: string,
): Promise<SecondShiftResponse> {
  const types = await resolveTypeIds(deps);
  if (!types.ok) return { configError: { missing: types.missing } };

  const ids = await deps.storage.workerIds.getWorkerIdsByWorkerId(workerId);
  const secondRow = ids.find((row) => row.typeId === types.secondTypeId);
  if (!secondRow) return { link: null };

  const match = await deps.storage.workerIds.getWorkerIdByTypeAndValue(
    types.freemanTypeId,
    secondRow.value,
  );
  if (!match || match.workerId === workerId) return { link: null };

  const link = await resolvePartner(deps, match.workerId, secondRow.value);
  return { link };
}

/**
 * Find the 2nd shift shadow worker FOR the given worker.
 *
 * The given worker must carry a worker_id row of type "freeman"; we then
 * look up the worker that has a "2nd" worker_id with the same value.
 */
export async function findSecondShiftTo(
  deps: SecondShiftDeps,
  workerId: string,
): Promise<SecondShiftResponse> {
  const types = await resolveTypeIds(deps);
  if (!types.ok) return { configError: { missing: types.missing } };

  const ids = await deps.storage.workerIds.getWorkerIdsByWorkerId(workerId);
  const freemanRow = ids.find((row) => row.typeId === types.freemanTypeId);
  if (!freemanRow) return { link: null };

  const match = await deps.storage.workerIds.getWorkerIdByTypeAndValue(
    types.secondTypeId,
    freemanRow.value,
  );
  if (!match || match.workerId === workerId) return { link: null };

  const link = await resolvePartner(deps, match.workerId, freemanRow.value);
  return { link };
}

export function registerFreemanSecondShiftRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  requireAccess: AccessMiddleware,
) {
  const freemanComponent = requireComponent("sitespecific.freeman");
  const accessGate = requireAccess("edls.coordinator");

  async function handle(
    req: Request,
    res: Response,
    finder: (deps: SecondShiftDeps, workerId: string) => Promise<SecondShiftResponse>,
  ) {
    try {
      const deps = defaultDeps();
      const workerId = req.params.id;
      const worker = await deps.storage.workers.getWorker(workerId);
      if (!worker) {
        return res.status(404).json({ message: "Worker not found" });
      }
      const result = await finder(deps, workerId);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to resolve second shift link";
      res.status(500).json({ message });
    }
  }

  app.get(
    "/api/workers/:id/sitespecific/freeman/2nd-from",
    requireAuth,
    freemanComponent,
    accessGate,
    (req, res) => handle(req, res, findSecondShiftFrom),
  );

  app.get(
    "/api/workers/:id/sitespecific/freeman/2nd-to",
    requireAuth,
    freemanComponent,
    accessGate,
    (req, res) => handle(req, res, findSecondShiftTo),
  );
}
