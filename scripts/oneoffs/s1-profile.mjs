// S1 (Drupal 7) database profiler. Read-only; powers docs/s1-migration/01-field-inventory.md.
// Usage: S1URL=postgresql://... [S1_PROFILE_OUT=path/to/profile.json] node scripts/oneoffs/s1-profile.mjs
//   S1URL           required — S1 connection string (drop channel_binding param; TLS verification is relaxed)
//   S1_PROFILE_OUT  optional — output file (default /tmp/s1/profile.json); parent dirs are created
import pg from 'pg';
import fs from 'fs';
import path from 'path';

const url = process.env.S1URL;
if (!url) {
  console.error('S1URL env var is required (S1 read-only connection string)');
  process.exit(1);
}
const outPath = process.env.S1_PROFILE_OUT || '/tmp/s1/profile.json';
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

const q = async (sql, params) => (await client.query(sql, params)).rows;

const tables = (await q(`select table_name from information_schema.tables where table_schema='public' order by 1`)).map(r => r.table_name);
const colsAll = await q(`select table_name, column_name, data_type, ordinal_position from information_schema.columns where table_schema='public' order by table_name, ordinal_position`);
const colsByTable = {};
for (const c of colsAll) (colsByTable[c.table_name] ||= []).push(c);

const D7_META = new Set(['entity_type','bundle','deleted','entity_id','revision_id','language','delta']);

function inferType(vals) {
  const vs = vals.filter(v => v !== null && v !== '');
  if (!vs.length) return 'unknown(all-null)';
  const all = re => vs.every(v => re.test(String(v)));
  if (all(/^-?\d+$/)) {
    const nums = vs.map(Number);
    if (nums.every(n => n === 0 || n === 1) && vs.length > 1) return 'boolean(0/1)';
    if (nums.every(n => n > 1000000000 && n < 2000000000)) return 'unix-timestamp';
    return 'integer';
  }
  if (all(/^-?\d+\.\d+$/)) return 'numeric';
  if (all(/^\d{4}-\d{2}-\d{2}$/)) return 'date(YYYY-MM-DD)';
  if (all(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/)) return 'datetime';
  if (all(/^[as]:\d+:/)) return 'php-serialized';
  if (all(/^[{\[]/)) return 'json?';
  return 'text';
}

const out = { generatedAt: new Date().toISOString(), tables: {}, };

const fieldTables = tables.filter(t => t.startsWith('field_data_'));
const siriusTables = tables.filter(t => t.startsWith('sirius_'));
const coreTables = ['node','node_revision','users','users_roles','role','taxonomy_term_data','taxonomy_vocabulary','taxonomy_term_hierarchy','taxonomy_index','field_config','field_config_instance','file_managed','file_usage','url_alias','variable','profile','webform','webform_submissions','webform_submitted_data','workflow_node','workflow_node_history','workflows','workflow_states','workflow_transitions'].filter(t => tables.includes(t));

async function profileTable(t, isField) {
  const cols = (colsByTable[t] || []).map(c => c.column_name);
  const rec = { columns: colsByTable[t]?.map(c => `${c.column_name}:${c.data_type}`) || [] };
  try {
    rec.rowCount = Number((await q(`select count(*) n from "${t}"`))[0].n);
  } catch (e) { rec.error = e.message; return rec; }
  if (rec.rowCount === 0) return rec;
  const rows = await q(`select * from "${t}" limit 50`);
  rec.sampleSize = rows.length;
  rec.colProfile = {};
  for (const c of cols) {
    const vals = rows.map(r => r[c]);
    const nonNull = vals.filter(v => v !== null && v !== '').length;
    const distinct = [...new Set(vals.filter(v => v !== null))].slice(0, 8);
    rec.colProfile[c] = {
      nonNull, fillRate: rows.length ? +(nonNull / rows.length).toFixed(2) : 0,
      inferred: inferType(vals),
      samples: distinct.map(v => String(v).slice(0, 60)),
    };
  }
  if (isField) {
    if (cols.includes('entity_type') && cols.includes('bundle')) {
      rec.bundles = await q(`select entity_type, bundle, count(*) n from "${t}" group by 1,2 order by 3 desc`);
    }
    if (cols.includes('delta')) {
      const d = await q(`select max(delta::int) mx, count(*) filter (where delta::int > 0) multi from "${t}"`).catch(() => null);
      if (d) rec.delta = d[0];
    }
    const rev = t.replace('field_data_', 'field_revision_');
    if (tables.includes(rev)) {
      try { rec.revisionRowCount = Number((await q(`select count(*) n from "${rev}"`))[0].n); } catch {}
    }
  }
  return rec;
}

for (const t of [...fieldTables, ...siriusTables, ...coreTables]) {
  out.tables[t] = await profileTable(t, t.startsWith('field_data_'));
  process.stderr.write('.');
}

// full dumps of key metadata tables (they're tiny)
out.dumps = {};
for (const t of ['field_config','field_config_instance','variable','taxonomy_vocabulary','taxonomy_term_data','role'].filter(t => tables.includes(t))) {
  try { out.dumps[t] = await q(`select * from "${t}" limit 60`); } catch (e) { out.dumps[t] = { error: e.message }; }
}
out.allTables = tables;
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log('\ndone', fieldTables.length, 'field tables,', siriusTables.length, 'sirius,', coreTables.length, 'core →', outPath);
await client.end();
