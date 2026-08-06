#!/usr/bin/env node
/**
 * S1 synthetic data generator (augmented 2026-08-06)
 * ---------------------------------------------------
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
 *
 * ======================================================================
 * WHAT CHANGED (2026-08-06 augmentation) — the dev-loader contract
 * ======================================================================
 * Synthetic data now matches the production shapes discovered while building
 * the loaders, so dev runs exercise the REAL production code paths instead of
 * dev-only allowance carve-outs.
 *
 * ALLOWANCE FLAGS THAT BECOME UNNECESSARY after regenerating + restaging:
 *   - T4  load-options:      --fallback-industry / --allow-unresolved-industry
 *                            (every worker-ms term now carries a term-attached
 *                            field_sirius_industry tid)
 *   - T15 load-relationships: --allow-rejects owner_missing
 *                            (field_sirius_contact owner on every row)
 *   - T16 load-elections:    --allow-rejects worker_ref_missing,
 *                            employer_ref_missing, start_missing
 *                            (worker/shop refs + start dates on every row)
 *   - T17 load-benefit-history: benefit_unmapped
 *                            (benefit node titles now match the dev S2 fund
 *                            config by unique name — see DEPENDENCIES)
 *   - T19 load-payments:     --fallback-payment-type
 *                            (field_sirius_payment_type tid on every payment)
 *
 * STILL NEEDED (by design):
 *   - T17: --open-end-through YYYY-MM  (~25% of worker-benefit spans are OPEN,
 *          matching prod's ~27%; any month >= 2026-12 works, e.g. 2026-12)
 *   - allowances for the deliberate traps listed in the TRAP LEDGER printed at
 *     the end of a run (expected reject reasons):
 *        T17: start_missing (1), subscriber_worker_mismatch (1),
 *             relation_subscriber_mismatch (1)
 *        T18: non_cleared_status (2 Pending ledger rows)
 *        N4:  duplicate_code (2 in-run; on RE-run one becomes
 *             code_owned_by_other_worker and one adopts)
 *        N21: category_missing (1), category_unmapped (1),
 *             handler_missing (1), handler_unresolved (1)
 *        T15: none — the 2 no-start rows load via the N26 default-dates ruling
 *
 * DEPENDENCIES (dev environment, before loading):
 *   1. Dev S2 fund config must contain the seeded trust_benefits rows named
 *      Kaiser, Health Net, Delta Dental, VSP, Life Insurance, MLK,
 *      Express Scripts (T17/T16 resolve S1 benefit nodes by unique name — the
 *      dev DB carried all of these on 2026-08-06) and the policies rows
 *      Participation Agreement / Restaurant Plan / Event Center Plan / COBRA
 *      (sirius_ids PA/R/EC/COBRA) for the load-policies adopt-only path.
 *   2. T4 load-options carries KNOWN_SKIPPED dispositions (added alongside
 *      this generator version) for three vocabularies that now exist here
 *      because they exist in PRODUCTION:
 *        sirius_gender            (consumed by T3's gender name-match)
 *        grievance_contact_types  (consumed by T24's contact-type names)
 *        sirius_contact_tags      (worker-month tags; no loader consumes yet)
 *      Don't run this generator's output against a load-options build older
 *      than those dispositions — T4's preflight will refuse the vocabularies.
 *   3. Worker gender resolves by NAME against options_gender — the dev app DB
 *      options_gender table must be seeded (Male/Female/Nonbinary/Other/
 *      Prefer Not To Answer) or T3 annotates worker_gender_unresolved.
 *   4. sirius_trust_policy is NOT in stage.ts IN_SCOPE_BUNDLES — stage with
 *      --all (or --bundles sirius_trust_policy) so load-policies can resolve
 *      election policy references. Elections reference policies on ~97% of
 *      rows (prod: 99.7%).
 *
 * FIELD METADATA: field_config / field_config_instance are now seeded for
 * every field written (production cardinality + field types), so stage.ts
 * exercises its PRIMARY field-discovery path instead of the
 * information_schema table-scan fallback.
 *
 * OTHER FIXES vs the previous version:
 *   - work_status picker referenced a 'Suspended' term that was never created
 *     (undefined tid) — now picks real terms.
 *   - field_sirius_contact_tags is a TERM REFERENCE (_tid) in prod; the old
 *     generator wrote a nonexistent _value column (rows landed valueless).
 *   - field_sirius_active is a varchar 'Yes'/'No' in prod (loaders yesNo()
 *     it); the old generator wrote integer 1.
 *   - vocab machine names switched to production's: sirius_industry,
 *     sirius_contact_relationship_types (T4 aliases both).
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
const STREETS = ['Figueroa St','Wilshire Blvd','Olympic Blvd','Flower St','Grand Ave','Sunset Blvd','Century Blvd','Sepulveda Blvd'];
const CITIES = ['Los Angeles','Long Beach','Inglewood','Santa Monica','Glendale','Burbank','Pasadena'];

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

// -------------------------------------------------- field metadata registry
// Production field types + cardinality (docs/s1-migration/profile). Every
// field written below MUST have an entry — writeField throws otherwise, so
// the field_config seeding can never silently miss a field. cardinality -1
// means unlimited (multi-value), per the production census multi-value flags.
const FIELD_META = {
  // entityreference (module entityreference)
  field_sirius_contact:            { type: 'entityreference', module: 'entityreference', cardinality: 1 },
  field_sirius_contact_alt:        { type: 'entityreference', module: 'entityreference', cardinality: 1 },
  field_sirius_worker:             { type: 'entityreference', module: 'entityreference', cardinality: 1 },
  field_grievance_shop:            { type: 'entityreference', module: 'entityreference', cardinality: 1 },
  field_grievance_shops:           { type: 'entityreference', module: 'entityreference', cardinality: -1 },
  field_grievance_company:         { type: 'entityreference', module: 'entityreference', cardinality: 1 },
  field_sirius_trust_benefit:      { type: 'entityreference', module: 'entityreference', cardinality: 1 },
  field_sirius_trust_benefits:     { type: 'entityreference', module: 'entityreference', cardinality: -1 },
  field_sirius_trust_election:     { type: 'entityreference', module: 'entityreference', cardinality: 1 },
  field_sirius_trust_subscriber:   { type: 'entityreference', module: 'entityreference', cardinality: 1 },
  field_sirius_trust_policy:       { type: 'entityreference', module: 'entityreference', cardinality: 1 },
  field_sirius_contact_relation:   { type: 'entityreference', module: 'entityreference', cardinality: 1 },
  field_sirius_contact_relations:  { type: 'entityreference', module: 'entityreference', cardinality: -1 },
  field_sirius_payer:              { type: 'entityreference', module: 'entityreference', cardinality: 1 },
  field_sirius_ledger_account:     { type: 'entityreference', module: 'entityreference', cardinality: 1 },
  field_sirius_log_handler:        { type: 'entityreference', module: 'entityreference', cardinality: -1 },
  field_sirius_domain:             { type: 'entityreference', module: 'entityreference', cardinality: 1 },
  field_sirius_dispatch_job:       { type: 'entityreference', module: 'entityreference', cardinality: 1 },
  // taxonomy term references (module taxonomy)
  field_sirius_contact_reltype:    { type: 'taxonomy_term_reference', module: 'taxonomy', cardinality: 1 },
  field_sirius_member_status:      { type: 'taxonomy_term_reference', module: 'taxonomy', cardinality: -1 },
  field_sirius_work_status:        { type: 'taxonomy_term_reference', module: 'taxonomy', cardinality: 1 },
  field_sirius_gender:             { type: 'taxonomy_term_reference', module: 'taxonomy', cardinality: 1 },
  field_sirius_payment_type:       { type: 'taxonomy_term_reference', module: 'taxonomy', cardinality: 1 },
  field_sirius_trust_election_type:{ type: 'taxonomy_term_reference', module: 'taxonomy', cardinality: 1 },
  field_sirius_industry:           { type: 'taxonomy_term_reference', module: 'taxonomy', cardinality: -1 },
  field_grievance_contact_types:   { type: 'taxonomy_term_reference', module: 'taxonomy', cardinality: -1 },
  field_sirius_contact_tags:       { type: 'taxonomy_term_reference', module: 'taxonomy', cardinality: -1 },
  // datetime (module date)
  field_sirius_dob:                { type: 'datetime', module: 'date', cardinality: 1 },
  field_sirius_date_start:         { type: 'datetime', module: 'date', cardinality: 1 },
  field_sirius_date_end:           { type: 'datetime', module: 'date', cardinality: 1 },
  field_sirius_datetime:           { type: 'datetime', module: 'date', cardinality: 1 },
  field_sirius_datetime_created:   { type: 'datetime', module: 'date', cardinality: 1 },
  field_sirius_datetime_completed: { type: 'datetime', module: 'date', cardinality: 1 },
  // numbers
  field_sirius_count:              { type: 'number_integer', module: 'number', cardinality: 1 },
  field_sirius_sms_possible:       { type: 'number_integer', module: 'number', cardinality: 1 },
  field_sirius_dollar_amt:         { type: 'number_decimal', module: 'number', cardinality: 1 },
  // text
  field_sirius_ssn:                { type: 'text', module: 'text', cardinality: 1 },
  field_sirius_id:                 { type: 'text', module: 'text', cardinality: 1 },
  field_sirius_id2:                { type: 'text', module: 'text', cardinality: 1 },
  field_sirius_id3:                { type: 'text', module: 'text', cardinality: 1 },
  field_sirius_aat:                { type: 'text', module: 'text', cardinality: 1 },
  field_sirius_aat_required:       { type: 'text', module: 'text', cardinality: 1 },
  field_sirius_email:              { type: 'text', module: 'text', cardinality: 1 },
  field_sirius_phone:              { type: 'text', module: 'text', cardinality: 1 },
  field_sirius_phone_alt:          { type: 'text', module: 'text', cardinality: 1 },
  field_sirius_active:             { type: 'text', module: 'text', cardinality: 1 },
  field_sirius_name_short:         { type: 'text', module: 'text', cardinality: 1 },
  field_sirius_name_alt:           { type: 'text', module: 'text', cardinality: 1 },
  field_sirius_currency:           { type: 'text', module: 'text', cardinality: 1 },
  field_sirius_check_number:       { type: 'text', module: 'text', cardinality: 1 },
  field_sirius_merchant_name:      { type: 'text', module: 'text', cardinality: 1 },
  field_sirius_ledger_allocated:   { type: 'text', module: 'text', cardinality: 1 },
  field_sirius_payment_status:     { type: 'text', module: 'text', cardinality: 1 },
  field_sirius_address_accuracy:   { type: 'text', module: 'text', cardinality: 1 },
  field_sirius_gender_nota_calc:   { type: 'text', module: 'text', cardinality: 1 },
  field_sirius_gender_nota_val:    { type: 'text', module: 'text', cardinality: 1 },
  field_sirius_type:               { type: 'text', module: 'text', cardinality: 1 },
  field_sirius_category:           { type: 'text', module: 'text', cardinality: 1 },
  field_sirius_dispatch_status:    { type: 'text', module: 'text', cardinality: 1 },
  field_grievance_external_id:     { type: 'text', module: 'text', cardinality: 1 },
  field_grievance_co_name:         { type: 'text', module: 'text', cardinality: 1 },
  field_grievance_co_email:        { type: 'email', module: 'email', cardinality: 1 },
  field_grievance_co_role:         { type: 'text', module: 'text', cardinality: 1 },
  field_grievance_co_phone:        { type: 'text', module: 'text', cardinality: 1 },
  field_grievance_co_phone_2:      { type: 'text', module: 'text', cardinality: 1 },
  field_grievance_co_fax:          { type: 'text', module: 'text', cardinality: 1 },
  field_grievance_co_address:      { type: 'text', module: 'text', cardinality: 1 },
  field_grievance_co_address_2:    { type: 'text', module: 'text', cardinality: 1 },
  field_grievance_co_city:         { type: 'text', module: 'text', cardinality: 1 },
  field_grievance_co_state:        { type: 'text', module: 'text', cardinality: 1 },
  field_grievance_co_zip:          { type: 'text', module: 'text', cardinality: 1 },
  // long text
  field_sirius_json:               { type: 'text_long', module: 'text', cardinality: 1 },
  field_sirius_summary:            { type: 'text_long', module: 'text', cardinality: 1 },
  field_sirius_notes:              { type: 'text_long', module: 'text', cardinality: 1 },
  // compound
  field_sirius_name:               { type: 'name', module: 'name', cardinality: 1 },
  field_sirius_address:            { type: 'addressfield', module: 'addressfield', cardinality: 1 },
  field_sirius_address_geo:        { type: 'geofield', module: 'geofield', cardinality: 1 },
};
/** distinct field names actually written (drives field_config emission) */
const usedFields = new Set();
/** distinct 'entityType::bundle::field' combos (drives field_config_instance) */
const usedInstances = new Set();

