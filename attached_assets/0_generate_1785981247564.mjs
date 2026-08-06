#!/usr/bin/env node
/**
 * S1 synthetic data generator
 * ---------------------------
 * Populates the Railway-hosted S1 dev database (MariaDB 10.6.25, real prod
 * schema, zero real rows) with synthetic Drupal-7-shaped data for all 40
 * populated bundles, at small volume (~50 workers), with deliberately seeded
 * edge cases ("traps") at known counts.
 *
 * Usage:
 *   S1_DATABASE_URL='mysql://root:PW@host:port/smf_prod' node generate.mjs
 *
 * Safety:
 *   - Refuses to run against hostnames containing 'rds.amazonaws.com'.
 *   - TRUNCATEs only tables it is about to repopulate.
 *   - Deterministic PRNG: same seed -> same data.
 */

import mysql from 'mysql2/promise';

// ----------------------------------------------------------------- config
const DSN = process.env.S1_DATABASE_URL;
if (!DSN) { console.error('Set S1_DATABASE_URL'); process.exit(1); }
if (/rds\.amazonaws\.com/i.test(DSN)) {
  console.error('REFUSING: DSN looks like an AWS RDS endpoint. This tool is for the synthetic dev DB only.');
  process.exit(1);
}

const SEED = Number(process.env.GEN_SEED || 20260803);
const N_WORKERS = Number(process.env.GEN_WORKERS || 50);
const TZ_NOTE = 'America/Los_Angeles';

// Deterministic PRNG (mulberry32)
let _s = SEED >>> 0;
function rnd() { _s |= 0; _s = (_s + 0x6D2B79F5) | 0; let t = Math.imul(_s ^ (_s >>> 15), 1 | _s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[ri(0, arr.length - 1)];
const chance = (p) => rnd() < p;

// ------------------------------------------------------------- name pools
const FIRST = ['Maria','Jose','Ana','Luis','Carmen','Miguel','Rosa','Juan','Elena','Carlos',
  'Sofia','Diego','Lucia','Pedro','Isabel','Antonio','Teresa','Manuel','Patricia','Rafael',
  'Kim','Wei','Mei','Ahmed','Fatima','John','Sarah','Michael','Jennifer','David'];
const LAST = ['Garcia','Rodriguez','Martinez','Hernandez','Lopez','Gonzalez','Perez','Sanchez',
  'Ramirez','Torres','Flores','Rivera','Gomez','Diaz','Munoz','Nguyen','Kim','Chen','Wong','Smith'];
// Accented variants used ONLY for the latin1 memo trap
const ACCENTED = ['Muñoz','Rodríguez','García','Peña','Núñez','Hernández'];
const HOTELS = ['Sunset Grand Hotel','Harbor View Resort','Downtown Plaza Hotel','Airport Marriott',
  'Wilshire Suites','The Beverly Arms','Pacific Crown Hotel','Union Station Inn','Figueroa Tower Hotel','Century Park Hotel'];
const DOMAINS = [1]; // single sirius_domain node

// ------------------------------------------------- nid allocation strategy
// Real prod nids span ~2.4M-22M. We allocate sparse ranges per bundle so
// nothing downstream can get away with assuming small or dense ids.
let nextNid = 2_400_000;
function allocNid() { nextNid += ri(3, 900); return nextNid; }
let nextTid = 1500;
const RESERVED_TIDS = new Set([1521,1522,1523,1505,1506,1510,1630,1672,1667,1678,1628,1666,1673,1688,1544,1682,1637,1634,1633,1632,1635,1691,1662,1636,1701,907,908]); // all hardcoded tids
function allocTid() {
  do { nextTid += ri(1, 9); } while (RESERVED_TIDS.has(nextTid));
  return nextTid;
}
let nextUid = 10;
function allocUid() { return ++nextUid; }
let nextFid = 100;
function allocFid() { return ++nextFid; }

// One deliberately huge nid to hit the top of the observed range
const HUGE_NID_TARGET = 21_990_000;

// -------------------------------------------------------------- trap ledger
const traps = {};
function trap(name, n = 1) { traps[name] = (traps[name] || 0) + n; }

// -------------------------------------------------------------- connection
const conn = await mysql.createConnection(DSN + (DSN.includes('?') ? '&' : '?') + 'multipleStatements=false&ssl=0');
console.log('Connected. Verifying target...');
const [[ver]] = await conn.query('SELECT VERSION() v');
if (!/10\.6\.25-MariaDB/.test(ver.v)) { console.error(`Unexpected server: ${ver.v}`); process.exit(1); }
const [[tc]] = await conn.query(`SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema=DATABASE()`);
if (tc.n !== 818) { console.error(`Expected 818 tables, found ${tc.n}. Wrong database?`); process.exit(1); }
console.log(`Target OK: ${ver.v}, 818 tables.\n`);

// ------------------------------------------- schema introspection utilities
const colCache = new Map();
async function columnsOf(table) {
  if (colCache.has(table)) return colCache.get(table);
  const [rows] = await conn.query(
    `SELECT column_name name, data_type dt, column_type ct, is_nullable nullable
     FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? ORDER BY ordinal_position`, [table]);
  colCache.set(table, rows);
  return rows;
}
async function tableExists(table) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?`, [table]);
  return rows.length > 0;
}

const skipped = [];
async function truncateIf(table) {
  if (!(await tableExists(table))) { skipped.push(table); return false; }
  await conn.query(`TRUNCATE TABLE \`${table}\``);
  return true;
}

