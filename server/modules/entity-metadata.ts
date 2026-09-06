import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  entityMetadataStorage,
  isRecordId,
} from "../storage/system/entity-metadata";
import {
  BACKFILL_BATCH_LIMIT,
  type MetadataSortColumn,
} from "../storage/system/entity-metadata-admin";
import {
  listMetadataRecordContexts,
} from "../storage/entity-metadata-record-tables";
import { storage } from "../storage";
import { requireAccess } from "../services/access-policy-evaluator";
import { logger } from "../logger";
import { recordGoHref } from "@shared/utils/record-go";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => AuthMiddleware;

/**
 * Reading a record's provenance.
 *
 * There is one endpoint here and it only reads. Provenance is written by the
 * mutation that caused it — the storage logging middleware stamps it after the
 * transaction commits — and by nothing else, so no create, update or delete
 * route belongs in this file. Anything that wants a record's history changed
 * has to change the record.
 *
 * Access requires the dedicated metadata.view permission. It is deliberately
 * shallow after that: the caller may ask about any record whose id they hold.
 * What comes back says when a record was touched and by whom, never what it
 * says, so there is nothing here to gate on the record's own permissions.
 *
 * The administrative endpoints below are a different matter and are gated as
 * such. Asking about one record you already hold the id of is not the same as
 * reading the whole table: that is a list of every record in the system, when
 * it changed and who touched it, which is exactly the shape of an audit trail
 * and is administrators only.
 */
export function registerEntityMetadataRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  requirePermission: PermissionMiddleware,
) {
  app.get(
    "/api/entity-metadata/:entityId",
    requireAuth,
    requirePermission("metadata.view"),
    async (req: Request, res: Response) => {
    const { entityId } = req.params;
    if (!isRecordId(entityId)) {
      return res.status(400).json({ message: "Not a record id" });
    }

    try {
      const metadata = await entityMetadataStorage.get(entityId);
      // A record with nothing recorded is an ordinary answer, not a failure:
      // every record that predates this framework reads this way until
      // something touches it.
      res.json({ metadata: metadata ?? null });
    } catch (error) {
      logger.error("Failed to read entity metadata", {
        service: "entityMetadata",
        entityId,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ message: "Failed to read record metadata" });
    }
    },
  );

  registerEntityMetadataAdminRoutes(app, requireAuth);
}

/** A date the query string carries, as a whole timestamp. */
const dateParam = z.coerce.date().optional();

/** Who a stamp names. */
const personParam = z.string().min(1).optional();

const SORT_COLUMNS = [
  "seq",
  "contextId",
  "createdDate",
  "modifiedDate",
  "subrecordModifiedDate",
] as const satisfies readonly MetadataSortColumn[];

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  // Newest change first: the question this list is usually opened to answer
  // is "what happened recently", not "what exists".
  sort: z.enum(SORT_COLUMNS).default("modifiedDate"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  contextId: z.string().min(1).optional(),
  createdFrom: dateParam,
  createdTo: dateParam,
  createdBy: personParam,
  modifiedFrom: dateParam,
  modifiedTo: dateParam,
  modifiedBy: personParam,
  subrecordFrom: dateParam,
  subrecordTo: dateParam,
  subrecordBy: personParam,
});

const backfillSchema = z.object({
  contextId: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(BACKFILL_BATCH_LIMIT).default(BACKFILL_BATCH_LIMIT),
});

/**
 * Browsing provenance across every table, and filling it in where it is
 * missing.
 *
 * Mounted under `/api/admin/...` rather than beside the per-record read above:
 * `/api/entity-metadata/:entityId` would swallow any literal path segment
 * placed after it, and a separate prefix says what these are without relying
 * on registration order to keep them reachable.
 *
 * The backfill writes, so it is refused while the site is read-only. That
 * falls out of the maintenance-mode lock on the connection pool rather than
 * being arranged here — deliberately: filling in history is exactly the kind
 * of bulk write maintenance mode exists to hold back, so it gets no exemption.
 */