// Generic field_data_* writer.
// Discovers value columns by introspection; fills them by name/type heuristics.
async function writeField(table, rows) {
  // rows: [{entity_type, bundle, entity_id, revision_id, delta, deleted, values:{col:val}}]
  if (!rows.length) return 0;
  if (!(await tableExists(table))) { skipped.push(table); return 0; }
  const fieldName = table.replace(/^field_data_/, '');
  if (table.startsWith('field_data_') && !FIELD_META[fieldName]) {
    throw new Error(`FIELD_META missing for ${fieldName} — add it so field_config seeding stays complete`);
  }
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
    if (table.startsWith('field_data_')) {
      usedFields.add(fieldName);
      usedInstances.add(`${rec.entity_type}::${r.bundle}::${fieldName}`);
    }
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
  'taxonomy_vocabulary','file_managed','comment','sirius_ledger_ar','sirius_ledger_balance',
  'field_config','field_config_instance']) {
  await truncateIf(t);
}

// ---- 1. taxonomy ---------------------------------------------------------
// Production vocabularies with production machine names + real tids where
// the loaders hardcode them. Term-attached fields (industry on member-status
// terms, letter-code sirius_ids on relation types, ...) are written right
// after each vocab so T4 exercises its primary resolution paths.
const vocab = {};
async function makeVocab(machine, terms) {
  const vid = Object.keys(vocab).length + 1;
  await conn.query(`INSERT INTO taxonomy_vocabulary (vid, name, machine_name, description, hierarchy, module, weight)
    VALUES (?,?,?,'',0,'taxonomy',0)`, [vid, machine, machine]);
  vocab[machine] = {};
  for (const t of terms) {
    const tid = t.tid || allocTid();
    await conn.query(`INSERT INTO taxonomy_term_data (tid, vid, name, description, format, weight)
      VALUES (?,?,?,'',NULL,?)`, [tid, vid, t.name, t.weight ?? 0]);
    vocab[machine][t.name] = tid;
  }
  return vid;
}
/** term-attached field row (entity_type=taxonomy_term) */
async function tf(table, machine, tid, values) {
  return fd(table, [{ entity_type: 'taxonomy_term', bundle: machine, entity_id: tid, values }]);
}

// work_status is vestigial (167 rows in prod) but the vocab exists:
await makeVocab('sirius_work_status', [{name:'Active',tid:1505},{name:'Disability',tid:1506},{name:'Retired',tid:1510},{name:'Deceased',tid:1630}]);

// industries FIRST (member-status terms reference them). Production machine
// name is sirius_industry (T4 maps it AND grievance_industry to 'industry').
await makeVocab('sirius_industry', [{name:'Hotel'},{name:'Food Service'},{name:'Airport'},{name:'Event Center'}]);
for (const nm of ['Hotel','Food Service','Airport','Event Center']) {
  const tid = vocab['sirius_industry'][nm];
  await tf('field_data_field_sirius_id', 'sirius_industry', tid, { field_sirius_id_value: String(tid) });
}

