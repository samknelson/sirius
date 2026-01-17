import { createNoopValidator } from './utils/validation';
import { getClient } from './transaction-context';
import { winstonLogs, type WinstonLog } from "@shared/schema";
import { desc, eq, and, sql, or, like, inArray, gte, lte, type SQL } from "drizzle-orm";
import { eventBus, EventType } from "../services/event-bus";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator();

export interface LogsQueryParams {
  page?: number;
  limit?: number;
  module?: string;
  operation?: string;
  search?: string;
}

export interface LogsResult {
  logs: WinstonLog[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface LogFilters {
  modules: string[];
  operations: string[];
}

export interface HostEntityLogsParams {
  hostEntityIds: string[];
  entityIds?: string[];
  module?: string;
  operation?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
}

export interface LogInsertData {
  level?: string | null;
  message?: string | null;
  source?: string | null;
  meta?: unknown | null;
  module?: string | null;
  operation?: string | null;
  entityId?: string | null;
  hostEntityId?: string | null;
  description?: string | null;
  userId?: string | null;
  userEmail?: string | null;
  ipAddress?: string | null;
}

export interface LogsStorage {
  getLogs(params: LogsQueryParams): Promise<LogsResult>;
  getLogFilters(): Promise<LogFilters>;
  getLogById(id: number): Promise<WinstonLog | undefined>;
  getLogsByHostEntityIds(params: HostEntityLogsParams): Promise<WinstonLog[]>;
  create(data: LogInsertData): Promise<WinstonLog>;
}

export function createLogsStorage(): LogsStorage {
  return {
    async getLogs(params: LogsQueryParams): Promise<LogsResult> {
      const client = getClient();
      const page = Math.max(1, params.page ?? 1);
      const limit = Math.min(100, Math.max(1, params.limit ?? 50));
      const offset = (page - 1) * limit;

      const conditions = [];
      if (params.module) {
        conditions.push(eq(winstonLogs.module, params.module));
      }
      if (params.operation) {
        conditions.push(eq(winstonLogs.operation, params.operation));
      }
      if (params.search) {
        conditions.push(
          or(
            like(winstonLogs.description, `%${params.search}%`),
            like(winstonLogs.message, `%${params.search}%`),
            like(winstonLogs.entityId, `%${params.search}%`)
          )
        );
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const [{ count }] = await client
        .select({ count: sql<number>`count(*)::int` })
        .from(winstonLogs)
        .where(whereClause);

      const logs = await client
        .select()
        .from(winstonLogs)
        .where(whereClause)
        .orderBy(desc(winstonLogs.timestamp), desc(winstonLogs.id))
        .limit(limit)
        .offset(offset);

      return {
        logs,
        pagination: {
          page,
          limit,
          total: count,
          totalPages: Math.ceil(count / limit),
        },
      };
    },

    async getLogFilters(): Promise<LogFilters> {
      const client = getClient();
      const [modules, operations] = await Promise.all([
        client.selectDistinct({ module: winstonLogs.module })
          .from(winstonLogs)
          .where(sql`${winstonLogs.module} IS NOT NULL`)
          .orderBy(winstonLogs.module),
        client.selectDistinct({ operation: winstonLogs.operation })
          .from(winstonLogs)
          .where(sql`${winstonLogs.operation} IS NOT NULL`)
          .orderBy(winstonLogs.operation),
      ]);

      return {
        modules: modules.map(m => m.module).filter((m): m is string => m !== null),
        operations: operations.map(o => o.operation).filter((o): o is string => o !== null),
      };
    },

    async getLogById(id: number): Promise<WinstonLog | undefined> {
      const client = getClient();
      const [log] = await client
        .select()
        .from(winstonLogs)
        .where(eq(winstonLogs.id, id))
        .limit(1);

      return log || undefined;
    },

    async getLogsByHostEntityIds(params: HostEntityLogsParams): Promise<WinstonLog[]> {
      const client = getClient();
      const idConditions = [];
      
      if (params.hostEntityIds.length > 0) {
        idConditions.push(inArray(winstonLogs.hostEntityId, params.hostEntityIds));
      }
      if (params.entityIds && params.entityIds.length > 0) {
        idConditions.push(inArray(winstonLogs.entityId, params.entityIds));
      }
      
      if (idConditions.length === 0) {
        return [];
      }

      const conditions = [
        idConditions.length === 1 ? idConditions[0] : or(...idConditions)
      ];

      if (params.module) {
        conditions.push(eq(winstonLogs.module, params.module));
      }
      if (params.operation) {
        conditions.push(eq(winstonLogs.operation, params.operation));
      }
      if (params.startDate) {
        conditions.push(gte(winstonLogs.timestamp, new Date(params.startDate)));
      }
      if (params.endDate) {
        conditions.push(lte(winstonLogs.timestamp, new Date(params.endDate)));
      }

      let query = client
        .select()
        .from(winstonLogs)
        .where(and(...conditions))
        .orderBy(desc(winstonLogs.timestamp));
      
      if (params.limit) {
        query = query.limit(params.limit) as typeof query;
      }

      return query;
    },

    async create(data: LogInsertData): Promise<WinstonLog> {
      const client = getClient();
      const [log] = await client
        .insert(winstonLogs)
        .values({
          level: data.level,
          message: data.message,
          source: data.source,
          meta: data.meta,
          module: data.module,
          operation: data.operation,
          entityId: data.entityId,
          hostEntityId: data.hostEntityId,
          description: data.description,
          userId: data.userId,
          userEmail: data.userEmail,
          ipAddress: data.ipAddress,
        })
        .returning();

      eventBus.emit(EventType.LOG, {
        id: log.id,
        level: log.level,
        message: log.message,
        timestamp: log.timestamp,
        source: log.source,
        meta: log.meta,
        module: log.module,
        operation: log.operation,
        entityId: log.entityId,
        hostEntityId: log.hostEntityId,
        description: log.description,
        userId: log.userId,
        userEmail: log.userEmail,
        ipAddress: log.ipAddress,
      });

      return log;
    },
  };
}
