/**
 * Framework-wide regression value: exact production triggers plus independently
 * cached real consumers, on isolated PostgreSQL data. No public-table writes.
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { fork, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { pool } from "../../server/storage/db";
import { CONFIGURATION_REVISION_DDL } from "../../server/storage/configuration-revision-ddl";
import type { PoolClient } from "pg";

const namespace = `config_test_${randomBytes(8).toString("hex")}`;
let writer: PoolClient;
let other: PoolClient;
const replicas: ChildProcess[] = [];
let sequence = 0;

function command(child: ChildProcess, name: string): Promise<any> {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.off("message", listener); reject(new Error(`Replica command timed out: ${name}`)); }, 15_000);
    function listener(result: any) {
      if (result.id !== id) return;
      clearTimeout(timer);
      child.off("message", listener);
      result.error ? reject(new Error(result.error)) : resolve(result.response);
    }
    child.on("message", listener);
    child.send({ id, command: name });
  });
}

async function replica() {
  const child = fork(new URL("./fixtures/configuration-replica.ts", import.meta.url), [namespace], {
    execArgv: ["--import", "tsx"], stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  replicas.push(child);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Replica startup timed out")), 15_000);
    child.on("message", (message: any) => {
      if (message.ready) { clearTimeout(timer); resolve(); }
    });
    child.once("exit", code => { clearTimeout(timer); reject(new Error(`Replica exited during startup: ${code}`)); });
    // Drain logs but never relay data/connection diagnostics.
    child.stdout?.resume();
    child.stderr?.resume();
  });
  return child;
}

async function revisions() {
  const result = await writer.query("SELECT scope, revision::text FROM configuration_revisions");
  return Object.fromEntries(result.rows.map(row => [row.scope, row.revision])) as Record<string, string>;
}

beforeAll(async () => {
  writer = await pool.connect();
  other = await pool.connect();
  await writer.query(`CREATE SCHEMA ${namespace}`);
  for (const client of [writer, other]) await client.query(`SET search_path TO ${namespace}`);
  // Clone actual schema/defaults, but no rows or FK references to public data.
  for (const table of ["variables", "plugin_configs", "plugin_configs_event_notifier", "plugin_configs_cron"]) {
    await writer.query(`CREATE TABLE ${table} (LIKE public.${table} INCLUDING ALL)`);
  }
  await writer.query(CONFIGURATION_REVISION_DDL);
  await writer.query(`INSERT INTO variables(name,value) VALUES ('ENV_COHERENCY_TEST','"initial"'), ('system_mode','"live"')`);
  await writer.query(`INSERT INTO plugin_configs(id,plugin_kind,plugin_id,name,enabled,data)
    VALUES ('00000000-0000-4000-8000-000000000019','event-notifier','test','initial',true,'{}')`);
  await writer.query(`INSERT INTO plugin_configs_event_notifier(id,media)
    VALUES ('00000000-0000-4000-8000-000000000019','email')`);
  await Promise.all([replica(), replica()]);
}, 30_000);

afterAll(async () => {
  for (const child of replicas) {
    if (child.connected) await command(child, "stop").catch(() => child.kill());
    else child.kill();
  }
  if (writer) {
    await writer.query("ROLLBACK");
    await writer.query("SET search_path TO public");
    await writer.query(`DROP SCHEMA IF EXISTS ${namespace} CASCADE`);
    writer.release();
  }
  if (other) {
    await other.query("ROLLBACK");
    await other.query("SET search_path TO public");
    other.release();
  }
});

it("converges after edits, missed polls, renames, subsidiary changes, deletes and process restart", async () => {
  const [a, b] = replicas;
  expect((await command(a, "poll")).env.COHERENCY_TEST).toBe("initial");
  await command(b, "poll");
  await writer.query(`UPDATE variables SET name='ENV_RENAMED', value='"changed"' WHERE name='ENV_COHERENCY_TEST'`);
  await writer.query(`UPDATE plugin_configs SET name='changed'`);
  await writer.query(`UPDATE plugin_configs_event_notifier SET media='sms'`);
  await writer.query(`INSERT INTO variables(name,value) VALUES
    ('site_terminology','{"worker":{"singular":"Member","plural":"Members"}}')`);
  expect((await command(b, "state")).env.COHERENCY_TEST).toBe("initial");
  const current = await command(a, "poll");
  expect(current.env).toEqual({ RENAMED: "changed" });
  expect(current.plugins[0]).toMatchObject({ name: "changed", media: "sms" });
  expect(current.terminology.worker.singular).toBe("Member");
  expect(await command(b, "poll")).toEqual(current);
  await writer.query(`DELETE FROM variables WHERE name='ENV_RENAMED'`);
  await writer.query("DELETE FROM plugin_configs_event_notifier");
  await writer.query("DELETE FROM plugin_configs");
  await writer.query("DELETE FROM variables WHERE name='site_terminology'");
  const removed = await command(a, "poll");
  expect(removed.env).toEqual({});
  expect(removed.plugins).toEqual([]);
  expect(removed.terminology.worker.singular).toBe("Worker");
  const recovered = await replica();
  expect(await command(recovered, "poll")).toEqual(removed);
});

it("publishes only committed atomic revisions and cannot lose concurrent increments", async () => {
  const before = await revisions();
  await writer.query("BEGIN");
  await writer.query(`INSERT INTO variables(name,value) VALUES ('ENV_COHERENCY_TEST','"rollback"')`);
  expect((await other.query("SELECT revision::text FROM configuration_revisions WHERE scope='environment'")).rows[0].revision).toBe(before.environment);
  await writer.query("ROLLBACK");
  expect(await revisions()).toEqual(before);
  await Promise.all([
    writer.query(`INSERT INTO variables(name,value) VALUES ('ENV_COHERENCY_TEST','"committed"')`),
    other.query(`INSERT INTO variables(name,value) VALUES ('ENV_CONCURRENT','"concurrent"')`),
  ]);
  expect(BigInt((await revisions()).environment)).toBe(BigInt(before.environment) + 2n);
  const state = await command(replicas[0], "poll");
  expect(state.env.COHERENCY_TEST).toBe("committed");
  expect((await command(replicas[0], "ambient")).env.COHERENCY_TEST).toBe("committed");
  expect((await command(replicas[1], "poll")).env.COHERENCY_TEST).toBe("committed");
});

it("installs coverage on later optional tables, ignores business variables and persists global reloads", async () => {
  const before = await revisions();
  await writer.query(`INSERT INTO variables(name,value) VALUES ('unrelated_business_state','{}')`);
  expect(await revisions()).toEqual(before);
  await writer.query("CREATE TABLE plugin_configs_dispatch (id text PRIMARY KEY, job_type text)");
  await writer.query("SELECT install_configuration_revision_triggers()");
  await writer.query("INSERT INTO plugin_configs_dispatch VALUES ('test','first')");
  expect(BigInt((await revisions()).plugins)).toBe(BigInt(before.plugins) + 1n);
  await writer.query(`INSERT INTO configuration_revisions(scope,revision) VALUES ('global',1)
    ON CONFLICT(scope) DO UPDATE SET revision=configuration_revisions.revision+1`);
  await command(replicas[0], "poll");
  expect((await revisions()).global).toBe("1");
});

it("propagates maintenance both ways and allows only the sanctioned escape write", async () => {
  await writer.query(`UPDATE variables SET value='"maintenance"' WHERE name='system_mode'`);
  expect((await command(replicas[0], "poll")).maintenance).toBe(true);
  expect((await command(replicas[1], "poll")).maintenance).toBe(true);
  await expect(command(replicas[0], "ambient")).rejects.toThrow(/read-only/);
  expect((await command(replicas[0], "escape")).maintenance).toBe(false);
  expect((await command(replicas[1], "poll")).maintenance).toBe(false);
});

it("bounds stalled reads and recovers on the next healthy request", async () => {
  const started = Date.now();
  await expect(command(replicas[0], "timeout")).rejects.toThrow(/statement timeout|timed out/);
  expect(Date.now() - started).toBeLessThan(5_000);
  expect((await command(replicas[0], "poll")).maintenance).toBe(false);
});