// member_status = industry/policy + hours threshold eligibility groups.
// EVERY term carries a term-attached field_sirius_industry (Q37 — prod has it
// on all 7; T4's synthetic-signature gate makes partial coverage an error).
await makeVocab('sirius_member_status', [
  {name:'UNITE HERE Worker - 60 hours',tid:1672},
  {name:'Event Center Worker - 100 hours',tid:1667},
  {name:'Unite Here Restaurant Worker - 60 Hours',tid:1678},
  {name:'Event Center Worker - 80 hours',tid:1628},
  {name:'Event Center Worker - 60 hours',tid:1666},
  {name:'PA Worker',tid:1673},
  {name:'UNITE HERE Worker - 40 Hours',tid:1688},
]);
const MS_INDUSTRY = {
  'UNITE HERE Worker - 60 hours': 'Hotel',
  'Event Center Worker - 100 hours': 'Event Center',
  'Unite Here Restaurant Worker - 60 Hours': 'Food Service',
  'Event Center Worker - 80 hours': 'Event Center',
  'Event Center Worker - 60 hours': 'Event Center',
  'PA Worker': 'Hotel',
  'UNITE HERE Worker - 40 Hours': 'Hotel',
};
for (const [nm, ind] of Object.entries(MS_INDUSTRY)) {
  const tid = vocab['sirius_member_status'][nm];
  await tf('field_data_field_sirius_industry', 'sirius_member_status', tid,
    { field_sirius_industry_tid: vocab['sirius_industry'][ind] });
  await tf('field_data_field_sirius_id', 'sirius_member_status', tid, { field_sirius_id_value: String(tid) });
}

// hour types: live 1600-series + 1544 + 1701 (T20 verify checks all 11 tids
// resolve; 900-series legacy terms exist in vocab but never in data)
await makeVocab('sirius_hour_type', [
  {name:'Active',tid:1544},{name:'No Charge',tid:1682},{name:'Terminated',tid:1637},
  {name:'LOA',tid:1634},{name:'FMLA',tid:1633},{name:'Disability',tid:1632},
  {name:'Military Leave',tid:1635},{name:'Initial Eligibility',tid:1691},
  {name:'Deceased',tid:1662},{name:'COBRA',tid:1636},
  {name:'Event Center Hours Purchasing',tid:1701},
  {name:'Vacation',tid:907},{name:'Apprentice',tid:908}, // legacy gen: in vocab, never in data
]);

// payment types: prod has 8 terms; every payment node references one.
await makeVocab('sirius_payment_type', [
  {name:'Check'},{name:'Card'},{name:'Cash'},{name:'ACH'},
  {name:'Money Order'},{name:'Credit Card'},{name:'Cashiers Check'},{name:'Payroll Deduction'},
]);

// election types (dev machine name sirius_election_type — T16 reads terms by
// this vocabulary; KNOWN_SKIPPED in T4 lists it). COBRA is a canonical type.
await makeVocab('sirius_election_type', [
  {name:'FirstTime',tid:1521},{name:'OpenEnrollment',tid:1522},{name:'LifeEvent',tid:1523},{name:'COBRA'},
]);

// relation types: production machine name + full 10-term set with letter-code
// sirius_ids attached (C/SP/SC/DP/QMSCO/G/AC/RP/H + the ES term the loader
// rewrites to EX per the fund ruling).
const RELTYPES = [
  ['Child','C'],['Spouse','SP'],['Step Child','SC'],['Domestic Partner','DP'],
  ['QMSCO','QMSCO'],['Grandchild','G'],['Adult Child','AC'],['Responsible Party','RP'],
  ['Handicapped Dependent','H'],['Ex Spouse','ES'],
];
await makeVocab('sirius_contact_relationship_types', RELTYPES.map(([n], i) => ({name:n, weight:i})));
for (let i = 0; i < RELTYPES.length; i++) {
  const [nm, code] = RELTYPES[i];
  const tid = vocab['sirius_contact_relationship_types'][nm];
  await tf('field_data_field_sirius_id', 'sirius_contact_relationship_types', tid, { field_sirius_id_value: code });
  await tf('field_data_field_sirius_name_alt', 'sirius_contact_relationship_types', tid, { field_sirius_name_alt_value: nm });
  if (i < 2) await tf('field_data_field_sirius_count', 'sirius_contact_relationship_types', tid, { field_sirius_count_value: i + 1 });
}
trap('reltype_es_term_for_ex_override'); // ES → EX at T4

// gender vocab (exists in production; T4 needs a KNOWN_SKIPPED disposition —
// see DEPENDENCIES in the header). Names must match dev options_gender rows.
const GENDERS = [['Male','M'],['Female','F'],['Nonbinary','NB'],['Other','O'],['Prefer Not To Answer','PNTA']];
await makeVocab('sirius_gender', GENDERS.map(([n]) => ({name:n})));
for (const [nm, short] of GENDERS) {
  const tid = vocab['sirius_gender'][nm];
  await tf('field_data_field_sirius_name_short', 'sirius_gender', tid, { field_sirius_name_short_value: short });
  await tf('field_data_field_sirius_id', 'sirius_gender', tid, { field_sirius_id_value: String(tid) });
}

// shop-contact types (production machine name grievance_contact_types; term
// names become options_employer_contact_type rows in T24).
await makeVocab('grievance_contact_types', [
  {name:'Human Resources'},{name:'Payroll'},{name:'Benefits'},{name:'Legal'},
]);

// contact/worker-month tags (prod vocab sirius_contact_tags; _tid field).
await makeVocab('sirius_contact_tags', [
  {name:'vip'},{name:'spanish'},{name:'returned-mail'},
  {name:'fulltime'},{name:'parttime'},{name:'disability'},{name:'fmla'},
  {name:'loa'},{name:'eligible'},{name:'ineligible'},{name:'probation'},
]);
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

// ---- 4. sirius_domain, ledger accounts, benefits, providers, policies ----
const domainNid = await makeNode('sirius_domain', 'BAO');
const ledgerAccounts = [];
for (const nm of ['Employer Contributions','Employee Contributions','HWIP']) {
  const nid = await makeNode('sirius_ledger_account', nm);
  ledgerAccounts.push(nid);
  await fd('field_data_field_sirius_name_short', [{bundle:'sirius_ledger_account', entity_id:nid, values:{field_sirius_name_short_value:nm.split(' ')[0]}}]);
  await fd('field_data_field_sirius_id', [{bundle:'sirius_ledger_account', entity_id:nid, values:{field_sirius_id_value:`GL-${ri(100,999)}`}}]);
  await fd('field_data_field_sirius_currency', [{bundle:'sirius_ledger_account', entity_id:nid, values:{field_sirius_currency_value:'USD'}}]);
}
const providers = [];
for (const nm of ['Kaiser Permanente','Health Net of California','Delta Dental Plans']) providers.push(await makeNode('sirius_trust_provider', nm));

// Benefit node TITLES match the dev S2 fund config trust_benefits by unique
// case-insensitive name (T17/T16 resolveBenefitNidMap) — kills benefit_unmapped.
const BENEFIT_NAMES = ['Kaiser','Health Net','Delta Dental','VSP','Life Insurance','MLK','Express Scripts'];
const benefits = [];
for (const nm of BENEFIT_NAMES) {
  const nid = await makeNode('sirius_trust_benefit', nm);
  benefits.push(nid);
  await fd('field_data_field_sirius_id', [{bundle:'sirius_trust_benefit', entity_id:nid, values:{field_sirius_id_value:`BEN-${nm.toUpperCase().replace(/[^A-Z]/g,'').slice(0,3)}`}}]);
}

// Policy nodes named/coded to the dev S2 policies rows so load-policies'
// adopt-only path resolves them (stage with --all — see header DEPENDENCIES).
const POLICY_DEFS = [
  ['Participation Agreement','PA'],['Restaurant Plan','R'],['Event Center Plan','EC'],['COBRA','COBRA'],
];
const policyNids = [];
for (const [nm, code] of POLICY_DEFS) {
  const nid = await makeNode('sirius_trust_policy', nm);
  policyNids.push(nid);
  await fd('field_data_field_sirius_id', [{bundle:'sirius_trust_policy', entity_id:nid, values:{field_sirius_id_value:code}}]);
}
console.log('domain/accounts/benefits/providers/policies: done');

// ---- 5. employers (grievance_shop) + companies + shop contacts -----------
const companies = [];
for (const nm of ['ACME Parent Co','Coastal Hospitality Group','Union Square Partners'])
  companies.push(await makeNode('grievance_company', nm));

