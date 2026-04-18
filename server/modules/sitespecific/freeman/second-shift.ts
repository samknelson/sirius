import type { Express, Request, Response, NextFunction } from "express";
import { storage as defaultStorage } from "../../../storage/database";
import type { IStorage } from "../../../storage/database";
import {
  createUnifiedOptionsStorage,
  type UnifiedOptionsStorage,
} from "../../../storage/unified-options";
import { requireComponent } from "../../components";
import { optionsWorkerIdType, optionsWorkerMs } from "@shared/schema";

type OptionsWorkerIdTypeRow = typeof optionsWorkerIdType.$inferSelect;
type OptionsWorkerMsRow = typeof optionsWorkerMs.$inferSelect;

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type AccessMiddleware = (
  policyId: string,
) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

type MissingWorkerIdSiriusId = "freeman" | "2nd";
type MissingMemberStatusSiriusId = "2nd";

export interface ConfigErrorDetail {
  missingTypes: MissingWorkerIdSiriusId[];
  missingMemberStatuses: MissingMemberStatusSiriusId[];
}

export interface ResolvedConfig {
  ok: true;
  freemanTypeId: string;
  secondTypeId: string;
  secondMsId: string;
  secondMsIndustryId: string;
}

export interface UnresolvedConfig {
  ok: false;
  missingTypes: MissingWorkerIdSiriusId[];
  missingMemberStatuses: MissingMemberStatusSiriusId[];
}

export type ConfigResolution = ResolvedConfig | UnresolvedConfig;

export interface SecondShiftLink {
  workerId: string;
  displayName: string;
  value: string;
}

export interface SourceEligibility {
  hasFreemanId: boolean;
  has2ndId: boolean;
}

export type SecondShiftResponse =
  | { configError: ConfigErrorDetail }
  | { link: SecondShiftLink | null; source: SourceEligibility };

export interface SecondShiftDeps {
  storage: IStorage;
  unifiedOptions: UnifiedOptionsStorage;
}

function defaultDeps(): SecondShiftDeps {
  return { storage: defaultStorage, unifiedOptions: createUnifiedOptionsStorage() };
}

async function resolveConfig(deps: SecondShiftDeps): Promise<ConfigResolution> {
  const [idTypeRows, msRows] = await Promise.all([
    deps.unifiedOptions.list("worker-id-type") as Promise<OptionsWorkerIdTypeRow[]>,
    deps.unifiedOptions.list("worker-ms") as Promise<OptionsWorkerMsRow[]>,
  ]);

  const freemanType = idTypeRows.find((r) => r.siriusId === "freeman");
  const secondType = idTypeRows.find((r) => r.siriusId === "2nd");
  const secondMs = msRows.find((r) => r.siriusId === "2nd");

  const missingTypes: MissingWorkerIdSiriusId[] = [];
  if (!freemanType) missingTypes.push("freeman");
  if (!secondType) missingTypes.push("2nd");

  const missingMemberStatuses: MissingMemberStatusSiriusId[] = [];
  if (!secondMs) missingMemberStatuses.push("2nd");

  if (missingTypes.length > 0 || missingMemberStatuses.length > 0) {
    return { ok: false, missingTypes, missingMemberStatuses };
  }

  return {
    ok: true,
    freemanTypeId: freemanType!.id,
    secondTypeId: secondType!.id,
    secondMsId: secondMs!.id,
    secondMsIndustryId: secondMs!.industryId,
  };
}

function configErrorResponse(cfg: UnresolvedConfig): SecondShiftResponse {
  return {
    configError: {
      missingTypes: cfg.missingTypes,
      missingMemberStatuses: cfg.missingMemberStatuses,
    },
  };
}

async function buildSourceEligibility(
  deps: SecondShiftDeps,
  workerId: string,
  freemanTypeId: string,
  secondTypeId: string,
): Promise<{ source: SourceEligibility; freemanValue: string | null; secondValue: string | null }> {
  const ids = await deps.storage.workerIds.getWorkerIdsByWorkerId(workerId);
  const freemanRow = ids.find((row) => row.typeId === freemanTypeId);
  const secondRow = ids.find((row) => row.typeId === secondTypeId);
  return {
    source: {
      hasFreemanId: !!freemanRow,
      has2ndId: !!secondRow,
    },
    freemanValue: freemanRow?.value ?? null,
    secondValue: secondRow?.value ?? null,
  };
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
  const cfg = await resolveConfig(deps);
  if (!cfg.ok) return configErrorResponse(cfg);

  const { source, secondValue } = await buildSourceEligibility(
    deps,
    workerId,
    cfg.freemanTypeId,
    cfg.secondTypeId,
  );

  if (!secondValue) return { link: null, source };

  const match = await deps.storage.workerIds.getWorkerIdByTypeAndValue(
    cfg.freemanTypeId,
    secondValue,
  );
  if (!match || match.workerId === workerId) return { link: null, source };

  const link = await resolvePartner(deps, match.workerId, secondValue);
  return { link, source };
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
  const cfg = await resolveConfig(deps);
  if (!cfg.ok) return configErrorResponse(cfg);

  const { source, freemanValue } = await buildSourceEligibility(
    deps,
    workerId,
    cfg.freemanTypeId,
    cfg.secondTypeId,
  );

  if (!freemanValue) return { link: null, source };

  const match = await deps.storage.workerIds.getWorkerIdByTypeAndValue(
    cfg.secondTypeId,
    freemanValue,
  );
  if (!match || match.workerId === workerId) return { link: null, source };

  const link = await resolvePartner(deps, match.workerId, freemanValue);
  return { link, source };
}

