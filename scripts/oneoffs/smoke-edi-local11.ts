/**
 * Smoke test: SMF Local 11 hours export plugin (task: rebuild the legacy
 * edi_local11 CSV export as a trust-provider EDI plugin).
 *
 * Fixtures (created and deleted against the dev DB):
 *  - Worker W with hours at two employers (E1, E2) across three months and
 *    two hours types (employment statuses).
 *  - One hours row OUTSIDE the requested range -> excluded.
 *  - Range spans a year boundary (2025-11 .. 2026-01).
 *
 * Checks getPrimaryKeys range filtering, processBatch column values,
 * encodeRow CSV output (incl. quoting), and pk stability/de-dup.
 * Usage: npx tsx scripts/oneoffs/smoke-edi-local11.ts
 */
// Import storage/database FIRST so its (circular) module graph initializes
// in boot order (see eligibility smoke-test convention).
import { storage } from "../../server/storage/database";
import { db } from "../../server/storage/db";
import { inArray } from "drizzle-orm";
import {
  contacts,
  workers,
  employers,
  workerHours,
  optionsEmploymentStatus,
} from "@shared/schema";
import { trustProviderEdiPluginRegistry } from "../../server/plugins/trust/provider-edi/registry";
import "../../server/plugins/trust/provider-edi/plugins/sitespecific-smf-local11";
import type { TrustProviderEdiContext } from "../../server/plugins/trust/provider-edi/registry";

const TAG = "SMOKE-L11";

let failures = 0;
function check(label: string, ok: boolean, extra?: unknown) {
  if (!ok) failures++;
  console.log(
    `${ok ? "OK  " : "FAIL"} ${label}${extra !== undefined ? ` :: ${JSON.stringify(extra)}` : ""}`,
  );
}

async function main() {
  const created = {
    contactIds: [] as string[],
    workerIds: [] as string[],
    employerIds: [] as string[],
    statusIds: [] as string[],
    hoursIds: [] as string[],
  };

  try {
    const [c] = await db
      .insert(contacts)
      .values({ given: "Wanda", family: TAG, displayName: `Wanda "W" ${TAG}` })
      .returning();
    created.contactIds.push(c.id);
    const [w] = await db
      .insert(workers)
      .values({ contactId: c.id, ssn: "123456789" })
      .returning();
    created.workerIds.push(w.id);

    const [e1] = await db
      .insert(employers)
      .values({ name: `Hotel Alpha, ${TAG}`, siriusId: `${TAG}-E1` })
      .returning();
    const [e2] = await db
      .insert(employers)
      .values({ name: `Hotel Beta ${TAG}`, siriusId: `${TAG}-E2` })
      .returning();
    created.employerIds.push(e1.id, e2.id);

    const [st1] = await db
      .insert(optionsEmploymentStatus)
      .values({ name: `${TAG} Regular`, code: `${TAG}-REG` })
      .returning();
    const [st2] = await db
      .insert(optionsEmploymentStatus)
      .values({ name: `${TAG} Banquet`, code: `${TAG}-BQT` })
      .returning();
    created.statusIds.push(st1.id, st2.id);

    const mk = (
      year: number,
      month: number,
      employerId: string,
      statusId: string,
      hours: number,
    ) => ({
      year,
      month,
      day: 1,
      workerId: w.id,
      employerId,
      employmentStatusId: statusId,
      hours,
    });
    const hoursRows = await db
      .insert(workerHours)
      .values([
        mk(2025, 11, e1.id, st1.id, 120.5), // in range
        mk(2025, 12, e1.id, st1.id, 88), // in range
        mk(2025, 12, e2.id, st2.id, 40), // in range, second employer/type
        mk(2026, 1, e2.id, st2.id, 10), // in range (end month)
        mk(2026, 2, e1.id, st1.id, 999), // OUT of range
        mk(2025, 10, e1.id, st1.id, 999), // OUT of range
      ])
      .returning();
    created.hoursIds.push(...hoursRows.map((r) => r.id));
    const inRangeIds = new Set(hoursRows.slice(0, 4).map((r) => r.id));

    const plugin = trustProviderEdiPluginRegistry.get(
      "sitespecific-smf-local11",
    )!;
    check("plugin registered", !!plugin);

    const ctx: TrustProviderEdiContext = {
      configId: "smoke",
      configData: {},
      providerId: null,
      sftpClientId: null,
      input: { startYear: 2025, startMonth: 11, endYear: 2026, endMonth: 1 },
      storage,
    };

    const keys = (await plugin.getPrimaryKeys!(ctx)).filter((k) =>
      created.hoursIds.includes(k),
    );
    check("range filter picks exactly the 4 in-range rows", keys.length === 4 && keys.every((k) => inRangeIds.has(k)), keys.length);

    const rows = await plugin.processBatch(keys, ctx);
    check("one row per hours entry (pk de-dup inherent)", rows.length === 4, rows.length);
    check(
      "pks unique and equal to hours row ids",
      new Set(rows.map((r) => r.pk)).size === 4 &&
        rows.every((r) => inRangeIds.has(String(r.pk))),
    );

    const first = rows.find((r) => r.hoursYear === 2025 && r.hoursMonth === 11)!;
    check("SSN + name populated", first.workerSsn === "123456789" && String(first.workerName).includes("Wanda"), first);
    check("employer name/code", first.employerName === `Hotel Alpha, ${TAG}` && first.employerCode === `${TAG}-E1`);
    check("hours amount + type", first.hoursAmt === 120.5 && first.hoursType === `${TAG} Regular`);

    const second = rows.find((r) => r.hoursMonth === 12 && r.employerCode === `${TAG}-E2`)!;
    check("second employer + hours type row present", !!second && second.hoursType === `${TAG} Banquet` && second.hoursAmt === 40);

    const line = plugin.encodeRow(first, ctx);
    check(
      "CSV line quotes comma-bearing employer name and quotes in worker name",
      line ===
        `123456789,"Wanda ""W"" ${TAG}","Hotel Alpha, ${TAG}",${TAG}-E1,2025,11,120.5,${TAG} Regular`,
      line,
    );
    check("filename shape", /^LOCAL11_HOURS_\d{8}\.csv$/.test(plugin.buildFilename(ctx)));

    // Bad range rejected.
    let threw = false;
    try {
      await plugin.getPrimaryKeys!({ ...ctx, input: { startYear: 2026, startMonth: 2, endYear: 2026, endMonth: 1 } });
    } catch {
      threw = true;
    }
    check("inverted range throws", threw);
  } finally {
    if (created.hoursIds.length)
      await db.delete(workerHours).where(inArray(workerHours.id, created.hoursIds));
    if (created.workerIds.length)
      await db.delete(workers).where(inArray(workers.id, created.workerIds));
    if (created.contactIds.length)
      await db.delete(contacts).where(inArray(contacts.id, created.contactIds));
    if (created.employerIds.length)
      await db.delete(employers).where(inArray(employers.id, created.employerIds));
    if (created.statusIds.length)
      await db
        .delete(optionsEmploymentStatus)
        .where(inArray(optionsEmploymentStatus.id, created.statusIds));
  }

  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL CHECKS PASSED");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
