/**
 * Reproducible local-only rehearsal. Requires initdb/pg_ctl and installed npm
 * dependencies. Starts its OWN PostgreSQL cluster; never inherits DB/AWS env.
 * Run after: npx tsc -p tsconfig.scripts.json --noEmit
 */
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import pg from "pg";

const root = resolve("generated-artifacts", `s1-files-${Date.now()}`);
await mkdir(root, { recursive: true });
await mkdir(`${root}/archive/private`, { recursive: true });
await mkdir(`${root}/destination`, { recursive: true });
const env = { PATH: process.env.PATH, HOME: root, TZ: "America/Los_Angeles",
  NODE_ENV: "test", CRON_EXECUTION: "disabled", AWS_EC2_METADATA_DISABLED: "true",
  FILESYSTEMS: JSON.stringify({ private: { name: "Synthetic", provider: "local", access: "private",
    provider_settings: { base_path: `${root}/destination` } } }) };
const port = 55449;
const url = `postgresql://fixture@127.0.0.1:${port}/s1_file_target?sslmode=disable`;
env.EXTERNAL_DATABASE_URL = url;
env.DATABASE_URL = url;
function command(program, args, extra = {}) {
  const r = spawnSync(program, args, { env: { ...env, ...extra }, encoding: "utf8", timeout: 180000, maxBuffer: 20 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`synthetic command failed: ${program}\n${r.stdout ?? ""}\n${r.stderr ?? ""}`);
  return r;
}
command("initdb", ["-D", `${root}/pg`, "-U", "fixture", "-A", "trust", "--no-locale"]);
command("pg_ctl", ["-D", `${root}/pg`, "-l", `${root}/postgres.log`, "-o", `-h 127.0.0.1 -p ${port} -k ${root}`, "start"]);
let client;
let checks = 0;
try {
  const admin = new pg.Client({ connectionString: url.replace("/s1_file_target?", "/postgres?") });
  await admin.connect();
  await admin.query("CREATE DATABASE s1_file_source");
  await admin.query("CREATE DATABASE s1_file_target");
  await admin.end();
  command("node", ["--import", "tsx", "scripts/s1-migration/dev/file-fixture.ts", "schema"]);
  client = new pg.Client({ connectionString: url }); await client.connect();
  assert.equal((await client.query("SELECT current_database() AS name")).rows[0].name, "s1_file_target");
  const q = (sql, values) => client.query(sql, values);
  await q("INSERT INTO variables(name,value) VALUES ('system_mode','\"maintenance\"'),('components','{\"ledger\":true}')");
  await q("INSERT INTO variables(name,value) VALUES ('entity_files_config',$1::jsonb)", [JSON.stringify(
    Object.fromEntries(["worker", "employer", "ledger_payment"].map(c => [c, { file_system: "private", directory: `${c}/:entity-id` }]))
  )]);
  await q("INSERT INTO contacts(id,display_name) VALUES ('contact-a','Synthetic A'),('contact-b','Synthetic B')");
  await q("INSERT INTO workers(id,contact_id,sirius_id) VALUES ('worker-a','contact-a','1'),('worker-b','contact-b','4')");
  await q("INSERT INTO employers(id,name) VALUES ('employer-a','Synthetic Employer')");
  await q("INSERT INTO options_ledger_payment_type(id,name) VALUES ('payment-type','Synthetic')");
  await q("INSERT INTO ledger_accounts(id,name) VALUES ('account-a','Synthetic')");
  await q("INSERT INTO ledger_ea(id,account_id,entity_type,entity_id) VALUES ('ea-a','account-a','employer','employer-a')");
  await q("INSERT INTO ledger_payments(id,amount,status,payment_type,ledger_ea_id) VALUES ('payment-a','1','cleared','payment-type','ea-a')");
  const source = new pg.Client({ connectionString: url.replace("/s1_file_target?", "/s1_file_source?") });
  await source.connect();
  assert.equal((await source.query("SELECT current_database() AS name")).rows[0].name, "s1_file_source");
  await source.query("CREATE TABLE file_managed(fid bigint PRIMARY KEY,uid bigint,filename text,uri text,filemime text,filesize bigint,status integer,timestamp bigint)");
  for (let fid = 1; fid <= 7; fid++) {
    await source.query("INSERT INTO file_managed VALUES($1,8,$2,$3,'APPLICATION/PDF',9,1,1600000000)",
      [fid, `CANARY_FILENAME_${fid}.pdf`, `private://CANARY_URI_${fid}`]);
    await writeFile(`${root}/archive/private/CANARY_URI_${fid}`, "synthetic");
  }
  await source.end();
  command("node", ["--import", "tsx", "scripts/s1-migration/dev/file-fixture.ts", "stage"]);
  await q(`INSERT INTO s1_staging.id_map(entity,s1_id,s2_id,loader) VALUES
    ('worker',1,'worker-a','fixture'),('worker',4,'worker-b','fixture'),
    ('employer',2,'employer-a','fixture'),('payment',3,'payment-a','fixture')`);
  await q("INSERT INTO users(id,email) VALUES ('uploader-a','synthetic-uploader@example.test')");
  await q(`INSERT INTO s1_staging.id_map(entity,s1_id,s2_id,stub,loader) VALUES
    ('user',8,'uploader-a',true,'fixture'),('user',9,'uploader-a',false,'fixture'),
    ('user',10,'missing-user',false,'fixture')`);
  await q("UPDATE s1_staging.raw_file_managed SET uid=9 WHERE fid=2");
  await q("UPDATE s1_staging.raw_file_managed SET uid=10 WHERE fid=3");
  const allowed = "mapping_repaired,mapping_dangling,size_differs";
  const refuse = async (args) => {
    const r = spawnSync("node", ["--import", "tsx", "scripts/s1-migration/load-files.ts",
      "--archive-directory", `${root}/archive`, ...args], { env, encoding: "utf8", timeout: 180000 });
    assert.equal(r.status, 1);
    assert.ok(!/CANARY_/.test(`${r.stdout}${r.stderr}`));
  };
  // Dry bootstrap refuses absent types, and a name collision cannot create a
  // partial set of the other five definitions.
  await refuse(["--dry-run"]);
  assert.equal((await q("SELECT count(*)::int n FROM options_file_type")).rows[0].n, 0);
  await q("INSERT INTO options_file_type(id,name) VALUES ('collision','Payment Document')");
  await refuse([]);
  assert.equal((await q("SELECT count(*)::int n FROM options_file_type")).rows[0].n, 1);
  await q("DELETE FROM options_file_type WHERE id='collision'");
  async function run(args = [], exit = 0) {
    const resultPath = `${root}/result.json`;
    await rm(resultPath, { force: true });
    const r = spawnSync("node", ["--import", "tsx", "scripts/s1-migration/load-files.ts",
      "--archive-directory", `${root}/archive`, "--migration-mode", "--allow-findings", allowed, ...args],
      { env: { ...env, S1_RESULT_JSON_PATH: resultPath }, encoding: "utf8", timeout: 180000, maxBuffer: 10 * 1024 * 1024 });
    const output = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
    assert.ok(!/CANARY_(?:FILENAME|URI|MATERIAL|NODE)/.test(output), "console canary");
    if (r.status !== exit) throw new Error(`loader expected ${exit}, got ${r.status}\n${output}`);
    const result = JSON.parse(await readFile(resultPath, "utf8"));
    assert.ok(!/CANARY_/.test(JSON.stringify(result)), "report canary");
    checks++;
    return result;
  }
  let r = await run();
  assert.equal(r.summary.created, 6); assert.equal(r.verify.failures, 0);
  assert.equal(r.detail.archive_only, 1);
  assert.equal((await q("SELECT uploaded_by FROM files WHERE metadata->'s1'->>'fid'='2'")).rows[0].uploaded_by, "uploader-a");
  for (const fid of [1, 3]) assert.equal((await q("SELECT uploaded_by FROM files WHERE metadata->'s1'->>'fid'=$1", [String(fid)])).rows[0].uploaded_by, "system:s1-migration");
  command("node", ["--import", "tsx", "scripts/s1-migration/dev/file-fixture.ts", "access"]);
  r = await run(); assert.equal(r.summary.unchanged, 6); assert.equal(r.detail.archiveGets, 0);
  assert.equal(r.summary.updated + r.summary.created + r.summary.deleted, 0);
  // Provider-stat verification failure remains retryable on an ordinary run.
  const existingPath = (await q("SELECT storage_path FROM files WHERE metadata->'s1'->>'fid'='1'")).rows[0].storage_path;
  await writeFile(`${root}/destination/${existingPath}`, "short");
  r = await run(["--force-reconcile"], 1); assert.equal(r.verify.failures, 1);
  await writeFile(`${root}/destination/${existingPath}`, "synthetic");
  r = await run(); assert.equal(r.verify.failures, 0); assert.equal(r.detail.archiveGets, 0);
  await q(`UPDATE s1_staging.records SET fields=jsonb_set(fields,'{field_sirius_json}',
    to_jsonb('{"material":{"title":"CANARY_MATERIAL_CHANGED"}}'::text)) WHERE nid=10`);
  r = await run(); assert.equal(r.detail.metadataUpdates, 1); assert.equal(r.detail.archiveGets, 0);
  await q("DELETE FROM s1_staging.id_map WHERE entity='file' AND s1_id=1");
  r = await run(); assert.equal(r.detail.archiveGets, 0); assert.ok(r.findings.some(f => f.kind === "mapping_repaired"));
  await q("DELETE FROM files WHERE id=(SELECT s2_id FROM s1_staging.id_map WHERE entity='file' AND s1_id=2)");
  r = await run(); assert.equal(r.summary.created, 1); assert.ok(r.findings.some(f => f.kind === "mapping_dangling"));
  // The attachment-bearing logs are deliberately not restaged or edited.
  await q(`INSERT INTO s1_staging.records(bundle,nid,fields) VALUES('sirius_log',900,
    '{"field_sirius_category":"sirius_worker","field_sirius_type":"merge","field_sirius_log_handler":[4],"field_sirius_json":"{\\"nid\\":1}"}')`);
  r = await run(); assert.equal(r.summary.updated, 3);
  assert.equal((await q("SELECT entity_id FROM entity_files WHERE data->>'s1Fid'='1'")).rows[0].entity_id, "worker-b");
  const snapshot = async () => {
    const values = [];
    for (const table of ["files", "entity_files", "options_file_type", "s1_staging.id_map", "s1_staging.runs", "variables", "entity_metadata", "winston_logs"]) {
      values.push((await q(`SELECT to_jsonb(t)::text AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows);
    }
    return JSON.stringify(values);
  };
  const before = await snapshot();
  r = await run(["--dry-run"]);
  assert.equal(await snapshot(), before);
  await q("DELETE FROM s1_staging.records WHERE nid=12");
  r = await run(); assert.equal(r.summary.deleted, 1);
  assert.equal((await readFile(`${root}/archive/private/CANARY_URI_3`, "utf8")), "synthetic");
  assert.equal((await q("SELECT count(*)::int AS n FROM files")).rows[0].n, 5);
  async function add(fid, { uri = `private://CANARY_URI_${fid}`, timestamp = 1600000000, bytes = "synthetic", category = "comment" } = {}) {
    await q(`INSERT INTO s1_staging.raw_file_managed(fid,uid,filename,uri,filemime,filesize,status,timestamp,content_hash)
      VALUES($1,8,'CANARY_FILENAME.pdf',$2,'application/pdf',9,1,$3,$4)`, [fid, uri, timestamp, `hash-${fid}`]);
    await q(`INSERT INTO s1_staging.records(bundle,nid,title,fields,content_hash)
      VALUES('sirius_log',$1,'CANARY_NODE_TITLE',$2::jsonb,$3)`,
      [1000 + fid, JSON.stringify({ field_sirius_category: category, field_sirius_log_handler: [1], field_sirius_attachments: [{ fid }] }), `hash-${fid}`]);
    await q("UPDATE s1_staging.file_inventory_evidence SET row_count=(SELECT count(*) FROM s1_staging.raw_file_managed)");
    if (bytes !== null) await writeFile(`${root}/archive/private/CANARY_URI_${fid}`, bytes);
  }
  await add(80, { bytes: null, timestamp: Math.floor(Date.now() / 1000) });
  await add(81, { bytes: null });
  await add(82, { uri: "temporary://CANARY_URI_MISSING", bytes: null });
  await add(83, { bytes: "synthetic-long" });
  r = await run(["--max-bytes", "9", "--allow-rejects", "bytes_missing,too_large"]);
  assert.equal(r.detail.bytes_pending, 1); assert.equal(r.rejectGate.counts.bytes_missing, 2);
  assert.equal(r.rejectGate.counts.too_large, 1); assert.equal(r.verify.failures, 0);
  await q("DELETE FROM s1_staging.records WHERE nid BETWEEN 1080 AND 1083");
  // The full candidate set remains present under a new-write limit.
  await add(84); await add(85);
  r = await run(["--limit", "1"]); assert.equal(r.summary.created, 1); assert.equal(r.detail.limited, 1);
  r = await run(); assert.equal(r.summary.created, 1);
  // A committed create followed by a mapping failure must keep bytes for adoption.
  await add(86);
  await q(`CREATE FUNCTION fixture_map_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.entity='file' AND NEW.s1_id=86 THEN RAISE EXCEPTION 'CANARY_MAPPING_FAILURE'; END IF; RETURN NEW; END $$`);
  await q("CREATE TRIGGER fixture_map_failure BEFORE INSERT ON s1_staging.id_map FOR EACH ROW EXECUTE FUNCTION fixture_map_failure()");
  r = await run(["--allow-rejects", "create_failed"]); assert.equal(r.rejectGate.counts.create_failed, 1);
  assert.equal((await q("SELECT count(*)::int n FROM files WHERE metadata->'s1'->>'fid'='86'")).rows[0].n, 1);
  await q("DROP TRIGGER fixture_map_failure ON s1_staging.id_map");
  r = await run(); assert.equal(r.detail.archiveGets, 0); assert.ok(r.findings.some(f => f.kind === "mapping_repaired"));
  // Row-transaction failure rolls back both rows and compensates uploaded bytes.
  await add(87);
  const objectCountBeforeRollback = (await readdir(`${root}/destination`, { recursive: true, withFileTypes: true })).filter(e => e.isFile()).length;
  await q(`CREATE FUNCTION fixture_attachment_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.data->>'s1Fid'='87' THEN RAISE EXCEPTION 'CANARY_ATTACHMENT_FAILURE'; END IF; RETURN NEW; END $$`);
  await q("CREATE TRIGGER fixture_attachment_failure BEFORE UPDATE ON entity_files FOR EACH ROW EXECUTE FUNCTION fixture_attachment_failure()");
  r = await run(["--allow-rejects", "create_failed"]); assert.equal(r.rejectGate.counts.create_failed, 1);
  assert.equal((await q("SELECT count(*)::int n FROM files WHERE metadata->'s1'->>'fid'='87'")).rows[0].n, 0);
  assert.equal((await readdir(`${root}/destination`, { recursive: true, withFileTypes: true })).filter(e => e.isFile()).length, objectCountBeforeRollback);
  await q("DROP TRIGGER fixture_attachment_failure ON entity_files");
  r = await run(); assert.equal(r.summary.created, 1);
  await add(88, { bytes: null });
  await mkdir(`${root}/archive/private/CANARY_URI_88`);
  r = await run(["--allow-rejects", "archive_head_failed"]);
  assert.equal(r.rejectGate.counts.archive_head_failed, 1);
  assert.equal(r.rejectGate.counts.bytes_missing, undefined);
  await q("DELETE FROM s1_staging.records WHERE nid=1088");
  // Exercise real worker/contact resolution rather than only pure precedence.
  await q("INSERT INTO contacts(id,display_name) VALUES ('ambiguous-contact','Synthetic Ambiguous')");
  await q("INSERT INTO workers(id,contact_id,sirius_id) VALUES ('ambiguous-a','ambiguous-contact','701'),('ambiguous-b','ambiguous-contact','702')");
  await q(`INSERT INTO s1_staging.records(bundle,nid,fields) VALUES
    ('sirius_contact',600,'{}'),('sirius_contact',601,'{}'),
    ('sirius_worker',602,'{}'),('sirius_payment',603,'{}'),('grievance_shop',604,'{}')`);
  await q(`INSERT INTO s1_staging.id_map(entity,s1_id,s2_id,loader) VALUES
    ('contact',600,'contact-a','fixture'),('contact',601,'ambiguous-contact','fixture')`);
  for (const [fid, handler] of [[90,600],[91,601],[92,602],[93,603],[94,604]]) {
    await add(fid);
    await q("UPDATE s1_staging.records SET fields=jsonb_set(fields,'{field_sirius_log_handler}',$2::jsonb) WHERE nid=$1",
      [1000 + fid, JSON.stringify([handler])]);
  }
  await add(95, { category: "trust:election_wizard" });
  await q(`UPDATE s1_staging.records SET fields=fields || $1::jsonb WHERE nid=1095`, [JSON.stringify({
    field_sirius_log_handler: [], field_sirius_type: "draft",
    field_sirius_json: JSON.stringify({ wizard: { trust_election: { policy: { worker_nid: 4 },
      documents: { 95: { relationship_nid: 999 } } } } }),
  })]);
  await add(96, { category: "CANARY_UNRULED_CATEGORY" });
  r = await run(["--allow-rejects", "worker_ambiguous,worker_unmapped,payment_unmapped,employer_unmapped,category_unruled"]);
  assert.equal(r.summary.created, 2);
  for (const reason of ["worker_ambiguous", "worker_unmapped", "payment_unmapped", "employer_unmapped", "category_unruled"]) {
    assert.equal(r.rejectGate.counts[reason], 1);
  }
  assert.deepEqual((await q("SELECT data->>'s1WizardStatus' status,data->>'s1RelationshipNid' relationship FROM entity_files WHERE data->>'s1Fid'='95'")).rows[0],
    { status: "draft", relationship: "999" });
  await q("DELETE FROM s1_staging.records WHERE nid IN (1091,1092,1093,1094,1096)");
  // Preflight deletion cap applies to the whole set, before the first delete.
  for (let i = 100; i < 151; i++) await add(i);
  r = await run(); assert.equal(r.summary.created, 51);
  await q("DELETE FROM s1_staging.records WHERE nid BETWEEN 1100 AND 1150");
  r = await run([], 1); assert.equal(r.summary.deleted, 0);
  assert.ok(r.findings.some(f => f.kind === "sweep_over_limit" && f.detail.count === 51));
  r = await run(["--allow-findings", `${allowed},sweep_over_limit`]); assert.equal(r.summary.deleted, 51);
  assert.equal(await readFile(`${root}/archive/private/CANARY_URI_100`, "utf8"), "synthetic");
  assert.equal((await q("SELECT count(*)::int AS n FROM winston_logs WHERE message LIKE '%CANARY_%' OR meta::text LIKE '%CANARY_%'")).rows[0].n, 0);
  await writeFile(`${root}/evidence.json`, JSON.stringify({ checks, result: "PASS", scope: "isolated PostgreSQL source adapter and real target storage; local bytes only" }, null, 2));
  console.log(JSON.stringify({ result: "PASS", checks, evidence: `${root}/evidence.json` }));
} finally {
  await client?.end();
  command("pg_ctl", ["-D", `${root}/pg`, "stop", "-m", "immediate"]);
}
