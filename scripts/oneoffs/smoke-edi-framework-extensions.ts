/**
 * Smoke test: EDI framework extensions (task: CSV output, file header/trailer
 * records, multi-benefit membership).
 *
 * Covers:
 *  - CSV row encoding: quoting/escaping (commas, quotes, newlines), header row.
 *  - assembleEdiFileLines ordering: file header → CSV column header → detail
 *    rows → trailer, with the CSV header suppressible (Carelon mode) and
 *    aggregates (detailRecordCount) reaching the hooks.
 *  - Regression: plugins WITHOUT the new hooks (Kaiser, HealthNet) produce
 *    byte-identical output to the pre-extension behavior (detail lines only).
 *  - Multi-benefit membership: a plugin declaring two benefit Sirius IDs
 *    unions workers across them (fixtures in the dev DB), each member unit
 *    is tagged with its source benefitSiriusId, and single-benefit behavior
 *    is unchanged.
 *
 * Usage: npx tsx scripts/oneoffs/smoke-edi-framework-extensions.ts
 */
// Import storage/database FIRST so its (circular) module graph initializes in
// boot order (see eligibility smoke-test convention).
import { storage } from "../../server/storage/database";
import { db } from "../../server/storage/db";
import { eq, inArray } from "drizzle-orm";
import {
  contacts,
  workers,
  employers,
  trustBenefits,
  trustWmb,
} from "@shared/schema";
import {
  type EdiCsvField,
  csvEscape,
  encodeCsvRow,
  encodeCsvHeaderRow,
  assembleEdiFileLines,
  buildMemberUnits,
  wmbPrimaryKeys,
  effectiveBenefitSiriusIds,
} from "../../server/plugins/trust/provider-edi/base";
import {
  trustProviderEdiPluginRegistry,
  type TrustProviderEdiPlugin,
  type TrustProviderEdiContext,
} from "../../server/plugins/trust/provider-edi/registry";
// Load the real plugins for the regression check.
import "../../server/plugins/trust/provider-edi/plugins/sitespecific-bao-kaiser";
import "../../server/plugins/trust/provider-edi/plugins/sitespecific-bao-healthnet";

const YEAR = 2026;
const MONTH = 7;
const AS_OF = "2026-07-15";
const TAG = "SMOKE-EDI-EXT";

let failures = 0;
function check(label: string, ok: boolean, extra?: unknown) {
  if (!ok) failures++;
  console.log(
    `${ok ? "OK  " : "FAIL"} ${label}${extra !== undefined ? ` :: ${JSON.stringify(extra)}` : ""}`,
  );
}

// ---------------------------------------------------------------------------
// Pure encoding checks (no DB)
// ---------------------------------------------------------------------------