// Generic field_data_* writer.
// Discovers value columns by introspection; fills them by name/type heuristics.
async function writeField(table, rows) {
  // rows: [{entity_type, bundle, entity_id, revision_id, delta, deleted, values:{col:val}}]
  if (!rows.length) return 0;
  if (!(await tableExists(table))) { skipped.push(table); return 0; }
  const cols = await columnsOf(table);
  const names = cols.map(c => c.name);
  const out = [];
  for (const r of rows) {
    const rec = {
      entity_type: r.entity_type || 'node',
      bundle: r.bundle,
      deleted: r.deleted ?? 0,
      entity_id: r.entity_id,
      revision_id: r.revision_id ?? r.entity_id,
      language: 'und',
      delta: r.delta ?? 0,
    };
    for (const [k, v] of Object.entries(r.values || {})) rec[k] = v;
    // keep only real columns
    const filtered = {};
    for (const n of names) if (n in rec) filtered[n] = rec[n];
    out.push(filtered);
  }
  const keys = Object.keys(out[0]);
  const placeholders = out.map(() => `(${keys.map(() => '?').join(',')})`).join(',');
  const flat = out.flatMap(o => keys.map(k => o[k]));
  await conn.query(`INSERT INTO \`${table}\` (${keys.map(k => `\`${k}\``).join(',')}) VALUES ${placeholders}`, flat);
  return out.length;
}

// datetime helpers ---------------------------------------------------------
// D7 stores datetime strings 'YYYY-MM-DD HH:MM:SS'.
function dt(y, mo, d, h = 0, mi = 0, s = 0) {
  const p = (n) => String(n).padStart(2, '0');
  return `${y}-${p(mo)}-${p(d)} ${p(h)}:${p(mi)}:${p(s)}`;
}
function randDate(y1, y2) { return dt(ri(y1, y2), ri(1, 12), ri(1, 28), ri(0, 23), ri(0, 59), 0); }
function unix(y, mo, d) { return Math.floor(Date.UTC(y, mo - 1, d, ri(0, 23)) / 1000); }

// ============================================================== generation
console.log(`Seed ${SEED}, ${N_WORKERS} workers. Generating...\n`);

// ---- 0. wipe target tables (only those we write) -------------------------
const FIELD_TABLES_WIPED = new Set();
async function fd(table, rows) {
  if (!FIELD_TABLES_WIPED.has(table)) { await truncateIf(table); FIELD_TABLES_WIPED.add(table); }
  return writeField(table, rows);
}
for (const t of ['node','node_revision','users','users_roles','taxonomy_term_data','taxonomy_term_hierarchy',
  'taxonomy_vocabulary','file_managed','comment','sirius_ledger_ar','sirius_ledger_balance']) {
  await truncateIf(t);
}

// ---- 1. taxonomy ---------------------------------------------------------
// Minimal vocabularies: worker statuses, member statuses, payment types,
// election types (observed tids 1521-1523), relationship types, industries.
const vocab = {};
async function makeVocab(machine, terms) {
  const vid = Object.keys(vocab).length + 1;
  await conn.query(`INSERT INTO taxonomy_vocabulary (vid, name, machine_name, description, hierarchy, module, weight)
    VALUES (?,?,?,'',0,'taxonomy',0)`, [vid, machine, machine]);
  vocab[machine] = {};
  for (const t of terms) {
    const tid = t.tid || allocTid();
    await conn.query(`INSERT INTO taxonomy_term_data (tid, vid, name, description, format, weight)
      VALUES (?,?,?,'',NULL,0)`, [tid, vid, t.name]);
    vocab[machine][t.name] = tid;
  }
  return vid;
}
// Real prod vocabularies with real tids.
// work_status is vestigial (2 rows in prod) but the vocab exists:
await makeVocab('sirius_work_status', [{name:'Active',tid:1505},{name:'Disability',tid:1506},{name:'Retired',tid:1510},{name:'Deceased',tid:1630}]);
// member_status = industry/policy + hours threshold eligibility groups:
await makeVocab('sirius_member_status', [
  {name:'UNITE HERE Worker - 60 hours',tid:1672},
  {name:'Event Center Worker - 100 hours',tid:1667},
  {name:'Unite Here Restaurant Worker - 60 Hours',tid:1678},
  {name:'Event Center Worker - 80 hours',tid:1628},
  {name:'Event Center Worker - 60 hours',tid:1666},
  {name:'PA Worker',tid:1673},
  {name:'UNITE HERE Worker - 40 Hours',tid:1688},
]);
// hour types: live 1600-series + 1544 (900-series legacy terms exist in vocab but never in data)
await makeVocab('sirius_hour_type', [
  {name:'Active',tid:1544},{name:'No Charge',tid:1682},{name:'Terminated',tid:1637},
  {name:'LOA',tid:1634},{name:'FMLA',tid:1633},{name:'Disability',tid:1632},
  {name:'Military Leave',tid:1635},{name:'Initial Eligibility',tid:1691},
  {name:'Deceased',tid:1662},{name:'COBRA',tid:1636},
  {name:'Vacation',tid:907},{name:'Apprentice',tid:908}, // legacy gen: in vocab, never in data
]);
await makeVocab('sirius_payment_type', [{name:'Check'},{name:'Card'},{name:'Cash'},{name:'ACH'}]);
await makeVocab('sirius_election_type', [{name:'FirstTime',tid:1521},{name:'OpenEnrollment',tid:1522},{name:'LifeEvent',tid:1523}]);
await makeVocab('sirius_reltype', [{name:'Spouse'},{name:'Child'},{name:'DomesticPartner'}]);
await makeVocab('grievance_industry', [{name:'Hotel'},{name:'Food Service'},{name:'Airport'}]);
console.log('taxonomy: done');

// ---- 2. users ------------------------------------------------------------
const userUids = [];
for (let i = 0; i < 6; i++) {
  const uid = allocUid();
  userUids.push(uid);
  await conn.query(`INSERT INTO users (uid, name, pass, mail, theme, signature, signature_format, created, access, login, status, timezone, language, picture, init, data)
    VALUES (?,?,'','', '','',NULL,?,?,?,1,?, '',0,'',NULL)`,
    [uid, `staff${i+1}`, unix(2020, 1, 1), unix(2026, 7, 1), unix(2026, 7, 1), TZ_NOTE]);
}
console.log('users: done');

// ---- 3. helper to create node rows --------------------------------------
async function makeNode(bundle, title, opts = {}) {
  const nid = opts.nid ?? allocNid();
  const status = opts.status ?? 1;
  const created = opts.created ?? unix(ri(2019, 2026), ri(1, 12), ri(1, 28));
  await conn.query(`INSERT INTO node (nid, vid, type, language, title, uid, status, created, changed, comment, promote, sticky, tnid, translate)
    VALUES (?,?,?,?,?,?,?,?,?,0,0,0,0,0)`,
    [nid, nid, bundle, 'und', title, pick(userUids), status, created, created + ri(0, 10_000_000)]);
  await conn.query(`INSERT INTO node_revision (nid, vid, uid, title, log, timestamp, status, comment, promote, sticky)
    VALUES (?,?,?,?,'',?,?,0,0,0)`, [nid, nid, pick(userUids), title, created, status]);
  return nid;
}

// ---- 4. sirius_domain, ledger accounts, trust benefits, providers -------
const domainNid = await makeNode('sirius_domain', 'BAO');
const ledgerAccounts = [];
for (const nm of ['Employer Contributions','Employee Contributions','HWIP']) {
  const nid = await makeNode('sirius_ledger_account', nm);
  ledgerAccounts.push(nid);
  await fd('field_data_field_sirius_name_short', [{bundle:'sirius_ledger_account', entity_id:nid, values:{field_sirius_name_short_value:nm.split(' ')[0]}}]);
  await fd('field_data_field_sirius_id', [{bundle:'sirius_ledger_account', entity_id:nid, values:{field_sirius_id_value:`GL-${ri(100,999)}`}}]);
}
const providers = [];
for (const nm of ['Kaiser','Health Net','Delta Dental']) providers.push(await makeNode('sirius_trust_provider', nm));
const benefits = [];
for (const nm of ['Medical','Dental','Vision','Life']) {
  const nid = await makeNode('sirius_trust_benefit', nm);
  benefits.push(nid);
  await fd('field_data_field_sirius_id', [{bundle:'sirius_trust_benefit', entity_id:nid, values:{field_sirius_id_value:`BEN-${nm.toUpperCase().slice(0,3)}`}}]);
}
console.log('domain/accounts/benefits/providers: done');

// ---- 5. employers (grievance_shop) --------------------------------------
const employers = [];
for (let i = 0; i < HOTELS.length; i++) {
  const nid = await makeNode('grievance_shop', HOTELS[i]);
  employers.push(nid);
  await fd('field_data_field_grievance_external_id', [{bundle:'grievance_shop', entity_id:nid, values:{field_grievance_external_id_value:`H${String(i).padStart(4,'0')}`}}]);
  await fd('field_data_field_sirius_industry', [{bundle:'grievance_shop', entity_id:nid, values:{field_sirius_industry_tid:vocab['grievance_industry']['Hotel']}}]);
}
// shop contacts
for (let i = 0; i < 8; i++) {
  const nid = await makeNode('grievance_shop_contact', `${pick(FIRST)} ${pick(LAST)} (HR)`);
  await fd('field_data_field_grievance_shops', [{bundle:'grievance_shop_contact', entity_id:nid, values:{field_grievance_shops_target_id:pick(employers)}}]);
  await fd('field_data_field_grievance_co_email', [{bundle:'grievance_shop_contact', entity_id:nid, values:{field_grievance_co_email_value:`hr${i}@example.test`}}]);
}
// small employer-adjacent bundles
for (const nm of ['ACME Parent Co','Coastal Hospitality Group','Union Square Partners'])
  await makeNode('grievance_company', nm);
await makeNode('grievance_chapter', 'Chapter 1');
await makeNode('grievance_chapter', 'Chapter 2');
await makeNode('grievance_holiday', 'New Year 2026');
await makeNode('grievance_holiday', 'Labor Day 2026');
console.log('employers: done');

// ---- 6. contacts + workers ----------------------------------------------
const contacts = [];   // {nid, first, last}
const workers = [];    // {nid, contactNid, ssn}
const usedSsns = [];

function makeSsn() { return `${ri(100,899)}-${String(ri(1,99)).padStart(2,'0')}-${String(ri(1,9999)).padStart(4,'0')}`; }

for (let i = 0; i < N_WORKERS; i++) {
  const first = pick(FIRST), last = pick(LAST);
  const cnid = await makeNode('sirius_contact', `${first} ${last}`);
  contacts.push({ nid: cnid, first, last });
  await fd('field_data_field_sirius_email', [{bundle:'sirius_contact', entity_id:cnid, values:{field_sirius_email_value:`${first}.${last}.${i}@example.test`.toLowerCase()}}]);
  await fd('field_data_field_sirius_phone', [{bundle:'sirius_contact', entity_id:cnid, values:{field_sirius_phone_value:`310-555-${String(ri(0,9999)).padStart(4,'0')}`}}]);
  // TRAP: multi-value contact tags (delta 0..2) on ~30% of contacts
  if (chance(0.3)) {
    const tags = [];
    for (let d = 0; d <= ri(1, 2); d++) tags.push({bundle:'sirius_contact', entity_id:cnid, delta:d, values:{field_sirius_contact_tags_value:`tag${d}`}});
    await fd('field_data_field_sirius_contact_tags', tags);
    trap('multi_value_contact_tags_contacts');
  }

  // worker
  const isHuge = i === N_WORKERS - 1; // last worker gets a huge nid
  const wnid = isHuge ? HUGE_NID_TARGET + ri(0, 5000) : await makeNode('sirius_worker', `${first} ${last}`);
  if (isHuge) {
    await conn.query(`INSERT INTO node (nid, vid, type, language, title, uid, status, created, changed, comment, promote, sticky, tnid, translate)
      VALUES (?,?,?,?,?,?,1,?,?,0,0,0,0,0)`,
      [wnid, wnid, 'sirius_worker', 'und', `${first} ${last}`, pick(userUids), unix(2024,1,1), unix(2024,1,1)]);
    await conn.query(`INSERT INTO node_revision (nid, vid, uid, title, log, timestamp, status, comment, promote, sticky)
      VALUES (?,?,?,?,'',?,1,0,0,0)`, [wnid, wnid, pick(userUids), `${first} ${last}`, unix(2024,1,1)]);
    trap('huge_nid_worker');
  }

  // SSN: TRAPS — collisions (2 pairs) and format variants (3 no-dash)
  let ssn;
  if (i === 10 || i === 11) { ssn = usedSsns[0] || makeSsn(); if (i === 10) usedSsns[0] = ssn; trap('ssn_collision_rows'); }
  else if (i === 20 || i === 21) { ssn = usedSsns[1] || makeSsn(); if (i === 20) usedSsns[1] = ssn; trap('ssn_collision_rows'); }
  else ssn = makeSsn();
  if ([5, 15, 25].includes(i)) { ssn = ssn.replaceAll('-', ''); trap('ssn_no_dash_format'); }
  await fd('field_data_field_sirius_ssn', [{bundle:'sirius_worker', entity_id:wnid, values:{field_sirius_ssn_value:ssn}}]);

  // DOB: tz_handling=none -> LA wall time literal. TRAP: three DOBs at 00:30
  // (would slip a day if wrongly treated as UTC), one inside DST spring gap.
  let dob;
  if ([3, 13, 23].includes(i)) { dob = dt(ri(1960, 1999), ri(1, 12), ri(2, 27), 0, 30, 0); trap('dob_midnight_edge'); }
  else if (i === 33) { dob = dt(1987, 3, 8, 2, 30, 0); trap('dob_dst_gap'); } // 2:30am Mar 8 — gap in some years
  else dob = dt(ri(1955, 2003), ri(1, 12), ri(1, 28), 0, 0, 0);
  await fd('field_data_field_sirius_dob', [{bundle:'sirius_worker', entity_id:wnid, values:{field_sirius_dob_value:dob}}]);

  await fd('field_data_field_sirius_contact', [{bundle:'sirius_worker', entity_id:wnid, values:{field_sirius_contact_target_id:cnid}}]);

  // work_status: RARE in prod (167 rows / 117,679 workers = 0.14%).
  // Seed only 2 so the path is exercisable without being misleadingly common.
  if (i < 2) {
    await fd('field_data_field_sirius_work_status', [{bundle:'sirius_worker', entity_id:wnid, values:{field_sirius_work_status_tid:vocab['sirius_work_status'][chance(0.85)?'Active':'Suspended']}}]);
    trap('rare_work_status');
  }

  // member_status: ordered worker->eligibility-group association (§4.8).
  // Real distribution: ~58% of workers have >=1 assignment; of those,
  // 97.8% have exactly one; delta 0 is the PRIMARY (1672 dominates it).
  if (chance(0.58)) {
    const primaryPool = [1672,1672,1672,1672,1672,1672,1672,1672,1667,1678,1628,1666,1673]; // weighted
    const secondaryPool = [1628,1667,1666,1673,1678];
    const rows = [{bundle:'sirius_worker', entity_id:wnid, delta:0, values:{field_sirius_member_status_tid:pick(primaryPool)}}];
    if (chance(0.022)) { // ~2.2% multi-value
      const extra = ri(1, 3);
      const used = new Set([rows[0].values.field_sirius_member_status_tid]);
      for (let d = 1; d <= extra; d++) {
        const t = pick(secondaryPool);
        if (used.has(t)) continue;
        used.add(t);
        rows.push({bundle:'sirius_worker', entity_id:wnid, delta:rows.length, values:{field_sirius_member_status_tid:t}});
      }
    }
    await fd('field_data_field_sirius_member_status', rows);
    if (rows.length > 1) trap('multi_value_member_status_workers');
    trap('worker_with_member_status');
  } else {
    trap('worker_without_member_status');
  }

  // Four distinct worker identifier types (confirmed from S1 field labels):
  //   field_sirius_id  = "Sirius ID"   field_sirius_id2 = "Union ID"
  //   field_sirius_id3 = "External ID" field_sirius_aat = "AAT"
  await fd('field_data_field_sirius_id', [{bundle:'sirius_worker', entity_id:wnid, values:{field_sirius_id_value:String(600000 + i)}}]);
  // Union ID is sparse in prod (blank on the sample worker inspected)
  if (chance(0.6)) await fd('field_data_field_sirius_id2', [{bundle:'sirius_worker', entity_id:wnid, values:{field_sirius_id2_value:`M${String(100000+i)}`}}]);
  else trap('worker_without_union_id');
  await fd('field_data_field_sirius_id3', [{bundle:'sirius_worker', entity_id:wnid, values:{field_sirius_id3_value:`U${String(5990600 + i * 7).padStart(8,'0')}`}}]);
  // AAT: variable-length numeric external identifier (observed 365 / 6917 / 92464 / 415499)
  await fd('field_data_field_sirius_aat', [{bundle:'sirius_worker', entity_id:wnid, values:{field_sirius_aat_value:String(pick([ri(100,999), ri(1000,9999), ri(10000,99999), ri(100000,999999)]))}}]);

  workers.push({ nid: wnid, contactNid: cnid, first, last });
}
// TRAP: 2 unpublished workers
for (let k = 0; k < 2; k++) {
  const first = pick(FIRST), last = pick(LAST);
  const nid = await makeNode('sirius_worker', `${first} ${last}`, { status: 0 });
  await fd('field_data_field_sirius_ssn', [{bundle:'sirius_worker', entity_id:nid, values:{field_sirius_ssn_value:makeSsn()}}]);
  trap('unpublished_worker');
}
// TRAP: deleted=1 field rows for 3 workers (old SSN rows marked deleted)
for (let k = 0; k < 3; k++) {
  const w = workers[k];
  await fd('field_data_field_sirius_ssn', [{bundle:'sirius_worker', entity_id:w.nid, deleted:1, values:{field_sirius_ssn_value:makeSsn()}}]);
  trap('deleted_field_row');
}
// TRAP: orphan reference — a contact field pointing at a nonexistent nid
await fd('field_data_field_sirius_contact', [{bundle:'sirius_worker', entity_id:workers[7].nid, deleted:0, delta:1, values:{field_sirius_contact_target_id:19_999_999}}]);
trap('orphan_target_id');
// TRAP: field rows for taxonomy_term & user entity types in a shared table
await fd('field_data_field_sirius_id', [
  {entity_type:'taxonomy_term', bundle:'sirius_work_status', entity_id:vocab['sirius_work_status']['Active'], values:{field_sirius_id_value:'TT-1'}},
  {entity_type:'user', bundle:'user', entity_id:userUids[0], values:{field_sirius_id_value:'U-1'}},
]);
trap('nonnode_entity_rows', 2);
console.log(`contacts+workers: done (${workers.length} workers)`);

// ---- 7. relationships ----------------------------------------------------
for (let i = 0; i < 15; i++) {
  const w = pick(workers);
  const depFirst = pick(FIRST);
  const nid = await makeNode('sirius_contact_relationship', `${depFirst} ${w.last}`);
  const depContact = await makeNode('sirius_contact', `${depFirst} ${w.last}`);
  await fd('field_data_field_sirius_contact_alt', [{bundle:'sirius_contact_relationship', entity_id:nid, values:{field_sirius_contact_alt_target_id:depContact}}]);
  await fd('field_data_field_sirius_contact_reltype', [{bundle:'sirius_contact_relationship', entity_id:nid, values:{field_sirius_contact_reltype_tid:pick([vocab['sirius_reltype']['Spouse'],vocab['sirius_reltype']['Child'],vocab['sirius_reltype']['DomesticPartner']])}}]);
}
console.log('relationships: done');

// ---- 8. payperiods (hours) ----------------------------------------------
// tz_handling=site on field_sirius_datetime* -> values are UTC.
// TRAP: two payperiod completion datetimes at month boundary (UTC 02:00 on
// the 1st == prior month 18:00 LA).
let ppCount = 0;
for (const w of workers) {
  const emp = pick(employers);
  for (let m = 0; m < 6; m++) { // Jan-Jun 2026
    const nid = await makeNode('sirius_payperiod', `PP ${w.last} 2026-${String(m+1).padStart(2,'0')}`);
    await fd('field_data_field_sirius_worker', [{bundle:'sirius_payperiod', entity_id:nid, values:{field_sirius_worker_target_id:w.nid}}]);
    await fd('field_data_field_grievance_shop', [{bundle:'sirius_payperiod', entity_id:nid, values:{field_grievance_shop_target_id:emp}}]);
    await fd('field_data_field_sirius_date_start', [{bundle:'sirius_payperiod', entity_id:nid, values:{field_sirius_date_start_value:dt(2026, m+1, 1)}}]);
    await fd('field_data_field_sirius_date_end', [{bundle:'sirius_payperiod', entity_id:nid, values:{field_sirius_date_end_value:dt(2026, m+1, 28)}}]);
    const boundary = ppCount < 2;
    const completed = boundary ? dt(2026, m+2 > 12 ? 12 : m+2, 1, 2, 0, 0) : randDate(2026, 2026);
    if (boundary) trap('utc_month_boundary_datetime');
    await fd('field_data_field_sirius_datetime_completed', [{bundle:'sirius_payperiod', entity_id:nid, values:{field_sirius_datetime_completed_value:completed}}]);
    await fd('field_data_field_sirius_active', [{bundle:'sirius_payperiod', entity_id:nid, values:{field_sirius_active_value:1}}]);

    // JSON payload per §4.12. Hours live at $.totals.hours.total.
    // by_type keyed by hour_type tid, exactly one key. INT/DOUBLE mix on total.
    // Hour-type distribution skews heavily Active; seed the derivation-relevant
    // types (Terminated/LOA/FMLA/Disability) deterministically on early rows.
    let htid = 1544; // Active
    if (ppCount === 3) { htid = 1637; trap('pp_hourtype_terminated'); }
    else if (ppCount === 4) { htid = 1634; trap('pp_hourtype_loa'); }
    else if (ppCount === 5) { htid = 1633; trap('pp_hourtype_fmla'); }
    else if (ppCount === 6) { htid = 1632; trap('pp_hourtype_disability'); }
    else if (chance(0.01)) { htid = 1682; }
    const totalHours = ppCount % 2 === 0 ? ri(20, 180) : ri(20, 180) + 0.5; // INT/DOUBLE mix
    if (ppCount % 2 !== 0) trap('pp_total_double');
    const source = chance(0.91) ? 'import' : (chance(0.99) ? 'upload' : 'manual');
    const ppJson = {
      entries: { [source]: { rows: ri(1, 8) } },
      totals: { hours: {
        total: totalHours,
        by_type: { [String(htid)]: totalHours },
        by_dept: { front: totalHours },
        by_type_dept: { [String(htid)]: { front: totalHours } },
        by_dept_type: { front: { [String(htid)]: totalHours } },
        by_day: { '01': totalHours },
      }},
      reconcile: { msg: 'ok' },
    };
    if (chance(0.37)) ppJson.smf = { autotag: { status: { run_ts: unix(2026, m+1, 5), asof_ts: unix(2026, m+1, 4) } } };
    await fd('field_data_field_sirius_json', [{bundle:'sirius_payperiod', entity_id:nid, values:{field_sirius_json_value:JSON.stringify(ppJson)}}]);
    // TRAP: rare nid-keyed entries (2 payperiods)
    if (ppCount === 7 || ppCount === 8) {
      // overwrite with nid-keyed source
      const j2 = {...ppJson, entries: { '16357282': { rows: 1 } }};
      await conn.query(`UPDATE field_data_field_sirius_json SET field_sirius_json_value=? WHERE entity_type='node' AND bundle='sirius_payperiod' AND entity_id=? AND delta=0`, [JSON.stringify(j2), nid]);
      trap('pp_entries_nid_key');
    }
    // TRAP: 2 legacy-format rows (array entries, daily/monthly/payperiod totals)
    if (ppCount === 9 || ppCount === 10) {
      const legacy = { entries: [{h: 8}], totals: { daily: 8, monthly: 160, payperiod: 80 }, hours: {} };
      await conn.query(`UPDATE field_data_field_sirius_json SET field_sirius_json_value=? WHERE entity_type='node' AND bundle='sirius_payperiod' AND entity_id=? AND delta=0`, [JSON.stringify(legacy), nid]);
      trap('pp_legacy_format');
    }
    ppCount++;
  }
}
// employer payperiods
for (const emp of employers) {
  for (let m = 0; m < 3; m++) {
    const nid = await makeNode('sirius_employer_payperiod', `EPP 2026-${String(m+1).padStart(2,'0')}`);
    await fd('field_data_field_grievance_shop', [{bundle:'sirius_employer_payperiod', entity_id:nid, values:{field_grievance_shop_target_id:emp}}]);
    await fd('field_data_field_sirius_date_start', [{bundle:'sirius_employer_payperiod', entity_id:nid, values:{field_sirius_date_start_value:dt(2026, m+1, 1)}}]);
  }
}
console.log(`payperiods: done (${ppCount} worker pp)`);

// ---- 9. elections + worker benefits -------------------------------------
const elections = [];
for (const w of workers.slice(0, 40)) {
  const nid = await makeNode('sirius_trust_worker_election', `Election ${w.last}`);
  elections.push(nid);
  // TRAP: multi-value benefits (delta 0..1) on every election
  await fd('field_data_field_sirius_trust_benefits', [
    {bundle:'sirius_trust_worker_election', entity_id:nid, delta:0, values:{field_sirius_trust_benefits_target_id:benefits[0]}},
    {bundle:'sirius_trust_worker_election', entity_id:nid, delta:1, values:{field_sirius_trust_benefits_target_id:benefits[1]}},
  ]);
  trap('multi_value_election_benefits');
  await fd('field_data_field_sirius_trust_election_type', [{bundle:'sirius_trust_worker_election', entity_id:nid, values:{field_sirius_trust_election_type_tid:pick([1521,1522,1523])}}]);
  // worker-benefit rows
  for (const b of benefits.slice(0, 2)) {
    const wb = await makeNode('sirius_trust_worker_benefit', `WB ${w.last}`);
    await fd('field_data_field_sirius_trust_benefit', [{bundle:'sirius_trust_worker_benefit', entity_id:wb, values:{field_sirius_trust_benefit_target_id:b}}]);
    await fd('field_data_field_sirius_trust_election', [{bundle:'sirius_trust_worker_benefit', entity_id:wb, values:{field_sirius_trust_election_target_id:nid}}]);
    await fd('field_data_field_sirius_trust_subscriber', [{bundle:'sirius_trust_worker_benefit', entity_id:wb, values:{field_sirius_trust_subscriber_target_id:w.nid}}]);
  }
}
console.log('elections+benefits: done');

// ---- 10. smf_worker_month ------------------------------------------------
// Thin join record + {"smf":{"autotag":{"status":{run_ts, asof_ts}}}}.
// TRAP: ~2% get NO json row (sparse field).
let wmCount = 0, wmNoJson = 0;
for (const w of workers) {
  const emp = pick(employers);
  for (let m = 0; m < 4; m++) {
    const nid = await makeNode('smf_worker_month', `${w.last} 2026-${String(m+1).padStart(2,'0')}`);
    await fd('field_data_field_sirius_worker', [{bundle:'smf_worker_month', entity_id:nid, values:{field_sirius_worker_target_id:w.nid}}]);
    await fd('field_data_field_grievance_shop', [{bundle:'smf_worker_month', entity_id:nid, values:{field_grievance_shop_target_id:emp}}]);
    await fd('field_data_field_sirius_date_start', [{bundle:'smf_worker_month', entity_id:nid, values:{field_sirius_date_start_value:dt(2026, m+1, 1)}}]);
    // TAGS ARE THE PAYLOAD. The autotag process assigns these; four S1
    // reports (actuarialhours, empstatus, disability_without_fmla,
    // autotag_interval) read them. Multi-value.
    const tagPool = ['fulltime','parttime','disability','fmla','loa','eligible','ineligible','probation'];
    const nTags = ri(0, 3);
    if (nTags > 0) {
      const tagRows = [];
      const usedTags = new Set();
      for (let d = 0; d < nTags; d++) {
        const t = pick(tagPool);
        if (usedTags.has(t)) continue;
        usedTags.add(t);
        tagRows.push({bundle:'smf_worker_month', entity_id:nid, delta:tagRows.length, values:{field_sirius_contact_tags_value:t}});
      }
      await fd('field_data_field_sirius_contact_tags', tagRows);
      if (tagRows.length > 1) trap('multi_value_wm_tags');
    } else {
      trap('worker_month_no_tags');
    }
    await fd('field_data_field_sirius_domain', [{bundle:'smf_worker_month', entity_id:nid, values:{field_sirius_domain_target_id:domainNid}}]);
    if (chance(0.98)) {
      const run = unix(2026, m+2 > 12 ? 12 : m+2, ri(1, 5));
      await fd('field_data_field_sirius_json', [{bundle:'smf_worker_month', entity_id:nid,
        values:{field_sirius_json_value:JSON.stringify({smf:{autotag:{status:{run_ts:run, asof_ts:run - 86400}}}})}}]);
    } else { wmNoJson++; trap('worker_month_missing_json'); }
    wmCount++;
  }
}
console.log(`smf_worker_month: done (${wmCount}, ${wmNoJson} without json)`);

// ---- 11. payments + ledger ----------------------------------------------
// sirius_payment nodes AND sirius_ledger_ar rows (both financial stores).
let ledgerId = 1;
const LA_STATUSES = ['Cleared','Cleared','Cleared','Cleared','Pending']; // mostly cleared
for (let i = 0; i < 30; i++) {
  const w = pick(workers);
  const pnid = await makeNode('sirius_payment', `Payment ${i+1}`);
  const amt = (ri(50, 900) + ri(0, 99) / 100).toFixed(2);
  await fd('field_data_field_sirius_dollar_amt', [{bundle:'sirius_payment', entity_id:pnid, values:{field_sirius_dollar_amt_value:amt}}]);
  await fd('field_data_field_sirius_payment_status', [{bundle:'sirius_payment', entity_id:pnid, values:{field_sirius_payment_status_value:'Cleared'}}]);
  await fd('field_data_field_sirius_payer', [{bundle:'sirius_payment', entity_id:pnid, values:{field_sirius_payer_target_id:w.nid}}]);
  await fd('field_data_field_sirius_ledger_account', [{bundle:'sirius_payment', entity_id:pnid, values:{field_sirius_ledger_account_target_id:pick(ledgerAccounts)}}]);
  // tz_handling=site: UTC stored
  await fd('field_data_field_sirius_datetime_created', [{bundle:'sirius_payment', entity_id:pnid, values:{field_sirius_datetime_created_value:randDate(2026, 2026)}}]);

  // matching ledger_ar rows: a charge and a payment
  // TRAP: accented names in latin1 ledger_memo (5 rows)
  const memoName = i < 5 ? pick(ACCENTED) : w.last;
  if (i < 5) trap('latin1_accented_memo');
  const ts = unix(2026, ri(1, 7), ri(1, 28));
  await conn.query(`INSERT INTO sirius_ledger_ar (ledger_id, ledger_amount, ledger_status, ledger_account, ledger_participant, ledger_reference, ledger_ts, ledger_memo, ledger_key, ledger_json)
    VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [ledgerId++, amt, pick(LA_STATUSES), pick(ledgerAccounts), w.nid, pnid, ts,
     `Contribution ${memoName} 2026-${String(ri(1,7)).padStart(2,'0')}`, `key-${ledgerId}`, JSON.stringify({src:'gen'})]);
  await conn.query(`INSERT INTO sirius_ledger_ar (ledger_id, ledger_amount, ledger_status, ledger_account, ledger_participant, ledger_reference, ledger_ts, ledger_memo, ledger_key, ledger_json)
    VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [ledgerId++, -amt, 'Cleared', pick(ledgerAccounts), w.nid, pnid, ts + 86400,
     `Payment ${memoName}`, `key-${ledgerId}`, JSON.stringify({src:'gen'})]);
}
console.log(`payments+ledger: done (${ledgerId - 1} ledger rows)`);

// ---- 12. dispatch --------------------------------------------------------
const jobs = [];
for (let i = 0; i < 5; i++) {
  const nid = await makeNode('sirius_dispatch_job', `Banquet crew ${i+1}`);
  jobs.push(nid);
  await fd('field_data_field_grievance_shop', [{bundle:'sirius_dispatch_job', entity_id:nid, values:{field_grievance_shop_target_id:pick(employers)}}]);
  await fd('field_data_field_sirius_count', [{bundle:'sirius_dispatch_job', entity_id:nid, values:{field_sirius_count_value:ri(3, 12)}}]);
}
for (let i = 0; i < 25; i++) {
  const nid = await makeNode('sirius_dispatch', `Dispatch ${i+1}`);
  await fd('field_data_field_sirius_dispatch_job', [{bundle:'sirius_dispatch', entity_id:nid, values:{field_sirius_dispatch_job_target_id:pick(jobs)}}]);
  await fd('field_data_field_sirius_dispatch_status', [{bundle:'sirius_dispatch', entity_id:nid, values:{field_sirius_dispatch_status_value:pick(['offered','accepted','terminated'])}}]);
}
await makeNode('sirius_dispatch_facility', 'Main Hall');
console.log('dispatch: done');

// ---- 13. comms + misc small bundles -------------------------------------
for (let i = 0; i < 40; i++) {
  const nid = await makeNode('sirius_log', `Log ${i+1}`);
  await fd('field_data_field_sirius_type', [{bundle:'sirius_log', entity_id:nid, values:{field_sirius_type_value:pick(['sms','email','system'])}}]);
}
for (let i = 0; i < 4; i++) {
  const c = pick(contacts);
  const nid = await makeNode('sirius_phonenumber', `310-555-${String(ri(0,9999)).padStart(4,'0')}`);
  await fd('field_data_field_sirius_sms_possible', [{bundle:'sirius_phonenumber', entity_id:nid, values:{field_sirius_sms_possible_value:1}}]);
}
// TRAP: the misspelled bundle, 2 nodes
for (let i = 0; i < 2; i++) { await makeNode('sirius_phonenubmer', `missp ${i}`); trap('misspelled_phonenubmer_node'); }
for (const nm of ['Feed A','Feed B']) await makeNode('sirius_feed', nm);
await makeNode('sirius_bulk', 'July reminder blast');
for (let i = 0; i < 3; i++) await makeNode('sirius_employee', `${pick(FIRST)} ${pick(LAST)} (staff)`);
await makeNode('sirius_twilio_conversation', 'Conv 1');
await makeNode('sirius_help', 'How to read your statement');
await makeNode('sirius_json_definition', 'workers_v1');
await makeNode('sirius_term_proxy', 'proxy-1');
await makeNode('sirius_news', 'Office closed Labor Day');
await makeNode('sirius_letterhead', 'Standard letterhead');
await makeNode('sirius_callerid', '213-555-0100');
await makeNode('grievance_letter_template', 'Step 1 letter');
await makeNode('grievance_basic_page', 'About');
await makeNode('grievance_field_overrides', 'Overrides 1');
await makeNode('grievance_contract_template', 'Master 2024');
await makeNode('page', 'Landing');
await makeNode('member', 'Legacy member node');
console.log('misc bundles: done');

// ---- 14. comment entity rows (Q35 trap) ---------------------------------
await conn.query(`INSERT INTO comment (cid, pid, nid, uid, subject, hostname, created, changed, status, thread, name, mail, homepage, language)
  VALUES (1, 0, ?, ?, 'Note', '', ?, ?, 1, '01/', 'staff1', '', '', 'und')`,
  [workers[0].nid, userUids[0], unix(2025, 5, 1), unix(2025, 5, 1)]);
trap('comment_entity_row');

// ============================================================== summary
console.log('\n================ TRAP LEDGER ================');
for (const [k, v] of Object.entries(traps).sort()) console.log(`${String(v).padStart(5)}  ${k}`);
console.log('=============================================');
if (skipped.length) {
  console.log(`\nTables not present in schema (skipped): ${[...new Set(skipped)].length}`);
  console.log([...new Set(skipped)].join(', '));
}
const [[nodeCount]] = await conn.query(`SELECT COUNT(*) n FROM node`);
console.log(`\nTotal nodes: ${nodeCount.n}`);
const [bundleRows] = await conn.query(`SELECT type, COUNT(*) n FROM node GROUP BY type ORDER BY n DESC`);
for (const b of bundleRows) console.log(`  ${String(b.n).padStart(5)}  ${b.type}`);
await conn.end();
console.log('\nDone.');
