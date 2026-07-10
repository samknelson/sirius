import type { Express, Request, Response, NextFunction } from "express";
import { requireComponent } from "../../components";
import { storage } from "../../../storage";
import { getDrivingDistanceMiles } from "../../../services/driving-distance";
import { distanceInMiles } from "@shared/utils/geocode";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type AccessMiddleware = (
  policyId: string,
  getEntityId?: (req: Request) => string | undefined | Promise<string | undefined>,
) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

const TABLE_MISSING_MESSAGE =
  "BAO distance cache table does not exist. Please enable the BAO component first.";

export function registerBaoDistanceCacheRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  _requirePermission: PermissionMiddleware,
  requireAccess: AccessMiddleware,
) {
  const cacheStorage = storage.baoDistanceCache;
  const componentMiddleware = requireComponent("sitespecific.bao");

  app.get(
    "/api/sitespecific/bao/distance-cache",
    requireAuth,
    componentMiddleware,
    requireAccess("staff"),
    async (_req, res) => {
      try {
        if (!(await cacheStorage.tableExists())) {
          return res.status(503).json({ message: TABLE_MISSING_MESSAGE });
        }
        const rows = await cacheStorage.listAll();
        res.json(rows);
      } catch (error) {
        console.error("Failed to list BAO distance cache:", error);
        res.status(500).json({ message: "Failed to list distance cache" });
      }
    },
  );

  // Re-attempt a real driving-distance lookup for every non-authoritative
  // straight-line row. Rows that now resolve to a driving distance are
  // upgraded; rows that still cannot be routed keep their straight-line value
  // (its computed-at is refreshed). Returns a summary of what changed.
  app.post(
    "/api/sitespecific/bao/distance-cache/rescan",
    requireAuth,
    componentMiddleware,
    requireAccess("admin"),
    async (_req, res) => {
      try {
        if (!(await cacheStorage.tableExists())) {
          return res.status(503).json({ message: TABLE_MISSING_MESSAGE });
        }
        const rows = await cacheStorage.listStraightLine();
        let upgraded = 0;
        let stillStraightLine = 0;
        for (const row of rows) {
          const origin = { latitude: Number(row.originLat), longitude: Number(row.originLng) };
          const destination = { latitude: Number(row.destLat), longitude: Number(row.destLng) };
          const driving = await getDrivingDistanceMiles(origin, destination);
          if (driving.status === "ok") {
            await cacheStorage.upsert({
              originLat: origin.latitude,
              originLng: origin.longitude,
              destLat: destination.latitude,
              destLng: destination.longitude,
              distanceMiles: driving.miles,
              method: "driving",
            });
            upgraded += 1;
          } else {
            await cacheStorage.upsert({
              originLat: origin.latitude,
              originLng: origin.longitude,
              destLat: destination.latitude,
              destLng: destination.longitude,
              distanceMiles: distanceInMiles(origin, destination),
              method: "straight-line",
            });
            stillStraightLine += 1;
          }
        }
        res.json({ scanned: rows.length, upgraded, stillStraightLine });
      } catch (error) {
        console.error("Failed to rescan BAO distance cache:", error);
        res.status(500).json({ message: "Failed to rescan distance cache" });
      }
    },
  );
}