function registerEntityMetadataAdminRoutes(app: Express, requireAuth: AuthMiddleware) {
  const adminOnly = [requireAuth, requireAccess("admin")];

  /**
   * Every table that carries record history, with its label — the list's
   * table filter and the backfill's rows both read from this.
   *
   * No count and no availability: both cost a query per table, and answering
   * for ninety-odd tables in one request would make the page wait on the
   * slowest of them. Each table's own count is asked for separately.
   */
  app.get("/api/admin/entity-metadata/contexts", ...adminOnly, (_req: Request, res: Response) => {
    res.json({
      contexts: listMetadataRecordContexts().map(({ contextId, label, hrefTemplate }) => ({
        contextId,
        label,
        hrefTemplate,
      })),
    });
  });

  /** Everyone named by a provenance row, for the person filters. */
  app.get("/api/admin/entity-metadata/people", ...adminOnly, async (_req: Request, res: Response) => {
    try {
      res.json({ people: await storage.entityMetadataAdmin.listPeople() });
    } catch (error) {
      logger.error("Failed to list record history people", {
        service: "entityMetadata",
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ message: "Failed to list people" });
    }
  });

  /** Provenance rows across every table. */
  app.get("/api/admin/entity-metadata/list", ...adminOnly, async (req: Request, res: Response) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid query", errors: parsed.error.errors });
    }
    const q = parsed.data;

    try {
      const result = await storage.entityMetadataAdmin.list({
        page: q.page,
        limit: q.limit,
        sort: q.sort,
        sortDir: q.sortDir,
        contextId: q.contextId,
        created: { from: q.createdFrom, to: q.createdTo, personId: q.createdBy },
        modified: { from: q.modifiedFrom, to: q.modifiedTo, personId: q.modifiedBy },
        subrecordModified: {
          from: q.subrecordFrom,
          to: q.subrecordTo,
          personId: q.subrecordBy,
        },
      });

      // The label is added here rather than in storage: it comes from the
      // record table registry, and storage does not get to know about labels.
      // Every row uses the same resolver, even when its context has no
      // dedicated destination page; /go/:id explains that case.
      const labels = new Map(
        listMetadataRecordContexts().map((entry) => [entry.contextId, entry.label]),
      );
      res.json({
        ...result,
        data: result.data.map((row) => ({
          ...row,
          contextLabel: labels.get(row.contextId) ?? row.contextId,
          href: recordGoHref(row.entityId),
        })),
      });
    } catch (error) {
      logger.error("Failed to list record history", {
        service: "entityMetadata",
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ message: "Failed to list record history" });
    }
  });

  /** How many of one table's records have no history row yet. */
  app.get(
    "/api/admin/entity-metadata/contexts/:contextId/missing",
    ...adminOnly,
    async (req: Request, res: Response) => {
      try {
        res.json(await storage.entityMetadataAdmin.countMissing(req.params.contextId));
      } catch (error) {
        logger.error("Failed to count records without history", {
          service: "entityMetadata",
          contextId: req.params.contextId,
          error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ message: "Failed to count records without history" });
      }
    },
  );

  /** Fill in history for up to a batch of one table's records. */
  app.post("/api/admin/entity-metadata/backfill", ...adminOnly, async (req: Request, res: Response) => {
    const parsed = backfillSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });
    }
    const { contextId, limit } = parsed.data;

    try {
      const result = await storage.entityMetadataAdmin.backfill(contextId, limit);
      logger.info("Filled in record history", { service: "entityMetadata", ...result });
      res.json(result);
    } catch (error) {
      // A run that stops partway keeps every row it already wrote, so the
      // failure is reported as a failure and the next press continues from
      // where this one reached.
      logger.error("Failed to fill in record history", {
        service: "entityMetadata",
        contextId,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({
        message: error instanceof Error ? error.message : "Failed to fill in record history",
      });
    }
  });
}
