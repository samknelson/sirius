#!/usr/bin/env npx tsx
/**
 * Smoke test for the component schema push generator.
 *
 * Builds an in-memory schema covering every supported feature
 * (date/time/numeric/uuid/enum/array, FK with cascade, table-level FK,
 * unique constraint, partial unique index, plain index, check, composite PK,
 * SQL defaults, scalar defaults) and asserts the generated SQL contains
 * the expected keywords. Also asserts that unknown column types throw.
 *
 * Run: npx tsx scripts/smoke-test-component-schema-push.ts
 */
import {
  pgTable,
  varchar,
  text,
  integer,
  bigint,
  smallint,
  real,
  doublePrecision,
  interval,
  customType,
  numeric,
  date,
  time,
  timestamp,
  boolean,
  uuid,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
  unique,
  primaryKey,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { generateCreateStatements, detectSchemaDrift } from "../server/services/component-schema-push";

const colorEnum = pgEnum("smoke_color", ["red", "green", "blue"]);

const parent = pgTable("smoke_parent", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
});

const child = pgTable(
  "smoke_child",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    parentId: uuid("parent_id")
      .notNull()
      .references(() => parent.id, { onDelete: "cascade", onUpdate: "cascade" }),
    altParent: uuid("alt_parent"),
    color: colorEnum("color").notNull().default("red"),
    palette: colorEnum("palette").array(),
    qty: integer("qty").notNull().default(0),
    price: numeric("price", { precision: 10, scale: 2 }),
    ymd: date("ymd").notNull(),
    startTime: time("start_time"),
    createdAt: timestamp("created_at").notNull().default(sql`now()`),
    active: boolean("active").notNull().default(true),
    tags: text("tags").array(),
    data: jsonb("data"),
  },
  (t) => [
    index("idx_smoke_child_color").on(t.color),
    uniqueIndex("uidx_smoke_child_active_parent").on(t.parentId).where(sql`${t.active} = true`),
    unique("uq_smoke_child_parent_color").on(t.parentId, t.color),
    foreignKey({
      columns: [t.altParent],
      foreignColumns: [parent.id],
      name: "fk_smoke_child_alt",
    }).onDelete("set null"),
    check("smoke_child_qty_nonneg", sql`${t.qty} >= 0`),
  ],
);

const composite = pgTable(
  "smoke_composite",
  {
    a: varchar("a").notNull(),
    b: varchar("b").notNull(),
    note: text("note"),
  },
  (t) => [primaryKey({ columns: [t.a, t.b], name: "smoke_composite_pk" })],
);

const enums = new Map<string, string[]>([["smoke_color", ["red", "green", "blue"]]]);
const emitted = new Set<string>();

function assertContains(haystack: string, needles: string[], context: string) {
  for (const n of needles) {
    if (!haystack.includes(n)) {
      console.error(`FAIL [${context}]: expected to contain ${JSON.stringify(n)}\n--SQL--\n${haystack}\n-------`);
      process.exit(1);
    }
  }
}

let failed = 0;

async function check_(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (e: any) {
    console.error(`  FAIL ${name}: ${e.message}`);
    failed++;
  }
}