const employers = [];
for (let i = 0; i < HOTELS.length; i++) {
  const nid = await makeNode('grievance_shop', HOTELS[i]);
  employers.push(nid);
  await fd('field_data_field_grievance_external_id', [{bundle:'grievance_shop', entity_id:nid, values:{field_grievance_external_id_value:`H${String(i).padStart(4,'0')}`}}]);
  const ind = i < 2 ? 'Event Center' : (i === 2 ? 'Food Service' : 'Hotel');
  await fd('field_data_field_sirius_industry', [{bundle:'grievance_shop', entity_id:nid, values:{field_sirius_industry_tid:vocab['sirius_industry'][ind]}}]);
}
// shop contacts — full T24 field set at production-observed rates
const CT_TIDS = Object.values(vocab['grievance_contact_types']);
for (let i = 0; i < 8; i++) {
  const first = pick(FIRST), last = pick(LAST);
  const nid = await makeNode('grievance_shop_contact', `${first} ${last} (HR)`);
  // employer link: multi-value on 2 of 8 (prod max delta 2)
  const shopRows = [{bundle:'grievance_shop_contact', entity_id:nid, delta:0, values:{field_grievance_shops_target_id:employers[i % employers.length]}}];
  if (i < 2) {
    shopRows.push({bundle:'grievance_shop_contact', entity_id:nid, delta:1, values:{field_grievance_shops_target_id:employers[(i + 3) % employers.length]}});
    trap('shop_contact_multi_employer');
  }
  await fd('field_data_field_grievance_shops', shopRows);
  // contact types: 1-2 term tids on every row (prod: 562/563)
  const ctRows = [{bundle:'grievance_shop_contact', entity_id:nid, delta:0, values:{field_grievance_contact_types_tid:CT_TIDS[i % CT_TIDS.length]}}];
  if (i % 3 === 0) ctRows.push({bundle:'grievance_shop_contact', entity_id:nid, delta:1, values:{field_grievance_contact_types_tid:CT_TIDS[(i + 1) % CT_TIDS.length]}});
  await fd('field_data_field_grievance_contact_types', ctRows);
  if (i < 6) await fd('field_data_field_grievance_co_name', [{bundle:'grievance_shop_contact', entity_id:nid, values:{field_grievance_co_name_value:`${first} ${last}`}}]);
  if (i < 6) await fd('field_data_field_grievance_co_email', [{bundle:'grievance_shop_contact', entity_id:nid, values:{field_grievance_co_email_email:`hr${i}@example.test`}}]);
  if (i < 5) await fd('field_data_field_grievance_co_role', [{bundle:'grievance_shop_contact', entity_id:nid, values:{field_grievance_co_role_value:pick(['HR Manager','Benefits Coordinator','Payroll Supervisor','Office Manager'])}}]);
  if (i < 2) await fd('field_data_field_grievance_co_phone', [{bundle:'grievance_shop_contact', entity_id:nid, values:{field_grievance_co_phone_value:`213-555-${String(ri(0,9999)).padStart(4,'0')}`}}]);
  if (i === 0) await fd('field_data_field_grievance_co_phone_2', [{bundle:'grievance_shop_contact', entity_id:nid, values:{field_grievance_co_phone_2_value:`213-555-${String(ri(0,9999)).padStart(4,'0')}`}}]);
  if (i === 1) await fd('field_data_field_grievance_co_fax', [{bundle:'grievance_shop_contact', entity_id:nid, values:{field_grievance_co_fax_value:`213-555-${String(ri(0,9999)).padStart(4,'0')}`}}]);
  if (i < 2) {
    await fd('field_data_field_grievance_co_address', [{bundle:'grievance_shop_contact', entity_id:nid, values:{field_grievance_co_address_value:`${ri(100,9999)} ${pick(STREETS)}`}}]);
    if (i === 0) await fd('field_data_field_grievance_co_address_2', [{bundle:'grievance_shop_contact', entity_id:nid, values:{field_grievance_co_address_2_value:`Suite ${ri(100,900)}`}}]);
    await fd('field_data_field_grievance_co_city', [{bundle:'grievance_shop_contact', entity_id:nid, values:{field_grievance_co_city_value:pick(CITIES)}}]);
    await fd('field_data_field_grievance_co_state', [{bundle:'grievance_shop_contact', entity_id:nid, values:{field_grievance_co_state_value:'CA'}}]);
    await fd('field_data_field_grievance_co_zip', [{bundle:'grievance_shop_contact', entity_id:nid, values:{field_grievance_co_zip_value:`900${String(ri(10,99))}`}}]);
  }
  // company link (prod: 3 rows) — unblocks the deferred companies work
  if (i < 3) {
    await fd('field_data_field_grievance_company', [{bundle:'grievance_shop_contact', entity_id:nid, values:{field_grievance_company_target_id:companies[i]}}]);
    trap('shop_contact_company_link');
  }
}
await makeNode('grievance_chapter', 'Chapter 1');
await makeNode('grievance_chapter', 'Chapter 2');
await makeNode('grievance_holiday', 'New Year 2026');
await makeNode('grievance_holiday', 'Labor Day 2026');
console.log('employers: done');

// ---- 6. contacts + workers ----------------------------------------------
const contacts = [];   // {nid, first, last}
const workers = [];    // {nid, contactNid, first, last, homeShop}
const usedSsns = [];
const TAG_TIDS_CONTACT = ['vip','spanish','returned-mail'].map(n => vocab['sirius_contact_tags'][n]);

function makeSsn() { return `${ri(100,899)}-${String(ri(1,99)).padStart(2,'0')}-${String(ri(1,9999)).padStart(4,'0')}`; }

/** structured-name + (rated) address/geo/accuracy block for a contact nid */
async function contactSatellites(cnid, first, last, i) {
  const nameVals = { field_sirius_name_given: first, field_sirius_name_family: last };
  if (i % 4 === 0) nameVals.field_sirius_name_title = pick(['Mr','Ms','Mx']);
  if (i % 3 === 0) nameVals.field_sirius_name_middle = pick(FIRST)[0];
  if (i % 25 === 0) nameVals.field_sirius_name_generational = 'Jr';
  await fd('field_data_field_sirius_name', [{bundle:'sirius_contact', entity_id:cnid, values:nameVals}]);
  // address block on ~42% of contacts (prod 55,493/131,581) with the
  // degenerate-bbox geo + accuracy the T3 loader consumes
  if (chance(0.42)) {
    const vals = {
      field_sirius_address_country: 'US',
      field_sirius_address_administrative_area: 'CA',
      field_sirius_address_locality: pick(CITIES),
      field_sirius_address_postal_code: `900${String(ri(10,99))}`,
      field_sirius_address_thoroughfare: `${ri(100,9999)} ${pick(STREETS)}`,
    };
    if (chance(0.25)) vals.field_sirius_address_premise = `Apt ${ri(1,40)}`;
    await fd('field_data_field_sirius_address', [{bundle:'sirius_contact', entity_id:cnid, values:vals}]);
    const lat = (33.7 + rnd() * 0.6).toFixed(12);
    const lon = (-118.5 + rnd() * 0.6).toFixed(12);
    await fd('field_data_field_sirius_address_geo', [{bundle:'sirius_contact', entity_id:cnid, values:{
      field_sirius_address_geo_geo_type: 'point',
      field_sirius_address_geo_lat: lat, field_sirius_address_geo_lon: lon,
      field_sirius_address_geo_left: lon, field_sirius_address_geo_right: lon,   // degenerate bbox:
      field_sirius_address_geo_top: lat, field_sirius_address_geo_bottom: lat,   // left==right, top==bottom
      field_sirius_address_geo_geohash: '9q5',
    }}]);
    await fd('field_data_field_sirius_address_accuracy', [{bundle:'sirius_contact', entity_id:cnid, values:{field_sirius_address_accuracy_value:pick(['ROOFTOP','RANGE_INTERPOLATED','APPROXIMATE'])}}]);
    return true;
  }
  return false;
}