function pureChecks() {
  check("csvEscape: plain value untouched", csvEscape("abc") === "abc");
  check("csvEscape: comma quoted", csvEscape("a,b") === '"a,b"');
  check("csvEscape: quote doubled", csvEscape('a"b') === '"a""b"');
  check("csvEscape: newline quoted", csvEscape("a\nb") === '"a\nb"');

  const fields: EdiCsvField[] = [
    { name: "Name", get: (r) => String(r.name ?? "") },
    { name: "City, State", get: (r) => String(r.city ?? "") },
    { name: "Blank" }, // no get → empty cell
  ];
  check(
    "encodeCsvHeaderRow escapes names",
    encodeCsvHeaderRow(fields) === 'Name,"City, State",Blank',
    encodeCsvHeaderRow(fields),
  );
  const line = encodeCsvRow(fields, { name: 'Al "Big" O', city: "LA, CA" });
  check(
    "encodeCsvRow quotes/escapes",
    line === '"Al ""Big"" O","LA, CA",',
    line,
  );

  const ctx = {} as TrustProviderEdiContext;
  const rows = [{ name: "r1" }, { name: "r2" }];
  const basePlugin = {
    id: "smoke-csv",
    name: "smoke",
    getColumns: () => [],
    processBatch: async () => [],
    encodeRow: (r: Record<string, unknown>) => encodeCsvRow(fields, r),
    buildFilename: () => "SMOKE.csv",
  } as unknown as TrustProviderEdiPlugin;

  // CSV with header row + file header/trailer.
  const full: TrustProviderEdiPlugin = {
    ...basePlugin,
    outputFormat: "csv",
    encodeCsvHeaderRow: () => encodeCsvHeaderRow(fields),
    encodeFileHeader: () => "HDR|SMOKE",
    encodeFileTrailer: (_c, agg) => `TRL|${agg.detailRecordCount}`,
  };
  const lines = assembleEdiFileLines(full, rows, ctx);
  check(
    "assemble: header, csv header, details, trailer order",
    lines.length === 5 &&
      lines[0] === "HDR|SMOKE" &&
      lines[1] === 'Name,"City, State",Blank' &&
      lines[2].startsWith("r1") &&
      lines[3].startsWith("r2") &&
      lines[4] === "TRL|2",
    lines,
  );

  // CSV with the column-header row suppressed (Carelon mode).
  const suppressed: TrustProviderEdiPlugin = {
    ...basePlugin,
    outputFormat: "csv",
    csvIncludeHeaderRow: false,
    encodeCsvHeaderRow: () => encodeCsvHeaderRow(fields),
  };
  const sLines = assembleEdiFileLines(suppressed, rows, ctx);
  check(
    "assemble: csv header suppressed",
    sLines.length === 2 && sLines[0].startsWith("r1"),
    sLines,
  );

  // Multi-line header/trailer arrays.
  const multi: TrustProviderEdiPlugin = {
    ...basePlugin,
    encodeFileHeader: () => ["H1", "H2"],
    encodeFileTrailer: () => null,
  };
  const mLines = assembleEdiFileLines(multi, rows, ctx);
  check(
    "assemble: array header, null trailer",
    mLines.length === 4 && mLines[0] === "H1" && mLines[1] === "H2",
    mLines,
  );

  // Regression: a plugin with no hooks (fixed-width default) = detail only.
  const plainLines = assembleEdiFileLines(basePlugin, rows, ctx);
  const legacy = rows.map((r) => basePlugin.encodeRow(r, ctx));
  check(
    "assemble: no hooks → byte-identical to plain encodeRow map",
    JSON.stringify(plainLines) === JSON.stringify(legacy),
  );

  // effectiveBenefitSiriusIds override precedence.
  const mk = (configData: Record<string, unknown>) =>
    ({ configData } as unknown as TrustProviderEdiContext);
  check(
    "effective ids: registered defaults",
    effectiveBenefitSiriusIds(mk({}), ["3", "3E"]).join(",") === "3,3E",
  );
  check(
    "effective ids: single override",
    effectiveBenefitSiriusIds(mk({ benefitSiriusId: "X" }), ["3"]).join(",") === "X",
  );
  check(
    "effective ids: array override wins",
    effectiveBenefitSiriusIds(
      mk({ benefitSiriusIds: ["A", "B"], benefitSiriusId: "X" }),
      ["3"],
    ).join(",") === "A,B",
  );
}

// ---------------------------------------------------------------------------
// Kaiser / HealthNet regression (encode paths untouched)
// ---------------------------------------------------------------------------

function regressionChecks() {
  const ctx = {} as TrustProviderEdiContext;
  for (const id of ["sitespecific-bao-kaiser", "sitespecific-bao-healthnet"]) {
    const p = trustProviderEdiPluginRegistry.get(id)!;
    check(`${id}: no header/trailer/csv hooks`, !p.encodeFileHeader && !p.encodeFileTrailer && !p.outputFormat);
    const row = { lastName: "Doe", firstName: "Jane" };
    const assembled = assembleEdiFileLines(p, [row], ctx);
    check(
      `${id}: assembled file == legacy encodeRow lines`,
      assembled.length === 1 && assembled[0] === p.encodeRow(row, ctx),
    );
  }
}

// ---------------------------------------------------------------------------
// Multi-benefit membership (dev DB fixtures)
// ---------------------------------------------------------------------------