(async () => {
console.log("Smoke testing component schema push generator...\n");

const parentStmts = generateCreateStatements(parent, "smoke_parent", enums, emitted);
const childStmts = generateCreateStatements(child, "smoke_child", enums, emitted);
const compStmts = generateCreateStatements(composite, "smoke_composite", enums, new Set());

const childAll = childStmts.map((s) => s.sql).join("\n;\n");

await check_("parent: uuid PK with default", () => {
  const sql = parentStmts.find((s) => s.kind === "create_table")!.sql;
  assertContains(sql, [`"id" uuid PRIMARY KEY`, `"name" varchar(100) NOT NULL`], "parent");
});

await check_("child: pgEnum CREATE TYPE emitted before table", () => {
  const idx = childStmts.findIndex((s) => s.kind === "create_type" && s.key === "smoke_color");
  const tableIdx = childStmts.findIndex((s) => s.kind === "create_table");
  if (idx < 0) throw new Error("no create_type");
  if (idx >= tableIdx) throw new Error("create_type after create_table");
});

await check_("child: date/time/numeric SQL types correct", () => {
  const sql = childStmts.find((s) => s.kind === "create_table")!.sql;
  assertContains(sql, [`"ymd" date NOT NULL`, `"start_time" time`, `"price" numeric(10, 2)`], "child types");
});

await check_("child: array column", () => {
  const sql = childStmts.find((s) => s.kind === "create_table")!.sql;
  assertContains(sql, [`"tags" text[]`], "child array");
});

await check_("child: enum array column with CREATE TYPE emitted once", () => {
  const sql = childStmts.find((s) => s.kind === "create_table")!.sql;
  assertContains(sql, [`"palette" smoke_color[]`], "enum array column");
  const enumStmts = childStmts.filter((s) => s.kind === "create_type" && s.key === "smoke_color");
  if (enumStmts.length !== 1) throw new Error(`expected exactly 1 CREATE TYPE for smoke_color, got ${enumStmts.length}`);
});

await check_("child: defaults rendered (sql + scalar)", () => {
  const sql = childStmts.find((s) => s.kind === "create_table")!.sql;
  assertContains(sql, [`DEFAULT now()`, `DEFAULT 0`, `DEFAULT true`, `DEFAULT 'red'`], "defaults");
});

await check_("child: inline FK with ON DELETE CASCADE ON UPDATE CASCADE", () => {
  const sql = childStmts.find((s) => s.kind === "create_table")!.sql;
  assertContains(sql, [`FOREIGN KEY ("parent_id") REFERENCES "smoke_parent" ("id") ON DELETE CASCADE ON UPDATE CASCADE`], "inline FK");
});

await check_("child: table-level FK with name and ON DELETE SET NULL", () => {
  const sql = childStmts.find((s) => s.kind === "create_table")!.sql;
  assertContains(sql, [`CONSTRAINT "fk_smoke_child_alt" FOREIGN KEY ("alt_parent") REFERENCES "smoke_parent" ("id") ON DELETE SET NULL`], "table FK");
});

await check_("child: unique constraint", () => {
  const sql = childStmts.find((s) => s.kind === "create_table")!.sql;
  assertContains(sql, [`CONSTRAINT "uq_smoke_child_parent_color" UNIQUE ("parent_id", "color")`], "unique");
});

await check_("child: check constraint", () => {
  const sql = childStmts.find((s) => s.kind === "create_table")!.sql;
  assertContains(sql, [`CONSTRAINT "smoke_child_qty_nonneg" CHECK (`, `>= 0`], "check");
});

await check_("child: plain index emitted as separate CREATE INDEX", () => {
  const idx = childStmts.find((s) => s.kind === "create_index" && s.sql.includes("idx_smoke_child_color"));
  if (!idx) throw new Error("missing index");
  assertContains(idx.sql, [`CREATE INDEX IF NOT EXISTS "idx_smoke_child_color" ON "smoke_child" ("color")`], "index");
});

await check_("child: partial unique index with WHERE clause", () => {
  const idx = childStmts.find((s) => s.kind === "create_index" && s.sql.includes("uidx_smoke_child_active_parent"));
  if (!idx) throw new Error("missing partial index");
  assertContains(idx.sql, [`CREATE UNIQUE INDEX IF NOT EXISTS "uidx_smoke_child_active_parent"`, `WHERE`, `= true`], "partial");
});

await check_("composite: composite primary key constraint", () => {
  const sql = compStmts.find((s) => s.kind === "create_table")!.sql;
  assertContains(sql, [`CONSTRAINT "smoke_composite_pk" PRIMARY KEY ("a", "b")`], "composite PK");
});

await check_("unknown column type throws", () => {
  const fakeCol: any = { columnType: "PgFakeType", name: "x", getSQLType: () => "" };
  const fakeTable: any = {};
  const cs: any = Symbol("drizzle:Columns");
  const ns: any = Symbol("drizzle:Name");
  Object.defineProperty(fakeTable, cs, { value: { x: fakeCol } });
  Object.defineProperty(fakeTable, ns, { value: "smoke_unknown" });
  // Use raw symbol descriptions matching what generator looks for
  const tbl: any = {};
  Object.defineProperty(tbl, Symbol.for("nope"), { value: 1 });
  // Build an actual table with a synthetic column that won't return SQL type
  const realTable: any = {};
  const colsSym = Object.getOwnPropertySymbols(parent).find((s) => s.description === "drizzle:Columns")!;
  const nameSym = Object.getOwnPropertySymbols(parent).find((s) => s.description === "drizzle:Name")!;
  realTable[colsSym] = { x: fakeCol };
  realTable[nameSym] = "smoke_unknown";
  let threw = false;
  try {
    generateCreateStatements(realTable, "smoke_unknown", enums, new Set());
  } catch (e: any) {
    threw = e.message.includes("Cannot determine SQL type");
  }
  if (!threw) throw new Error("expected throw on unknown column type");
});

// For drift-path tests, create a self-contained temp table so the script
// doesn't depend on any pre-existing app table.
const REAL_TABLE = "smoke_drift_temp";
const REAL_COL = "id";
const { storage } = await import("../server/storage");
await storage.rawSql.execute(`DROP TABLE IF EXISTS ${REAL_TABLE} CASCADE`);
await storage.rawSql.execute(`CREATE TABLE ${REAL_TABLE} ("id" varchar PRIMARY KEY)`);
const colsSym = Object.getOwnPropertySymbols(parent).find((s) => s.description === "drizzle:Columns")!;
const nameSym = Object.getOwnPropertySymbols(parent).find((s) => s.description === "drizzle:Name")!;

await check_("drift: unknown column type throws (existing-table path)", async () => {
  const fakeCol: any = { columnType: "PgFakeType", name: REAL_COL, getSQLType: () => "" };
  const realTable: any = {};
  realTable[colsSym] = { id: fakeCol };
  realTable[nameSym] = REAL_TABLE;
  let threw = false;
  try {
    await detectSchemaDrift(realTable, REAL_TABLE);
  } catch (e: any) {
    threw = e.message.includes("Cannot determine SQL type");
  }
  if (!threw) throw new Error("expected drift to throw on unknown column type");
});

await check_("drift: unknown extra-config builder throws", async () => {
  const realEbSym = Object.getOwnPropertySymbols(child).find((s) => s.description === "drizzle:ExtraConfigBuilder")!;
  const realEcSym = Object.getOwnPropertySymbols(child).find((s) => s.description === "drizzle:ExtraConfigColumns")!;
  const realTable: any = {};
  realTable[colsSym] = { id: { name: REAL_COL, getSQLType: () => "varchar", columnType: "PgVarchar" } };
  realTable[nameSym] = REAL_TABLE;
  class WeirdBuilder { name = "weird"; }
  realTable[realEbSym] = () => [new WeirdBuilder()];
  realTable[realEcSym] = realTable[colsSym];
  let threw = false;
  try {
    await detectSchemaDrift(realTable, REAL_TABLE);
  } catch (e: any) {
    threw = e.message.includes("Unrecognized extra-config builder");
  }
  if (!threw) throw new Error("expected drift to throw on unknown extra-config builder");
});

await check_("drift: composite PK reports missing PK when actual PK differs", async () => {
  const tbl = "smoke_drift_composite";
  await storage.rawSql.execute(`DROP TABLE IF EXISTS ${tbl} CASCADE`);
  // Create with WRONG primary key (just "a") to force drift against expected (a, b)
  await storage.rawSql.execute(`CREATE TABLE ${tbl} ("a" varchar PRIMARY KEY, "b" varchar NOT NULL)`);
  const realCompositeStmts = generateCreateStatements(composite, tbl, enums, new Set());
  // Build a synthetic table mirroring `composite` but pointing at our drift table name
  const compColsSym = Object.getOwnPropertySymbols(composite).find((s) => s.description === "drizzle:Columns")!;
  const compNameSym = Object.getOwnPropertySymbols(composite).find((s) => s.description === "drizzle:Name")!;
  const compEbSym = Object.getOwnPropertySymbols(composite).find((s) => s.description === "drizzle:ExtraConfigBuilder")!;
  const compEcSym = Object.getOwnPropertySymbols(composite).find((s) => s.description === "drizzle:ExtraConfigColumns")!;
  const proxy: any = {};
  proxy[compColsSym] = composite[compColsSym as any];
  proxy[compNameSym] = tbl;
  proxy[compEbSym] = composite[compEbSym as any];
  proxy[compEcSym] = composite[compEcSym as any];
  const report = await detectSchemaDrift(proxy, tbl);
  await storage.rawSql.execute(`DROP TABLE IF EXISTS ${tbl} CASCADE`);
  void realCompositeStmts;
  const hasPkDrift = report.missingConstraints.some((c) => c.startsWith("PRIMARY KEY"));
  if (!hasPkDrift) {
    throw new Error(`expected PRIMARY KEY drift but got: ${JSON.stringify(report.missingConstraints)}`);
  }
});

await check_("extended types: bigint/smallint/real/double precision/interval/bytea emit correct SQL", async () => {
  const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });
  const t = pgTable("smoke_types", {
    id: integer("id").primaryKey(),
    big: bigint("big", { mode: "number" }).notNull(),
    small: smallint("small").notNull(),
    r: real("r").notNull(),
    dp: doublePrecision("dp").notNull(),
    iv: interval("iv").notNull(),
    blob: bytea("blob").notNull(),
  });
  const stmts = generateCreateStatements(t, "smoke_types", new Map(), new Set());
  const tableSql = stmts.find((s) => s.kind === "create_table")!.sql;
  for (const expected of ['"big" bigint', '"small" smallint', '"r" real', '"dp" double precision', '"iv" interval', '"blob" bytea']) {
    if (!tableSql.includes(expected)) {
      throw new Error(`expected SQL to contain \`${expected}\` but got:\n${tableSql}`);
    }
  }
});

