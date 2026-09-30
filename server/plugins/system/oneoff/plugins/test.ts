import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { PluginConfig } from "@shared/schema";
import type { db } from "../../../../storage/db";
import { registerOneoffPlugin } from "../registry";
import type {
  OneoffAction,
  OneoffContext,
  OneoffExecutionContext,
  OneoffProgress,
} from "../types";

const TABLE = "public.oneoff_test";
const DEFAULT_BATCH_COUNT = 300;
const DEFAULT_BATCH_DELAY_MS = 1000;
const MAX_BATCH_COUNT = 1000;
const MAX_BATCH_DELAY_MS = 60_000;

type Queryable = Pick<typeof db, "execute">;

function requireDb(context: OneoffContext): typeof db {
  if (!context.db) {
    throw new Error("Oneoff action requires a database connection.");
  }
  return context.db;
}

function rowsOf(result: unknown): Record<string, unknown>[] {
  if (
    result &&
    typeof result === "object" &&
    "rows" in result &&
    Array.isArray((result as { rows: unknown }).rows)
  ) {
    return (result as { rows: Record<string, unknown>[] }).rows;
  }
  return [];
}

async function tableExists(database: Queryable): Promise<boolean> {
  const result = await database.execute(sql`
    SELECT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'oneoff_test'
        AND c.relkind IN ('r', 'p')
    ) AS exists
  `);
  return rowsOf(result)[0]?.exists === true;
}

async function countRows(database: Queryable): Promise<number> {
  const result = await database.execute(sql`SELECT count(*)::int AS count FROM ${sql.raw(TABLE)}`);
  const value = rowsOf(result)[0]?.count;
  const count = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("Could not read a valid row count from public.oneoff_test.");
  }
  return count;
}

async function validateTableShape(database: Queryable): Promise<void> {
  if (!(await tableExists(database))) {
    throw new Error("public.oneoff_test does not exist; run action preflight before execution.");
  }
  const relation = await database.execute(sql`
    SELECT c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'oneoff_test'
  `);
  if (rowsOf(relation)[0]?.relkind !== "r") {
    throw new Error("public.oneoff_test exists but is not an ordinary table.");
  }

  const columnsResult = await database.execute(sql`
    SELECT column_name, data_type, udt_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'oneoff_test'
    ORDER BY ordinal_position
  `);
  const columns = rowsOf(columnsResult);
  const id = columns[0];
  const data = columns[1];
  if (
    columns.length !== 2 ||
    id?.column_name !== "id" ||
    id.data_type !== "uuid" ||
    id.is_nullable !== "NO" ||
    typeof id.column_default !== "string" ||
    !id.column_default.includes("gen_random_uuid") ||
    data?.column_name !== "data" ||
    data.udt_name !== "jsonb" ||
    data.is_nullable !== "NO"
  ) {
    throw new Error(
      "public.oneoff_test has an unexpected schema; expected exactly id uuid NOT NULL DEFAULT gen_random_uuid() and data jsonb NOT NULL.",
    );
  }

  const constraintsResult = await database.execute(sql`
    SELECT contype, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid = 'public.oneoff_test'::regclass
    ORDER BY contype
  `);
  const constraints = rowsOf(constraintsResult);
  if (
    constraints.length !== 1 ||
    constraints[0]?.contype !== "p" ||
    String(constraints[0]?.definition).replace(/\s+/g, " ").trim() !== "PRIMARY KEY (id)"
  ) {
    throw new Error(
      "public.oneoff_test has unexpected constraints; expected only a primary key on id.",
    );
  }
}

async function ensureTable(database: Queryable): Promise<void> {
  await database.execute(sql`
    CREATE TABLE IF NOT EXISTS public.oneoff_test (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      data jsonb NOT NULL
    )
  `);
  await validateTableShape(database);
}

function batchOptions(input: unknown): { count: number; delayMs: number } {
  const values =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const count = values.count === undefined ? DEFAULT_BATCH_COUNT : values.count;
  const delayMs = values.delayMs === undefined ? DEFAULT_BATCH_DELAY_MS : values.delayMs;
  if (
    typeof count !== "number" ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > MAX_BATCH_COUNT
  ) {
    throw new Error(`count must be a positive integer no greater than ${MAX_BATCH_COUNT}.`);
  }
  if (
    typeof delayMs !== "number" ||
    !Number.isInteger(delayMs) ||
    delayMs < 1 ||
    delayMs > MAX_BATCH_DELAY_MS
  ) {
    throw new Error(`delayMs must be a positive integer no greater than ${MAX_BATCH_DELAY_MS}.`);
  }
  return { count, delayMs };
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error("Oneoff action was aborted.");
  }
}

function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (delayMs === 0) return Promise.resolve();
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason instanceof Error ? signal.reason : new Error("Oneoff action was aborted."));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function report(
  context: OneoffExecutionContext,
  database: Queryable,
  progress: Omit<OneoffProgress, "rowCount">,
): Promise<void> {
  await context.reportProgress({ ...progress, rowCount: await countRows(database) });
}