async function multiBenefitChecks() {
  const created = {
    contactIds: [] as string[],
    workerIds: [] as string[],
    employerIds: [] as string[],
    benefitIds: [] as string[],
    wmbIds: [] as string[],
  };
  try {
    const [emp] = await db
      .insert(employers)
      .values({ siriusId: `${TAG}-EMP`, name: `${TAG} Employer` })
      .returning();
    created.employerIds.push(emp.id);

    const [ben3] = await db
      .insert(trustBenefits)
      .values({ siriusId: `${TAG}-3`, name: `${TAG} Vision` })
      .returning();
    const [ben3e] = await db
      .insert(trustBenefits)
      .values({ siriusId: `${TAG}-3E`, name: `${TAG} Vision Enhanced` })
      .returning();
    created.benefitIds.push(ben3.id, ben3e.id);

    async function makeWorker(name: string) {
      const [c] = await db
        .insert(contacts)
        .values({ given: name, family: TAG, displayName: `${name} ${TAG}` })
        .returning();
      const [w] = await db.insert(workers).values({ contactId: c.id }).returning();
      created.contactIds.push(c.id);
      created.workerIds.push(w.id);
      return w.id;
    }
    async function wmb(workerId: string, benefitId: string) {
      const [row] = await db
        .insert(trustWmb)
        .values({ workerId, employerId: emp.id, benefitId, month: MONTH, year: YEAR })
        .returning();
      created.wmbIds.push(row.id);
      return row;
    }

    const wStd = await makeWorker("OnlyStd"); // benefit 3 only
    const wEnh = await makeWorker("OnlyEnh"); // benefit 3E only
    const wBoth = await makeWorker("Both"); // both benefits (must appear once)

    const wmbStd = await wmb(wStd, ben3.id);
    const wmbEnh = await wmb(wEnh, ben3e.id);
    const wmbBoth1 = await wmb(wBoth, ben3.id);
    const wmbBoth2 = await wmb(wBoth, ben3e.id);

    const ctx = {
      configId: "smoke",
      configData: {},
      providerId: null,
      sftpClientId: null,
      input: { asOfDate: AS_OF },
      storage,
    } as unknown as TrustProviderEdiContext;

    // Multi-benefit union.
    const keys = await wmbPrimaryKeys(ctx, [`${TAG}-3`, `${TAG}-3E`]);
    const keySet = new Set(keys);
    check(
      "multi-benefit: workers unioned across benefits",
      keySet.has(wmbStd.id) && keySet.has(wmbEnh.id),
    );
    const bothKeys = [wmbBoth1.id, wmbBoth2.id].filter((k) => keySet.has(k));
    check(
      "multi-benefit: worker in both benefits appears once (lowest wmb id)",
      bothKeys.length === 1 &&
        bothKeys[0] === [wmbBoth1.id, wmbBoth2.id].sort()[0],
      bothKeys,
    );
    check("multi-benefit: 3 units total", keys.length === 3, keys.length);

    // Units tagged with their source benefit.
    const units = await buildMemberUnits(keys, ctx);
    const byWmb = new Map(units.map((u) => [u.wmb.id, u]));
    check(
      "unit tagged with source benefitSiriusId (std)",
      byWmb.get(wmbStd.id)?.benefitSiriusId === `${TAG}-3`,
      byWmb.get(wmbStd.id)?.benefitSiriusId,
    );
    check(
      "unit tagged with source benefitSiriusId (enh)",
      byWmb.get(wmbEnh.id)?.benefitSiriusId === `${TAG}-3E`,
      byWmb.get(wmbEnh.id)?.benefitSiriusId,
    );

    // Single-benefit behavior unchanged: same call with one benefit.
    const singleKeys = await wmbPrimaryKeys(ctx, [`${TAG}-3`]);
    const singleSet = new Set(singleKeys);
    check(
      "single-benefit: only benefit-3 rows",
      singleSet.has(wmbStd.id) &&
        singleSet.has(wmbBoth1.id) &&
        !singleSet.has(wmbEnh.id) &&
        singleKeys.length === 2,
      singleKeys.length,
    );

    // Array config override routes membership.
    const overrideCtx = {
      ...(ctx as any),
      configData: { benefitSiriusIds: [`${TAG}-3E`] },
    } as TrustProviderEdiContext;
    const oKeys = await wmbPrimaryKeys(overrideCtx, [`${TAG}-3`]);
    check(
      "config benefitSiriusIds array override respected",
      oKeys.every((k) => [wmbEnh.id, wmbBoth2.id].includes(k)) && oKeys.length === 2,
      oKeys.length,
    );
  } finally {
    if (created.wmbIds.length)
      await db.delete(trustWmb).where(inArray(trustWmb.id, created.wmbIds));
    if (created.workerIds.length)
      await db.delete(workers).where(inArray(workers.id, created.workerIds));
    if (created.contactIds.length)
      await db.delete(contacts).where(inArray(contacts.id, created.contactIds));
    if (created.benefitIds.length)
      await db
        .delete(trustBenefits)
        .where(inArray(trustBenefits.id, created.benefitIds));
    if (created.employerIds.length)
      await db.delete(employers).where(inArray(employers.id, created.employerIds));
  }
}

async function main() {
  pureChecks();
  regressionChecks();
  await multiBenefitChecks();
  console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