export type SyncResult =
  | { configError: ConfigErrorDetail }
  | { error: { code: "HAS_2ND_ID" | "MISSING_FREEMAN_ID" | "WORKER_NOT_FOUND"; message: string } }
  | { link: SecondShiftLink; source: SourceEligibility };

interface DesiredNameComponents {
  title: string | null;
  given: string | null;
  middle: string | null;
  family: string | null;
  generational: string | null;
  credentials: string | null;
}

function buildDesiredComponents(sourceContact: {
  title?: string | null;
  given?: string | null;
  middle?: string | null;
  family?: string | null;
  generational?: string | null;
  credentials?: string | null;
}): DesiredNameComponents {
  const family = sourceContact.family ?? null;
  return {
    title: sourceContact.title ?? null,
    given: sourceContact.given ?? null,
    middle: sourceContact.middle ?? null,
    family: family ? `${family} 2nd` : "2nd",
    generational: sourceContact.generational ?? null,
    credentials: sourceContact.credentials ?? null,
  };
}

function nameComponentsDiffer(
  a: DesiredNameComponents,
  b: { title?: string | null; given?: string | null; middle?: string | null; family?: string | null; generational?: string | null; credentials?: string | null },
): boolean {
  return (
    (a.title ?? null) !== (b.title ?? null) ||
    (a.given ?? null) !== (b.given ?? null) ||
    (a.middle ?? null) !== (b.middle ?? null) ||
    (a.family ?? null) !== (b.family ?? null) ||
    (a.generational ?? null) !== (b.generational ?? null) ||
    (a.credentials ?? null) !== (b.credentials ?? null)
  );
}

function todayDateString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function componentsToInput(c: DesiredNameComponents) {
  const out: {
    title?: string;
    given?: string;
    middle?: string;
    family?: string;
    generational?: string;
    credentials?: string;
  } = {};
  if (c.title) out.title = c.title;
  if (c.given) out.given = c.given;
  if (c.middle) out.middle = c.middle;
  if (c.family) out.family = c.family;
  if (c.generational) out.generational = c.generational;
  if (c.credentials) out.credentials = c.credentials;
  return out;
}

/**
 * Create or update the 2nd-shift shadow worker for the given primary worker.
 * Idempotent: only writes name components when they differ, and only inserts
 * a new worker_msh row when the current member status for the relevant
 * industry differs from the resolved "2nd" member status.
 */
