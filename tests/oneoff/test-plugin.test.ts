import { beforeEach, describe, expect, it, vi } from "vitest";

const { databaseState, database, registeredPlugin } = vi.hoisted(() => {
  const databaseState: {
    exists: boolean;
    rows: Map<string, unknown>;
    sequence: number;
    deleted: string[];
    dropped: number;
  } = { exists: false, rows: new Map(), sequence: 1, deleted: [], dropped: 0 };
  const database: any = {
    execute: vi.fn(async (query: { text: string }) => {
      const text = query.text.replace(/\s+/g, " ").trim();
      if (text.startsWith("CREATE TABLE IF NOT EXISTS")) {
        databaseState.exists = true;
        return { rows: [] };
      }
      if (text.includes("SELECT EXISTS")) return { rows: [{ exists: databaseState.exists }] };
      if (text.includes("SELECT c.relkind")) {
        return { rows: databaseState.exists ? [{ relkind: "r" }] : [] };
      }
      if (text.includes("information_schema.columns")) {
        return { rows: [
          { column_name: "id", data_type: "uuid", is_nullable: "NO", column_default: "gen_random_uuid()" },
          { column_name: "data", udt_name: "jsonb", is_nullable: "NO" },
        ] };
      }
      if (text.includes("FROM pg_constraint")) {
        return { rows: [{ contype: "p", definition: "PRIMARY KEY (id)" }] };
      }
      if (text.startsWith("SELECT count(*)")) return { rows: [{ count: databaseState.rows.size }] };
      if (text.startsWith("INSERT INTO")) {
        const id = `00000000-0000-4000-8000-${String(databaseState.sequence++).padStart(12, "0")}`;
        databaseState.rows.set(id, {});
        return { rows: [{ id }] };
      }
      if (text.startsWith("DELETE FROM")) {
        const id = text.match(/WHERE id = '([^']+)'::uuid/)?.[1];
        if (id) {
          databaseState.deleted.push(id);
          databaseState.rows.delete(id);
        }
        return { rows: [] };
      }
      if (text.startsWith("DROP TABLE")) {
        databaseState.exists = false;
        databaseState.rows.clear();
        databaseState.dropped += 1;
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL in Oneoff test: ${text}`);
    }),
  };
  const registeredPlugin: { value?: any } = {};
  return { databaseState, database, registeredPlugin };
});

vi.mock("../../server/storage/db", () => ({ db: database }));
vi.mock("drizzle-orm", () => ({
  sql: Object.assign((strings: TemplateStringsArray, ...values: any[]) => ({
    text: strings.reduce((text, chunk, index) => {
      const value = values[index];
      if (value === undefined) return text + chunk;
      if (value && typeof value === "object" && "raw" in value) return text + chunk + value.raw;
      return text + chunk + `'${String(value).replace(/'/g, "''")}'`;
    }, ""),
  }), { raw: (raw: string) => ({ raw }) }),
}));
vi.mock("../../server/plugins/system/oneoff/registry", () => ({
  registerOneoffPlugin: (plugin: any) => { registeredPlugin.value = plugin; },
  getOneoffPlugin: (id: string) => id === registeredPlugin.value?.metadata.id ? registeredPlugin.value : undefined,
}));

import "../../server/plugins/system/oneoff/plugins/test";
import { getOneoffPlugin } from "../../server/plugins/system/oneoff/registry";

const plugin = getOneoffPlugin("oneoff-test")!;
const config = { id: "isolated-oneoff-plugin-config", pluginId: "oneoff-test" } as any;

function executionContext(action: string, input: unknown = {}) {
  const progress: any[] = [];
  return {
    progress,
    context: {
      config,
      action,
      input,
      db: database,
      signal: new AbortController().signal,
      reportProgress: async (value: any) => { progress.push(value); },
    } as any,
  };
}

beforeEach(() => {
  databaseState.exists = false;
  databaseState.rows.clear();
  databaseState.sequence = 1;
  databaseState.deleted.length = 0;
  databaseState.dropped = 0;
  database.execute.mockClear();
});

describe("Oneoff test plugin scratch-table operations", () => {
  it("preflights and run-once retains ten generated rows and reports the whole-table count", async () => {
    const runOnce = plugin.actions.find((action) => action.id === "run-once")!;
    const preflight = await runOnce.preflight({ config, action: "run-once", input: {}, db: database });
    expect(preflight.rowCount).toBe(0);
    expect(preflight.message).toContain("keep them");

    // A pre-existing row proves the plugin reports and preserves the complete table,
    // not only the rows created by this invocation.
    databaseState.rows.set("preserved-row", { data: { from: "outside this run" } });
    const { context, progress } = executionContext("run-once");
    const result = await runOnce.execute(context);
    expect(result).toEqual({ inserted: 10, rowCount: 11 });
    expect(databaseState.rows.size).toBe(11);
    expect(databaseState.deleted).toEqual([]);
    expect(progress.at(-1)).toMatchObject({ phase: "insert", completed: 10, rowCount: 11 });
  });

  it("batch deletes only its generated IDs and leaves unrelated rows untouched", async () => {
    const runBatch = plugin.actions.find((action) => action.id === "run-batch")!;
    databaseState.exists = true;
    databaseState.rows.set("unrelated-row", { data: { keep: true } });
    const preflight = await runBatch.preflight({
      config, action: "run-batch", input: { count: 1, delayMs: 1 }, db: database,
    });
    expect(preflight.rowCount).toBe(1);
    expect(preflight.estimatedDurationMs).toBe(2);

    const { context, progress } = executionContext("run-batch", { count: 1, delayMs: 1 });
    const result = await runBatch.execute(context);
    expect(result).toEqual({ inserted: 1, rowCount: 1 });
    expect(databaseState.rows.has("unrelated-row")).toBe(true);
    expect(databaseState.deleted).toHaveLength(1);
    expect(databaseState.deleted[0]).not.toBe("unrelated-row");
    expect(progress.map((item) => item.phase)).toEqual(["insert", "delete"]);
    expect(progress.at(-1)).toMatchObject({ completed: 1, rowCount: 1 });
  });

  it("cleanup drops only the verified scratch table", async () => {
    databaseState.exists = true;
    databaseState.rows.set("isolated-row", {});
    const cleanup = plugin.actions.find((action) => action.id === "cleanup")!;
    const preflight = await cleanup.preflight({ config, action: "cleanup", input: {}, db: database });
    expect(preflight.rowCount).toBe(1);
    const result = await cleanup.execute({
      config, action: "cleanup", input: {}, db: database,
      signal: new AbortController().signal, reportProgress: async () => {},
    } as any);
    expect(result).toMatchObject({ dropped: true });
    expect(databaseState.exists).toBe(false);
    expect(databaseState.dropped).toBe(1);
  });
});