await check_("renderSql inlines bound parameters in check / partial-index / default expressions", async () => {
  // Sanity: even when a Drizzle SQL expression contains $1-style params, the renderer
  // should inline them as literals (numbers, booleans, strings) rather than throw.
  const tableWithParams = pgTable(
    "smoke_params",
    {
      id: integer("id").primaryKey(),
      name: text("name").notNull().default(sql`'unset'`),
      qty: integer("qty").notNull(),
      active: boolean("active").notNull(),
    },
    (t) => [
      check("smoke_params_qty_pos", sql`${t.qty} >= ${0}`),
      uniqueIndex("uidx_smoke_params_active").on(t.id).where(sql`${t.active} = ${true}`),
    ],
  );
  const stmts = generateCreateStatements(tableWithParams, "smoke_params", new Map(), new Set());
  const tableSql = stmts.find((s) => s.kind === "create_table")!.sql;
  const idxSql = stmts.find((s) => s.kind === "create_index")!.sql;
  if (tableSql.includes("$1") || idxSql.includes("$1")) {
    throw new Error(`bound params not inlined:\n${tableSql}\n${idxSql}`);
  }
  if (!/CHECK \(.*qty.*>=\s*0\)/.test(tableSql)) {
    throw new Error(`check constraint param not inlined:\n${tableSql}`);
  }
  if (!/WHERE\s+.*active.*=\s*TRUE/i.test(idxSql)) {
    throw new Error(`partial-index predicate param not inlined:\n${idxSql}`);
  }
});