export async function syncSecondShift(
  deps: SecondShiftDeps,
  primaryWorkerId: string,
): Promise<SyncResult> {
  const cfg = await resolveConfig(deps);
  if (!cfg.ok) {
    return {
      configError: {
        missingTypes: cfg.missingTypes,
        missingMemberStatuses: cfg.missingMemberStatuses,
      },
    };
  }

  const primary = await deps.storage.workers.getWorker(primaryWorkerId);
  if (!primary) {
    return {
      error: { code: "WORKER_NOT_FOUND", message: "Worker not found." },
    };
  }

  const { source, freemanValue, secondValue } = await buildSourceEligibility(
    deps,
    primaryWorkerId,
    cfg.freemanTypeId,
    cfg.secondTypeId,
  );

  if (secondValue) {
    return {
      error: {
        code: "HAS_2ND_ID",
        message: "Cannot create a shadow of a shadow: this worker already has a 2nd ID.",
      },
    };
  }
  if (!freemanValue) {
    return {
      error: {
        code: "MISSING_FREEMAN_ID",
        message: "Worker is missing a Freeman ID; cannot create a 2nd shift shadow.",
      },
    };
  }

  const sourceContact = await deps.storage.contacts.getContact(primary.contactId);
  const desired = buildDesiredComponents(sourceContact ?? {});

  const existing = await deps.storage.workerIds.getWorkerIdByTypeAndValue(
    cfg.secondTypeId,
    freemanValue,
  );

  let shadowWorkerId: string;

  if (existing) {
    shadowWorkerId = existing.workerId;

    const shadowWorker = await deps.storage.workers.getWorker(shadowWorkerId);
    if (shadowWorker) {
      const shadowContact = await deps.storage.contacts.getContact(shadowWorker.contactId);
      if (!shadowContact || nameComponentsDiffer(desired, shadowContact)) {
        await deps.storage.workers.updateWorkerContactNameComponents(
          shadowWorkerId,
          componentsToInput(desired),
        );
      }
    }
  } else {
    const initialDisplayName =
      [desired.given, desired.family].filter(Boolean).join(" ") || "2nd";
    const created = await deps.storage.workers.createWorker(initialDisplayName);
    shadowWorkerId = created.id;

    await deps.storage.workers.updateWorkerContactNameComponents(
      shadowWorkerId,
      componentsToInput(desired),
    );

    await deps.storage.workerIds.createWorkerId({
      workerId: shadowWorkerId,
      typeId: cfg.secondTypeId,
      value: freemanValue,
    });
  }

  // Ensure the shadow has the "2nd" member status for the relevant industry.
  const mshEntries = await deps.storage.workerMsh.getWorkerMsh(shadowWorkerId);
  const latestForIndustry = pickLatestForIndustry(mshEntries, cfg.secondMsIndustryId);
  if (!latestForIndustry || latestForIndustry.msId !== cfg.secondMsId) {
    await deps.storage.workerMsh.createWorkerMsh({
      workerId: shadowWorkerId,
      date: todayDateString(),
      msId: cfg.secondMsId,
      industryId: cfg.secondMsIndustryId,
    });
  }

  // Build the response link.
  const refreshedContact = await deps.storage.contacts.getContact(
    (await deps.storage.workers.getWorker(shadowWorkerId))?.contactId ?? "",
  );
  const displayName = refreshedContact?.displayName ?? "(unknown)";

  return {
    link: { workerId: shadowWorkerId, displayName, value: freemanValue },
    // Eligibility reflects the *primary's* state, which is unchanged by sync.
    source,
  };
}

function pickLatestForIndustry(
  entries: Array<{
    id?: string | null;
    industryId?: string | null;
    msId?: string | null;
    date?: string | null;
    createdAt?: Date | string | null;
  }>,
  industryId: string,
): { msId: string; date: string } | null {
  const filtered = entries.filter((e) => e.industryId === industryId && e.msId);
  if (filtered.length === 0) return null;
  // The DB has a unique (workerId, industryId, date) constraint, so same-day
  // duplicates are impossible. Tie-breakers on createdAt/id are defensive only.
  filtered.sort((a, b) => {
    const da = a.date ?? "";
    const db = b.date ?? "";
    if (da !== db) return db.localeCompare(da);
    const ca = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const cb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (ca !== cb) return cb - ca;
    return (b.id ?? "").localeCompare(a.id ?? "");
  });
  const top = filtered[0];
  return { msId: top.msId as string, date: top.date ?? "" };
}

export function registerFreemanSecondShiftRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  requireAccess: AccessMiddleware,
) {
  const freemanComponent = requireComponent("sitespecific.freeman");
  const viewerGate = requireAccess("edls.any");
  const coordinatorGate = requireAccess("edls.coordinator");

  async function handleGet(
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
      const message =
        error instanceof Error ? error.message : "Failed to resolve second shift link";
      res.status(500).json({ message });
    }
  }

  app.get(
    "/api/workers/:id/sitespecific/freeman/2nd-from",
    requireAuth,
    freemanComponent,
    viewerGate,
    (req, res) => handleGet(req, res, findSecondShiftFrom),
  );

  app.get(
    "/api/workers/:id/sitespecific/freeman/2nd-to",
    requireAuth,
    freemanComponent,
    viewerGate,
    (req, res) => handleGet(req, res, findSecondShiftTo),
  );

  app.put(
    "/api/workers/:id/sitespecific/freeman/2nd-to",
    requireAuth,
    freemanComponent,
    coordinatorGate,
    async (req, res) => {
      try {
        const deps = defaultDeps();
        const workerId = req.params.id;
        const worker = await deps.storage.workers.getWorker(workerId);
        if (!worker) {
          return res.status(404).json({ message: "Worker not found" });
        }
        const result = await syncSecondShift(deps, workerId);
        if ("configError" in result) {
          return res.status(409).json(result);
        }
        if ("error" in result) {
          return res.status(400).json({ message: result.error.message, code: result.error.code });
        }
        res.json(result);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to sync second shift worker";
        res.status(500).json({ message });
      }
    },
  );
}
