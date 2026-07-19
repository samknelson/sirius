import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { requireAccess } from "../services/access-policy-evaluator";
import { isComponentEnabledSync } from "../services/component-cache";
import type { SnapshotNode } from "@shared/snapshots";
import { decodeEdlsSheetSnapshot } from "./edls/snapshot-decode";

/**
 * Per-entity-type registration for the generic snapshot API.
 *
 * Authorization is always against the LIVE parent entity: the same policy
 * that gates viewing the entity gates viewing its snapshots, evaluated with
 * the entity id from the URL. The requested snapshot is additionally
 * verified to belong to that entity — never authorized from the snapshot
 * row alone.
 */
interface SnapshotEntityTypeConfig {
  /** Access policy evaluated against the live parent entity id. */
  policyId: string;
  /** Component gating the entity type (undefined = always available). */
  component?: string;
  /** Decode the stored bundle into the live GET endpoint shape(s). */
  decode: (node: SnapshotNode) => unknown;
}

const entityTypes: Record<string, SnapshotEntityTypeConfig> = {
  edls_sheet: {
    policyId: "edls.sheet.view",
    component: "edls",
    decode: decodeEdlsSheetSnapshot,
  },
};

export function registerSnapshotsRoutes(app: Express, requireAuth: any) {
  /**
   * Resolve the entity-type config, 404 on unknown or component-disabled
   * types, then defer to the type's own access policy for the entity id.
   */
  function requireEntityType(req: Request, res: Response, next: NextFunction) {
    const config = entityTypes[req.params.entityType];
    if (!config || (config.component && !isComponentEnabledSync(config.component))) {
      res.status(404).json({ message: "Unknown snapshot entity type" });
      return;
    }
    (req as any).snapshotEntityTypeConfig = config;
    next();
  }

  const requireEntityAccess = (req: Request, res: Response, next: NextFunction) => {
    const config: SnapshotEntityTypeConfig = (req as any).snapshotEntityTypeConfig;
    return requireAccess(config.policyId, (r: Request) => r.params.entityId)(req, res, next);
  };

  // List snapshot metadata for an entity (newest first, no data payloads).
  app.get(
    "/api/snapshots/:entityType/:entityId",
    requireAuth,
    requireEntityType,
    requireEntityAccess,
    async (req, res) => {
      try {
        const { entityType, entityId } = req.params;
        const snapshots = await storage.snapshots.listByEntity(entityType, entityId);
        res.json(snapshots);
      } catch (error) {
        console.error("Failed to list snapshots:", error);
        res.status(500).json({ message: "Failed to list snapshots" });
      }
    },
  );

  // Fetch one snapshot, decoded into the live GET endpoint shape(s).
  app.get(
    "/api/snapshots/:entityType/:entityId/:snapshotId",
    requireAuth,
    requireEntityType,
    requireEntityAccess,
    async (req, res) => {
      try {
        const { entityType, entityId, snapshotId } = req.params;
        const config: SnapshotEntityTypeConfig = (req as any).snapshotEntityTypeConfig;

        const snapshot = await storage.snapshots.get(snapshotId);
        // Verify the snapshot actually belongs to the authorized entity —
        // never trust the snapshot row alone.
        if (!snapshot || snapshot.entityType !== entityType || snapshot.entityId !== entityId) {
          res.status(404).json({ message: "Snapshot not found" });
          return;
        }

        const decoded = config.decode(snapshot.data as SnapshotNode);
        res.json({
          id: snapshot.id,
          entityType: snapshot.entityType,
          entityId: snapshot.entityId,
          createdAt: snapshot.createdAt,
          authorId: snapshot.authorId,
          authorName: snapshot.authorName,
          label: snapshot.label,
          decoded,
        });
      } catch (error) {
        console.error("Failed to fetch snapshot:", error);
        res.status(500).json({ message: "Failed to fetch snapshot" });
      }
    },
  );
}