await check_("drift: idempotency - generated SQL produces no drift on re-check", async () => {
  // Drop, then create the smoke_child table from the generator's own SQL,
  // then run detectSchemaDrift and assert there is no drift.
  await storage.rawSql.execute(`DROP TABLE IF EXISTS smoke_child CASCADE`);
  await storage.rawSql.execute(`DROP TABLE IF EXISTS smoke_parent CASCADE`);
  await storage.rawSql.execute(`DROP TYPE IF EXISTS smoke_color CASCADE`);
  for (const stmt of generateCreateStatements(parent, "smoke_parent", enums, new Set())) {
    await storage.rawSql.execute(stmt.sql);
  }
  const childEmitted = new Set<string>();
  for (const stmt of generateCreateStatements(child, "smoke_child", enums, childEmitted)) {
    await storage.rawSql.execute(stmt.sql);
  }
  const parentReport = await detectSchemaDrift(parent, "smoke_parent");
  const childReport = await detectSchemaDrift(child, "smoke_child");
  await storage.rawSql.execute(`DROP TABLE IF EXISTS smoke_child CASCADE`);
  await storage.rawSql.execute(`DROP TABLE IF EXISTS smoke_parent CASCADE`);
  await storage.rawSql.execute(`DROP TYPE IF EXISTS smoke_color CASCADE`);
  const totalDrift = (r: any) =>
    r.missingColumns.length + r.typeMismatches.length + r.missingConstraints.length + r.missingIndexes.length;
  if (totalDrift(parentReport) !== 0) {
    throw new Error(`parent drift not idempotent: ${JSON.stringify(parentReport)}`);
  }
  if (totalDrift(childReport) !== 0) {
    throw new Error(`child drift not idempotent: ${JSON.stringify(childReport)}`);
  }
});

await storage.rawSql.execute(`DROP TABLE IF EXISTS ${REAL_TABLE} CASCADE`);

if (failed > 0) {
  console.error(`\n${failed} smoke test(s) FAILED`);
  process.exit(1);
}
console.log(`\nAll smoke tests passed.`);
process.exit(0);
})();