function randomJson(): string {
  return JSON.stringify({
    id: randomUUID(),
    value: randomUUID(),
    sequence: Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
  });
}

async function runAction(
  context: OneoffExecutionContext,
  actionId: "run-once" | "run-batch",
): Promise<{ inserted: number; rowCount: number }> {
  const database = requireDb(context);
  const { count, delayMs } =
    actionId === "run-once"
      ? { count: 10, delayMs: 0 }
      : batchOptions(context.input);
  const insertedIds = new Set<string>();

  await validateTableShape(database);
  for (let index = 0; index < count; index += 1) {
    throwIfAborted(context.signal);
    const result = await database.execute(sql`
      INSERT INTO ${sql.raw(TABLE)} (data)
      VALUES (${randomJson()}::jsonb)
      RETURNING id::text AS id
    `);
    const id = rowsOf(result)[0]?.id;
    if (typeof id !== "string") {
      throw new Error("Database did not return the generated oneoff_test row id.");
    }
    if (actionId === "run-batch") insertedIds.add(id);
    await report(context, database, {
      phase: "insert",
      completed: index + 1,
      total: count,
      checkpoint: { generatedId: id },
    });
    await abortableDelay(delayMs, context.signal);
  }

  if (actionId === "run-batch") {
    for (let index = 0; index < count; index += 1) {
      throwIfAborted(context.signal);
      const id = insertedIds.values().next().value as string | undefined;
      if (!id) throw new Error("Generated oneoff_test row tracking became inconsistent.");
      await database.execute(sql`DELETE FROM ${sql.raw(TABLE)} WHERE id = ${id}::uuid`);
      insertedIds.delete(id);
      await report(context, database, {
        phase: "delete",
        completed: index + 1,
        total: count,
        checkpoint: { generatedId: id },
      });
      await abortableDelay(delayMs, context.signal);
    }
  }

  return { inserted: count, rowCount: await countRows(database) };
}

async function preflightRun(context: OneoffContext): Promise<{
  message: string;
  rowCount: number;
  estimatedDurationMs: number;
}> {
  const database = requireDb(context);
  const actionId = context.action;
  const { count, delayMs } =
    actionId === "run-once" ? { count: 10, delayMs: 0 } : batchOptions(context.input);
  await ensureTable(database);
  const rowCount = await countRows(database);
  return {
    message: `This action may create public.oneoff_test. Ready to insert ${count} generated test row(s)${
      actionId === "run-batch" ? " and then delete only those generated rows" : " and keep them"
    }.`,
    rowCount,
    estimatedDurationMs: count * 2 * delayMs,
  };
}

const runOnceAction: OneoffAction = {
  id: "run-once",
  label: "Run once",
  description: "Insert and keep ten random JSON rows in the oneoff_test scratch table.",
  preflightDatabaseAccess: "read-write",
  executeDatabaseAccess: "read-write",
  preflight: preflightRun,
  async execute(context) {
    return runAction(context, "run-once");
  },
};

const runBatchAction: OneoffAction = {
  id: "run-batch",
  label: "Run batch",
  description: "Insert and remove a bounded batch of generated rows with a delay per operation.",
  background: true,
  preflightDatabaseAccess: "read-write",
  executeDatabaseAccess: "read-write",
  preflight: preflightRun,
  async execute(context) {
    return runAction(context, "run-batch");
  },
};

const cleanupAction: OneoffAction = {
  id: "cleanup",
  label: "Drop test table",
  description: "Permanently drops the oneoff_test scratch table after confirmation.",
  destructive: true,
  preflightDatabaseAccess: "read-write",
  executeDatabaseAccess: "read-write",
  async preflight(context) {
    const database = requireDb(context);
    if (!(await tableExists(database))) {
      return { message: "The scratch table does not exist.", rowCount: 0 };
    }
    await validateTableShape(database);
    return {
      message: "The scratch table will be dropped after confirmation.",
      rowCount: await countRows(database),
    };
  },
  async execute(context) {
    const database = requireDb(context);
    throwIfAborted(context.signal);
    if (!(await tableExists(database))) {
      return { message: "The scratch table does not exist.", dropped: false };
    }
    await validateTableShape(database);
    throwIfAborted(context.signal);
    await database.execute(sql`DROP TABLE public.oneoff_test`);
    return { message: "Dropped public.oneoff_test.", dropped: true };
  },
};

const actions: OneoffAction[] = [runOnceAction, runBatchAction, cleanupAction];

registerOneoffPlugin({
  metadata: {
    id: "oneoff-test",
    name: "Oneoff Test",
    description: "Exercises oneoff execution against a disposable database scratch table.",
    singleton: true,
    requiredPolicy: "admin",
  },
  actions,
  async status({ db: database }: { config: PluginConfig; db: typeof db }) {
    const exists = await tableExists(database);
    return { tableExists: exists, rowCount: exists ? await countRows(database) : 0 };
  },
});