import { getClient } from "../../transaction-context";
import { and, eq, asc, getTableName } from "drizzle-orm";
import { tableExists as tableExistsUtil } from "../../utils";
import {
  sitespecificBaoDistanceCache,
  BAO_DISTANCE_CACHE_COORD_PRECISION,
  type BaoDistanceCacheRow,
  type BaoDistanceMethod,
} from "../../../../shared/schema/sitespecific/bao/schema";
import type { StorageLoggingConfig } from "../../middleware/logging";

export type { BaoDistanceCacheRow, BaoDistanceMethod };

/** A worker↔site coordinate pair, as raw (unrounded) decimal degrees. */
export interface DistanceCacheCoords {
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
}

/** The measurement to persist for a coordinate pair. */
export interface DistanceMeasurement extends DistanceCacheCoords {
  distanceMiles: number;
  method: BaoDistanceMethod;
}

export interface BaoDistanceCacheStorage {
  /** Look up a cached measurement for the (rounded) coordinate pair. */
  getByCoords(coords: DistanceCacheCoords): Promise<BaoDistanceCacheRow | undefined>;
  /**
   * Insert or update the cached measurement for a coordinate pair. Coordinates
   * are rounded before keying so effectively-identical pairs collapse to one
   * row. Always refreshes distance, method, and computed-at.
   */
  upsert(measurement: DistanceMeasurement): Promise<BaoDistanceCacheRow>;
  /** All cached rows, newest first — used by the admin config page. */
  listAll(): Promise<BaoDistanceCacheRow[]>;
  /**
   * Only the non-authoritative straight-line rows — used by the admin rescan
   * action, which re-attempts a real driving-distance lookup for each.
   */
  listStraightLine(): Promise<BaoDistanceCacheRow[]>;
  tableExists(): Promise<boolean>;
}

const tableName = getTableName(sitespecificBaoDistanceCache);

/** Round a coordinate to the cache's keying precision, as a numeric string. */
function roundCoord(value: number): string {
  return value.toFixed(BAO_DISTANCE_CACHE_COORD_PRECISION);
}

export function createBaoDistanceCacheStorage(): BaoDistanceCacheStorage {
  return {
    async tableExists(): Promise<boolean> {
      return tableExistsUtil(tableName);
    },

    async getByCoords(coords: DistanceCacheCoords): Promise<BaoDistanceCacheRow | undefined> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const rows = await client
        .select()
        .from(sitespecificBaoDistanceCache)
        .where(
          and(
            eq(sitespecificBaoDistanceCache.originLat, roundCoord(coords.originLat)),
            eq(sitespecificBaoDistanceCache.originLng, roundCoord(coords.originLng)),
            eq(sitespecificBaoDistanceCache.destLat, roundCoord(coords.destLat)),
            eq(sitespecificBaoDistanceCache.destLng, roundCoord(coords.destLng)),
          ),
        );
      return rows[0];
    },

    async upsert(measurement: DistanceMeasurement): Promise<BaoDistanceCacheRow> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const values = {
        originLat: roundCoord(measurement.originLat),
        originLng: roundCoord(measurement.originLng),
        destLat: roundCoord(measurement.destLat),
        destLng: roundCoord(measurement.destLng),
        distanceMiles: measurement.distanceMiles.toFixed(4),
        method: measurement.method,
      };
      const [row] = await client
        .insert(sitespecificBaoDistanceCache)
        .values(values)
        .onConflictDoUpdate({
          target: [
            sitespecificBaoDistanceCache.originLat,
            sitespecificBaoDistanceCache.originLng,
            sitespecificBaoDistanceCache.destLat,
            sitespecificBaoDistanceCache.destLng,
          ],
          set: {
            distanceMiles: values.distanceMiles,
            method: values.method,
            computedAt: new Date(),
          },
        })
        .returning();
      return row;
    },

    async listAll(): Promise<BaoDistanceCacheRow[]> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      return client
        .select()
        .from(sitespecificBaoDistanceCache)
        .orderBy(asc(sitespecificBaoDistanceCache.computedAt));
    },

    async listStraightLine(): Promise<BaoDistanceCacheRow[]> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      return client
        .select()
        .from(sitespecificBaoDistanceCache)
        .where(eq(sitespecificBaoDistanceCache.method, "straight-line"))
        .orderBy(asc(sitespecificBaoDistanceCache.computedAt));
    },
  };
}

export const baoDistanceCacheLoggingConfig: StorageLoggingConfig<BaoDistanceCacheStorage> = {
  module: "sitespecific.bao.distance-cache",
  methods: {
    upsert: {
      enabled: true,
      getEntityId: (_args, result) => result?.id,
      getDescription: (args) => {
        const m = args[0] as DistanceMeasurement;
        return `Cached BAO ${m.method} distance ${m.distanceMiles.toFixed(1)} mi`;
      },
    },
  },
};