for (let i = 0; i < N_WORKERS; i++) {
  const first = pick(FIRST), last = pick(LAST);
  const cnid = await makeNode('sirius_contact', `${first} ${last}`);
  contacts.push({ nid: cnid, first, last });
  await contactSatellites(cnid, first, last, i);
  await fd('field_data_field_sirius_email', [{bundle:'sirius_contact', entity_id:cnid, values:{field_sirius_email_value:`${first}.${last}.${i}@example.test`.toLowerCase()}}]);
  await fd('field_data_field_sirius_phone', [{bundle:'sirius_contact', entity_id:cnid, values:{field_sirius_phone_value:`310-555-${String(ri(0,9999)).padStart(4,'0')}`}}]);
  if (i < 2) await fd('field_data_field_sirius_phone_alt', [{bundle:'sirius_contact', entity_id:cnid, values:{field_sirius_phone_alt_value:`424-555-${String(ri(0,9999)).padStart(4,'0')}`}}]);
  if (chance(0.08)) await fd('field_data_field_sirius_id', [{bundle:'sirius_contact', entity_id:cnid, values:{field_sirius_id_value:`C${700000 + i}`}}]);
  // TRAP: multi-value contact tags (delta 0..2) on ~30% of contacts — TERM tids
  if (chance(0.3)) {
    const tags = [];
    for (let d = 0; d <= ri(1, 2); d++) tags.push({bundle:'sirius_contact', entity_id:cnid, delta:d, values:{field_sirius_contact_tags_tid:TAG_TIDS_CONTACT[d % TAG_TIDS_CONTACT.length]}});
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

  // gender on ~68% (prod 80,448/117,679); tids from sirius_gender; term names
  // must match options_gender rows by name (T3 name-match fallback)
  if (chance(0.68)) {
    const gname = i === 8 ? 'Other' : pick(['Male','Male','Male','Female','Female','Female','Nonbinary']);
    await fd('field_data_field_sirius_gender', [{bundle:'sirius_worker', entity_id:wnid, values:{field_sirius_gender_tid:vocab['sirius_gender'][gname]}}]);
    const calc = gname === 'Male' || gname === 'Female' ? gname : 'Female';
    await fd('field_data_field_sirius_gender_nota_calc', [{bundle:'sirius_worker', entity_id:wnid, values:{field_sirius_gender_nota_calc_value:calc}}]);
    if (i === 8) { await fd('field_data_field_sirius_gender_nota_val', [{bundle:'sirius_worker', entity_id:wnid, values:{field_sirius_gender_nota_val_value:'nonconforming'}}]); trap('gender_nota_val_row'); }
  }

  // work_status: RARE in prod (167 rows / 117,679 workers = 0.14%).
  // Seed only 2 so the path is exercisable without being misleadingly common.
  // (BUG FIX: previous version picked a 'Suspended' term that never existed.)
  if (i < 2) {
    await fd('field_data_field_sirius_work_status', [{bundle:'sirius_worker', entity_id:wnid, values:{field_sirius_work_status_tid:vocab['sirius_work_status'][chance(0.85)?'Active':'Retired']}}]);
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
  if (chance(0.4)) await fd('field_data_field_sirius_aat_required', [{bundle:'sirius_worker', entity_id:wnid, values:{field_sirius_aat_required_value:chance(0.8)?'Yes':'No'}}]);

  workers.push({ nid: wnid, contactNid: cnid, first, last, homeShop: employers[i % employers.length] });
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
// Production shape (35,774 rows): owner field_sirius_contact on ALL rows,
// contact_alt/reltype/active/count/domain on ALL, date_start on ~99.7%
// (missing-start = the N26 default-dates cohort), date_end sparse.
const relationships = []; // {nid, workerNid, depContactNid, code}
const relSeq = new Map(); // worker nid -> next sequence value
// first 10 rows cover all 10 relation-type codes (incl. ES→EX and RP/H for
// the EDI mapping coverage); the rest skew Child/Spouse like prod.
const REL_ASSIGN = ['Child','Spouse','Step Child','Domestic Partner','QMSCO','Grandchild','Adult Child','Responsible Party','Handicapped Dependent','Ex Spouse'];
for (let i = 0; i < 24; i++) {
  const w = workers[(i * 2) % workers.length];
  const depFirst = pick(FIRST);
  const nid = await makeNode('sirius_contact_relationship', `${depFirst} ${w.last}`, { created: unix(2024, (i % 12) + 1, 5) });
  const depContact = await makeNode('sirius_contact', `${depFirst} ${w.last}`);
  await contactSatellites(depContact, depFirst, w.last, i + 100);
  const relName = i < REL_ASSIGN.length ? REL_ASSIGN[i] : pick(['Child','Child','Child','Spouse','Spouse','Domestic Partner']);
  await fd('field_data_field_sirius_contact', [{bundle:'sirius_contact_relationship', entity_id:nid, values:{field_sirius_contact_target_id:w.contactNid}}]);
  await fd('field_data_field_sirius_contact_alt', [{bundle:'sirius_contact_relationship', entity_id:nid, values:{field_sirius_contact_alt_target_id:depContact}}]);
  await fd('field_data_field_sirius_contact_reltype', [{bundle:'sirius_contact_relationship', entity_id:nid, values:{field_sirius_contact_reltype_tid:vocab['sirius_contact_relationship_types'][relName]}}]);
  await fd('field_data_field_sirius_domain', [{bundle:'sirius_contact_relationship', entity_id:nid, values:{field_sirius_domain_target_id:domainNid}}]);
  // sequence (field_sirius_count) on every row, per-owner ordering
  const seq = (relSeq.get(w.nid) || 0) + 1;
  relSeq.set(w.nid, seq);
  await fd('field_data_field_sirius_count', [{bundle:'sirius_contact_relationship', entity_id:nid, values:{field_sirius_count_value:seq}}]);
  // dates: rows 22,23 have NO start (N26 default-dates cohort, prod 115/35,793)
  if (i >= 22) {
    trap('rel_missing_start_n26');
  } else {
    await fd('field_data_field_sirius_date_start', [{bundle:'sirius_contact_relationship', entity_id:nid, values:{field_sirius_date_start_value:dt(ri(2005, 2018), ri(1, 12), ri(1, 28))}}]);
    if (i === 4 || i === 5) await fd('field_data_field_sirius_date_end', [{bundle:'sirius_contact_relationship', entity_id:nid, values:{field_sirius_date_end_value:dt(2023, ri(1, 12), ri(1, 28))}}]);
  }
  // active: rows 6,7 are No WITHOUT an end date (loader end-dates from changed)
  const activeNo = i === 6 || i === 7;
  await fd('field_data_field_sirius_active', [{bundle:'sirius_contact_relationship', entity_id:nid, values:{field_sirius_active_value:activeNo ? 'No' : (i === 4 || i === 5 ? 'No' : 'Yes')}}]);
  if (activeNo) trap('rel_inactive_no_end');
  relationships.push({ nid, workerNid: w.nid, depContactNid: depContact, code: relName });
}
console.log(`relationships: done (${relationships.length})`);

// ---- 8. payperiods (hours) ----------------------------------------------
// tz_handling=site on field_sirius_datetime* -> values are UTC.
// TRAP: two payperiod completion datetimes at month boundary (UTC 02:00 on
// the 1st == prior month 18:00 LA).
let ppCount = 0;
for (const w of workers) {
  const emp = w.homeShop;
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
    await fd('field_data_field_sirius_active', [{bundle:'sirius_payperiod', entity_id:nid, values:{field_sirius_active_value:'Yes'}}]);

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
// Elections at production shape: worker/shop/start on ALL rows, end on ~70%,
// type on ~25% (prod majority is UNTYPED), policy ref on ~97% (prod 99.7%),
// contact_relations multi on ~12%, active Yes/No.
const relsByWorker = new Map();
for (const r of relationships) {
  relsByWorker.set(r.workerNid, [...(relsByWorker.get(r.workerNid) || []), r]);
}
const elections = []; // {nid, workerNid, employer, benefitNids}
const electionByWorker = new Map();
const TYPE_TIDS = [1521, 1522, 1523, vocab['sirius_election_type']['COBRA']];
let electionUntyped = 0;
for (let i = 0; i < Math.min(40, workers.length); i++) {
  const w = workers[i];
  const nid = await makeNode('sirius_trust_worker_election', `Election ${w.last}`, { created: unix(2025, (i % 12) + 1, 10) });
  elections.push({ nid, workerNid: w.nid, employer: w.homeShop });
  if (!electionByWorker.has(w.nid)) electionByWorker.set(w.nid, nid);
  await fd('field_data_field_sirius_worker', [{bundle:'sirius_trust_worker_election', entity_id:nid, values:{field_sirius_worker_target_id:w.nid}}]);
  await fd('field_data_field_grievance_shop', [{bundle:'sirius_trust_worker_election', entity_id:nid, values:{field_grievance_shop_target_id:w.homeShop}}]);
  // benefits: 1-3 targets, delta order preserved (prod max delta 10)
  const nBen = 1 + (i % 3);
  const benRows = [];
  for (let d = 0; d < nBen; d++) benRows.push({bundle:'sirius_trust_worker_election', entity_id:nid, delta:d, values:{field_sirius_trust_benefits_target_id:benefits[(i + d) % benefits.length]}});
  await fd('field_data_field_sirius_trust_benefits', benRows);
  elections[elections.length - 1].benefitNids = benRows.map(r => r.values.field_sirius_trust_benefits_target_id);
  if (nBen > 1) trap('multi_value_election_benefits');
  // type on 25% only — the untyped majority is the PROD-NORMAL path
  if (i % 4 === 0) {
    await fd('field_data_field_sirius_trust_election_type', [{bundle:'sirius_trust_worker_election', entity_id:nid, values:{field_sirius_trust_election_type_tid:TYPE_TIDS[(i / 4) % TYPE_TIDS.length | 0]}}]);
  } else electionUntyped++;
  // relation refs (multi) on ~12% of elections, drawn from the worker's own relationships
  const wrels = relsByWorker.get(w.nid) || [];
  if (i % 8 === 0 && wrels.length > 0) {
    const relRows = wrels.slice(0, 2).map((r, d) => ({bundle:'sirius_trust_worker_election', entity_id:nid, delta:d, values:{field_sirius_contact_relations_target_id:r.nid}}));
    await fd('field_data_field_sirius_contact_relations', relRows);
    trap('election_with_relation_refs');
  }
  // policy ref on all but one election (prod 242,545/243,328)
  if (i !== 39) {
    await fd('field_data_field_sirius_trust_policy', [{bundle:'sirius_trust_worker_election', entity_id:nid, values:{field_sirius_trust_policy_target_id:policyNids[i % 5 === 0 ? (i / 5) % policyNids.length | 0 : 0]}}]);
  } else trap('election_without_policy_ref');
  // dates + active: start on ALL; end on ~70%; 2 inactive-no-end rows
  // (end-dated from node.changed — the T14 reconcile path, NOT a reject)
  await fd('field_data_field_sirius_date_start', [{bundle:'sirius_trust_worker_election', entity_id:nid, values:{field_sirius_date_start_value:dt(2024, (i % 12) + 1, 1)}}]);
  const inactiveNoEnd = i === 30 || i === 31;
  const hasEnd = !inactiveNoEnd && i % 10 < 7;
  if (hasEnd) await fd('field_data_field_sirius_date_end', [{bundle:'sirius_trust_worker_election', entity_id:nid, values:{field_sirius_date_end_value:dt(2025, (i % 12) + 1, 28)}}]);
  await fd('field_data_field_sirius_active', [{bundle:'sirius_trust_worker_election', entity_id:nid, values:{field_sirius_active_value:inactiveNoEnd ? 'No' : (hasEnd ? 'No' : 'Yes')}}]);
  if (inactiveNoEnd) trap('election_inactive_no_end');
}
console.log(`elections: done (${elections.length}, ${electionUntyped} untyped)`);

// worker benefit spans at production shape: subscriber spans + ~half
// dependent spans (contact_relation), shop on ~94% (rest fall back through
// trust_election), start on all but ONE trap row, ~25% OPEN spans (no end →
// --open-end-through), inactive-no-end reconcile rows, notes on all.
const wbNids = [];
let wbIdx = 0;
async function makeWb({ w, benefit, electionNid, relation }) {
  const k = wbIdx++;
  const wb = await makeNode('sirius_trust_worker_benefit', `WB ${w.last}`, { created: unix(2025, (k % 12) + 1, 15) });
  wbNids.push(wb);
  await fd('field_data_field_sirius_trust_benefit', [{bundle:'sirius_trust_worker_benefit', entity_id:wb, values:{field_sirius_trust_benefit_target_id:benefit}}]);
  // subscriber on ALL rows; worker field mirrors it (prod 609,480/609,486)
  // except one deliberate subscriber_worker_mismatch trap row
  const mismatch = k === 17 && !relation;
  await fd('field_data_field_sirius_trust_subscriber', [{bundle:'sirius_trust_worker_benefit', entity_id:wb, values:{field_sirius_trust_subscriber_target_id:w.nid}}]);
  if (!relation) {
    const wnidField = mismatch ? workers[(workers.indexOf(w) + 1) % workers.length].nid : w.nid;
    await fd('field_data_field_sirius_worker', [{bundle:'sirius_trust_worker_benefit', entity_id:wb, values:{field_sirius_worker_target_id:wnidField}}]);
    if (mismatch) trap('wb_subscriber_worker_mismatch');
  }
  if (relation) {
    await fd('field_data_field_sirius_contact_relation', [{bundle:'sirius_trust_worker_benefit', entity_id:wb, values:{field_sirius_contact_relation_target_id:relation}}]);
  }
  // employer: shop ref on ~94%; skipped rows carry the election ref so the
  // loader's election-fallback path is exercised (never skipped when the
  // worker has no election — that would be an unplanned employer_unresolved)
  const skipShop = k % 16 === 5 && electionNid != null;
  if (!skipShop) await fd('field_data_field_grievance_shop', [{bundle:'sirius_trust_worker_benefit', entity_id:wb, values:{field_grievance_shop_target_id:w.homeShop}}]);
  const includeElection = electionNid != null && (skipShop || k % 7 !== 3); // ~85%, always when shop absent
  if (includeElection) await fd('field_data_field_sirius_trust_election', [{bundle:'sirius_trust_worker_benefit', entity_id:wb, values:{field_sirius_trust_election_target_id:electionNid}}]);
  if (skipShop) trap('wb_employer_via_election_fallback');
  // dates: ONE row with no start (start_missing reject trap; prod has ~38);
  // ~25% open spans; 2 inactive-no-end reconcile rows
  const startMonth = (k % 6) + 1;
  const noStart = k === 23;
  if (noStart) trap('wb_start_missing');
  else await fd('field_data_field_sirius_date_start', [{bundle:'sirius_trust_worker_benefit', entity_id:wb, values:{field_sirius_date_start_value:dt(2025, startMonth, 1)}}]);
  const inactiveNoEnd = k === 40 || k === 41;
  const open = !inactiveNoEnd && k % 4 === 0;
  if (!open && !inactiveNoEnd && !noStart) {
    await fd('field_data_field_sirius_date_end', [{bundle:'sirius_trust_worker_benefit', entity_id:wb, values:{field_sirius_date_end_value:dt(2025, startMonth + 2 + (k % 4), 28)}}]);
  }
  if (open) trap('wb_open_span');
  if (inactiveNoEnd) trap('wb_inactive_no_end');
  await fd('field_data_field_sirius_active', [{bundle:'sirius_trust_worker_benefit', entity_id:wb, values:{field_sirius_active_value:(open || noStart) ? 'Yes' : 'No'}}]);
  await fd('field_data_field_sirius_notes', [{bundle:'sirius_trust_worker_benefit', entity_id:wb, values:{field_sirius_notes_value:`Coverage span ${w.last}`}}]);
  return wb;
}
// subscriber spans: 2 per election
for (const e of elections) {
  const w = workers.find(x => x.nid === e.workerNid);
  for (const b of e.benefitNids.slice(0, 2)) {
    await makeWb({ w, benefit: b, electionNid: e.nid });
  }
}
// dependent spans (~half of prod rows carry contact_relation): 1-2 per relationship
let depTrapDone = false;
for (let r = 0; r < relationships.length; r++) {
  const rel = relationships[r];
  const w = workers.find(x => x.nid === rel.workerNid);
  const nDep = 1 + (r % 2);
  for (let d = 0; d < nDep; d++) {
    // ONE trap row: relation belongs to worker A but subscriber is worker B
    // → relation_subscriber_mismatch reject in T17
    if (!depTrapDone && r === 20) {
      const other = workers.find(x => x.nid !== rel.workerNid);
      await makeWb({ w: other, benefit: benefits[0], electionNid: electionByWorker.get(other.nid) ?? null, relation: rel.nid });
      trap('wb_relation_subscriber_mismatch');
      depTrapDone = true;
      continue;
    }
    await makeWb({ w, benefit: benefits[(r + d) % benefits.length], electionNid: electionByWorker.get(w.nid) ?? null, relation: rel.nid });
  }
}
console.log(`worker benefits: done (${wbNids.length} spans)`);

// ---- 10. smf_worker_month ------------------------------------------------
// Thin join record + {"smf":{"autotag":{"status":{run_ts, asof_ts}}}}.
// TRAP: ~2% get NO json row (sparse field). Tags are TERM references.
const TAG_TIDS_WM = ['fulltime','parttime','disability','fmla','loa','eligible','ineligible','probation'].map(n => vocab['sirius_contact_tags'][n]);
let wmCount = 0, wmNoJson = 0;
for (const w of workers) {
  const emp = w.homeShop;
  for (let m = 0; m < 4; m++) {
    const nid = await makeNode('smf_worker_month', `${w.last} 2026-${String(m+1).padStart(2,'0')}`);
    await fd('field_data_field_sirius_worker', [{bundle:'smf_worker_month', entity_id:nid, values:{field_sirius_worker_target_id:w.nid}}]);
    await fd('field_data_field_grievance_shop', [{bundle:'smf_worker_month', entity_id:nid, values:{field_grievance_shop_target_id:emp}}]);
    await fd('field_data_field_sirius_date_start', [{bundle:'smf_worker_month', entity_id:nid, values:{field_sirius_date_start_value:dt(2026, m+1, 1)}}]);
    // TAGS ARE THE PAYLOAD. The autotag process assigns these; four S1
    // reports (actuarialhours, empstatus, disability_without_fmla,
    // autotag_interval) read them. Multi-value TERM references.
    const nTags = ri(0, 3);
    if (nTags > 0) {
      const tagRows = [];
      const usedTags = new Set();
      for (let d = 0; d < nTags; d++) {
        const t = pick(TAG_TIDS_WM);
        if (usedTags.has(t)) continue;
        usedTags.add(t);
        tagRows.push({bundle:'smf_worker_month', entity_id:nid, delta:tagRows.length, values:{field_sirius_contact_tags_tid:t}});
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
// Payments at production shape: payment_type tid on ALL rows (kills
// --fallback-payment-type), check_number ~35%, merchant_name ~53%,
// ledger_allocated on all, statuses drawn from the T19 STATUS_MAP.
const PT = vocab['sirius_payment_type'];
let ledgerId = 1;
for (let i = 0; i < 30; i++) {
  const w = pick(workers);
  const pnid = await makeNode('sirius_payment', `Payment ${i+1}`);
  const amt = (ri(50, 900) + ri(0, 99) / 100).toFixed(2);
  await fd('field_data_field_sirius_dollar_amt', [{bundle:'sirius_payment', entity_id:pnid, values:{field_sirius_dollar_amt_value:amt}}]);
  // status: mostly Cleared; the tail exercises every mapped status
  const status = i < 26 ? 'Cleared' : (i < 28 ? 'Received' : (i === 28 ? 'Canceled' : 'Failed'));
  await fd('field_data_field_sirius_payment_status', [{bundle:'sirius_payment', entity_id:pnid, values:{field_sirius_payment_status_value:status}}]);
  if (status !== 'Cleared') trap('payment_noncleared_status');
  await fd('field_data_field_sirius_payer', [{bundle:'sirius_payment', entity_id:pnid, values:{field_sirius_payer_target_id:w.nid}}]);
  await fd('field_data_field_sirius_ledger_account', [{bundle:'sirius_payment', entity_id:pnid, values:{field_sirius_ledger_account_target_id:pick(ledgerAccounts)}}]);
  // tz_handling=site: UTC stored
  await fd('field_data_field_sirius_datetime_created', [{bundle:'sirius_payment', entity_id:pnid, values:{field_sirius_datetime_created_value:randDate(2026, 2026)}}]);
  // payment type on EVERY row; Check rows carry check numbers (~35% overall)
  const ptName = i % 3 === 0 ? 'Check' : (i % 3 === 1 ? pick(['Card','Credit Card']) : pick(['ACH','Cash','Money Order','Payroll Deduction','Cashiers Check']));
  await fd('field_data_field_sirius_payment_type', [{bundle:'sirius_payment', entity_id:pnid, values:{field_sirius_payment_type_tid:PT[ptName]}}]);
  if (ptName === 'Check' || ptName === 'Cashiers Check') {
    await fd('field_data_field_sirius_check_number', [{bundle:'sirius_payment', entity_id:pnid, values:{field_sirius_check_number_value:String(ri(1000, 99999))}}]);
  }
  if (i % 2 === 0) await fd('field_data_field_sirius_merchant_name', [{bundle:'sirius_payment', entity_id:pnid, values:{field_sirius_merchant_name_value:pick(['Elavon','Authorize.Net','Chase Merchant Services','Lockbox Services'])}}]);
  await fd('field_data_field_sirius_ledger_allocated', [{bundle:'sirius_payment', entity_id:pnid, values:{field_sirius_ledger_allocated_value:(i === 5 || i === 6) ? 'No' : 'Yes'}}]);
  if (i % 3 !== 2) await fd('field_data_field_sirius_notes', [{bundle:'sirius_payment', entity_id:pnid, values:{field_sirius_notes_value:'Posted by import'}}]);
  if (i < 8) await fd('field_data_field_sirius_id', [{bundle:'sirius_payment', entity_id:pnid, values:{field_sirius_id_value:`PMT-${2000+i}`}}]);
  if (i % 10 !== 9) await fd('field_data_field_sirius_datetime', [{bundle:'sirius_payment', entity_id:pnid, values:{field_sirius_datetime_value:randDate(2026, 2026)}}]);
  if (i % 6 === 0) await fd('field_data_field_sirius_json', [{bundle:'sirius_payment', entity_id:pnid, values:{field_sirius_json_value:JSON.stringify({gateway:'gen', batch:i})}}]);

  // matching ledger_ar rows: a charge and a payment.
  // TRAP: accented names in latin1 ledger_memo (5 rows).
  // TRAP: exactly 2 Pending rows (prod AR is 100% Cleared — the documented
  // T18 non_cleared_status reject path); everything else Cleared.
  // References cycle across entity kinds (wb/election/payment/worker/
  // relationship/employer/contact), incl. 2 unresolvable + some NULL.
  const memoName = i < 5 ? pick(ACCENTED) : w.last;
  if (i < 5) trap('latin1_accented_memo');
  const ts = unix(2026, ri(1, 7), ri(1, 28));
  const chargeStatus = i < 2 ? 'Pending' : 'Cleared';
  if (i < 2) trap('ledger_pending_rows');
  const refPool = [
    wbNids[i % wbNids.length],
    elections[i % elections.length].nid,
    pnid,
    w.nid,
    relationships[i % relationships.length].nid,
    employers[i % employers.length],
    contacts[i % contacts.length].nid,
    19_777_777, // unresolvable → referenceType 's1-unknown'
    null,
  ];
  const chargeRef = refPool[i % refPool.length];
  if (chargeRef === 19_777_777) trap('ledger_reference_unresolvable');
  // participant: mostly workers; a couple of contact/employer participants
  const participant = i === 3 ? w.contactNid : (i === 4 ? employers[0] : w.nid);
  if (i === 3) trap('ledger_contact_participant');
  if (i === 4) trap('ledger_employer_participant');
  await conn.query(`INSERT INTO sirius_ledger_ar (ledger_id, ledger_amount, ledger_status, ledger_account, ledger_participant, ledger_reference, ledger_ts, ledger_memo, ledger_key, ledger_json)
    VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [ledgerId++, amt, chargeStatus, pick(ledgerAccounts), participant, chargeRef, ts,
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

// ---- 13. comms (call logs), employee ids + misc small bundles ------------
// sirius_log at production shape: type/category/handler/summary/notes on
// nearly all rows. 25 MSR rows use the N21 reason map's exact S1 spellings
// (incl. aliases and 'Disney  Issues' with S1's literal double space); 15
// non-MSR rows (sms/email/system) stay out of scope by type; 2 unmapped-type
// rows are traps. Handlers are CONTACT nids (multi-value).
const MSR_TYPES = [
  'Enrollment','Enrollment Followup','MLK Issues','Kaiser Issues','Disney  Issues',
  'Dental Insurance Problems','DYNTL','Life Insurance','ID Card Not Received',
  'Appeal Denial','Delta Appeal','Other',
];
const MSR_CATEGORIES = ['Call from Member','Call to Member','Office Visit','Walk In','Helpline Call from Member'];
for (let i = 0; i < 25; i++) {
  const nid = await makeNode('sirius_log', `MSR Log ${i+1}`);
  await fd('field_data_field_sirius_type', [{bundle:'sirius_log', entity_id:nid, values:{field_sirius_type_value:MSR_TYPES[i % MSR_TYPES.length]}}]);
  // category: row 23 missing entirely, row 24 unmapped — documented traps
  if (i === 23) { trap('call_log_missing_category'); }
  else if (i === 24) {
    await fd('field_data_field_sirius_category', [{bundle:'sirius_log', entity_id:nid, values:{field_sirius_category_value:'Carrier Fax'}}]);
    trap('call_log_unmapped_category');
  } else {
    await fd('field_data_field_sirius_category', [{bundle:'sirius_log', entity_id:nid, values:{field_sirius_category_value:MSR_CATEGORIES[i % MSR_CATEGORIES.length]}}]);
  }
  // handlers: multi-value contact refs; row 21 unresolvable (worker nid),
  // row 22 missing — documented traps
  if (i === 21) {
    await fd('field_data_field_sirius_log_handler', [{bundle:'sirius_log', entity_id:nid, values:{field_sirius_log_handler_target_id:workers[0].nid}}]);
    trap('call_log_handler_unresolved');
  } else if (i === 22) {
    trap('call_log_handler_missing');
  } else {
    const rows = [{bundle:'sirius_log', entity_id:nid, delta:0, values:{field_sirius_log_handler_target_id:contacts[i % contacts.length].nid}}];
    if (i % 3 === 0) rows.push({bundle:'sirius_log', entity_id:nid, delta:1, values:{field_sirius_log_handler_target_id:contacts[(i + 7) % contacts.length].nid}});
    await fd('field_data_field_sirius_log_handler', rows);
    if (rows.length > 1) trap('call_log_multi_handler');
  }
  await fd('field_data_field_sirius_summary', [{bundle:'sirius_log', entity_id:nid, values:{field_sirius_summary_value:`Member inquiry: ${MSR_TYPES[i % MSR_TYPES.length].toLowerCase()}`}}]);
  await fd('field_data_field_sirius_notes', [{bundle:'sirius_log', entity_id:nid, values:{field_sirius_notes_value:`Spoke with member re: ${MSR_TYPES[i % MSR_TYPES.length].toLowerCase()}; follow-up ${chance(0.5) ? 'required' : 'not required'}.`}}]);
  await fd('field_data_field_sirius_domain', [{bundle:'sirius_log', entity_id:nid, values:{field_sirius_domain_target_id:domainNid}}]);
}
// non-MSR system logs (out of N21 scope by type)
for (let i = 0; i < 15; i++) {
  const nid = await makeNode('sirius_log', `Log ${i+1}`);
  await fd('field_data_field_sirius_type', [{bundle:'sirius_log', entity_id:nid, values:{field_sirius_type_value:pick(['sms','email','system'])}}]);
}
// TRAP: 2 rows with in-scope-looking but unmapped types (stay out of scope)
for (const t of ['Fax Received','Grievance Note']) {
  const nid = await makeNode('sirius_log', `Log ${t}`);
  await fd('field_data_field_sirius_type', [{bundle:'sirius_log', entity_id:nid, values:{field_sirius_type_value:t}}]);
  trap('call_log_unmapped_type');
}

// sirius_employee at production shape (541 nodes; worker/shop/code/domain on
// each). Rows 28/29 are the duplicate-code traps:
//   row 28: same shop+code as row 0, DIFFERENT worker → duplicate_code in-run
//           (on a RE-run: code_owned_by_other_worker)
//   row 29: same shop+code as row 0, SAME worker → duplicate_code in-run
//           (on a RE-run: adopted silently — the clash-adopt path)
const empIdRows = [];
for (let i = 0; i < 30; i++) {
  let w = workers[i % workers.length];
  let shop = w.homeShop;
  let code = `EC-${1000 + i}`;
  if (i === 28) { w = workers[28]; shop = workers[0].homeShop; code = 'EC-1000'; trap('empid_duplicate_code_other_worker'); }
  if (i === 29) { w = workers[0]; shop = workers[0].homeShop; code = 'EC-1000'; trap('empid_duplicate_code_same_worker'); }
  const nid = await makeNode('sirius_employee', `${w.first} ${w.last} (${code})`);
  empIdRows.push(nid);
  await fd('field_data_field_sirius_worker', [{bundle:'sirius_employee', entity_id:nid, values:{field_sirius_worker_target_id:w.nid}}]);
  await fd('field_data_field_grievance_shop', [{bundle:'sirius_employee', entity_id:nid, values:{field_grievance_shop_target_id:shop}}]);
  await fd('field_data_field_sirius_id', [{bundle:'sirius_employee', entity_id:nid, values:{field_sirius_id_value:code}}]);
  await fd('field_data_field_sirius_domain', [{bundle:'sirius_employee', entity_id:nid, values:{field_sirius_domain_target_id:domainNid}}]);
}

for (let i = 0; i < 4; i++) {
  const nid = await makeNode('sirius_phonenumber', `310-555-${String(ri(0,9999)).padStart(4,'0')}`);
  await fd('field_data_field_sirius_sms_possible', [{bundle:'sirius_phonenumber', entity_id:nid, values:{field_sirius_sms_possible_value:1}}]);
}
// TRAP: the misspelled bundle, 2 nodes
for (let i = 0; i < 2; i++) { await makeNode('sirius_phonenubmer', `missp ${i}`); trap('misspelled_phonenubmer_node'); }
for (const nm of ['Feed A','Feed B']) await makeNode('sirius_feed', nm);
await makeNode('sirius_bulk', 'July reminder blast');
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
console.log('call logs/employee ids/misc bundles: done');

// ---- 14. comment entity rows (Q35 trap) ---------------------------------
await conn.query(`INSERT INTO comment (cid, pid, nid, uid, subject, hostname, created, changed, status, thread, name, mail, homepage, language)
  VALUES (1, 0, ?, ?, 'Note', '', ?, ?, 1, '01/', 'staff1', '', '', 'und')`,
  [workers[0].nid, userUids[0], unix(2025, 5, 1), unix(2025, 5, 1)]);
trap('comment_entity_row');

// ---- 15. field metadata (field_config / field_config_instance) -----------
// One field_config row per field actually written this run (production
// cardinality + field type), one field_config_instance per
// (entity_type, bundle, field) combination that has data. This makes
// stage.ts's buildFieldCatalog take the PRIMARY field_config path instead of
// the information_schema fallback. The data blobs are placeholder serialized
// arrays — nothing reads them.
{
  const blob = Buffer.from('a:0:{}');
  let fcId = 0;
  const fieldIdByName = new Map();
  for (const fname of [...usedFields].sort()) {
    const meta = FIELD_META[fname];
    fcId++;
    fieldIdByName.set(fname, fcId);
    await conn.query(
      `INSERT INTO field_config (id, field_name, type, module, active, storage_type, storage_module, storage_active, locked, data, cardinality, translatable, deleted)
       VALUES (?,?,?,?,1,'field_sql_storage','field_sql_storage',1,0,?,?,0,0)`,
      [fcId, fname, meta.type, meta.module, blob, meta.cardinality]);
  }
  let fciId = 0;
  for (const key of [...usedInstances].sort()) {
    const [entityType, bundle, fname] = key.split('::');
    fciId++;
    await conn.query(
      `INSERT INTO field_config_instance (id, field_id, field_name, entity_type, bundle, data, deleted)
       VALUES (?,?,?,?,?,?,0)`,
      [fciId, fieldIdByName.get(fname), fname, entityType, bundle, blob]);
  }
  console.log(`field metadata: done (${fcId} fields, ${fciId} instances)`);
}

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
