import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import {
  workerHours,
  workers,
  contacts,
  employers,
  optionsEmploymentStatus,
} from "@shared/schema";
import {
  registerTrustProviderEdiPlugin,
  type TrustProviderEdiContext,
} from "../registry";
import { str } from "../base";
import type { JsonSchema } from "@shared/json-schema-form";

/**
 * SMF — Local 11 hours export.
 *
 * Port of the legacy `edi_local11.inc`. Unlike the membership EDI files,
 * this is NOT wmb-driven: it is a CSV export of worker hours by employer
 * and month over a staff-chosen year/month range. One row per
 * worker/employer/month hours entry (the worker_hours row IS the record —
 * its id is the stable primary key, so de-duplication is inherent).
 *
 * Columns match the legacy default display fields: worker SSN, worker
 * name, employer name, employer code, year, month, hours, hours type
 * (employment status name).
 */

const PLUGIN_ID = "sitespecific-smf-local11";

interface YmRange {
  startYm: number; // year * 100 + month
  endYm: number;
}

function toInt(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

/** Month arithmetic helper: today shifted back `monthsAgo` months. */
function shiftedYm(monthsAgo: number): { year: number; month: number } {
  const d = new Date();
  const total = d.getFullYear() * 12 + d.getMonth() - monthsAgo;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

/**
 * Read the wizard's start/end year-month input. Defaults mirror the
 * legacy form: start = 10 months ago, end = last month.
 */
export function readYmRange(ctx: TrustProviderEdiContext): YmRange {
  const input = ctx.input ?? {};
  const defStart = shiftedYm(10);
  const defEnd = shiftedYm(1);
  const startYear = toInt(input.startYear, defStart.year);
  const startMonth = Math.min(12, toInt(input.startMonth, defStart.month));
  const endYear = toInt(input.endYear, defEnd.year);
  const endMonth = Math.min(12, toInt(input.endMonth, defEnd.month));
  const startYm = startYear * 100 + startMonth;
  const endYm = endYear * 100 + endMonth;
  if (startYm > endYm) {
    throw new Error(
      "The start year/month must not be after the end year/month.",
    );
  }
  return { startYm, endYm };
}

/** CSV-quote a single value (RFC 4180 style). */
export function csvField(v: unknown): string {
  const s = str(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const COLUMNS = [
  { id: "workerSsn", header: "Worker SSN", type: "string", width: 110 },
  { id: "workerName", header: "Worker Name", type: "string", width: 200 },
  { id: "employerName", header: "Employer Name", type: "string", width: 220 },
  { id: "employerCode", header: "Employer Code", type: "string", width: 120 },
  { id: "hoursYear", header: "Year", type: "number", width: 70 },
  { id: "hoursMonth", header: "Month", type: "number", width: 70 },
  { id: "hoursAmt", header: "Hours", type: "number", width: 80 },
  { id: "hoursType", header: "Hours Type", type: "string", width: 140 },
] as const;

/** Legacy CSV column order (also the encodeRow field order). */
export const LOCAL11_CSV_FIELDS = COLUMNS.map((c) => c.id);

registerTrustProviderEdiPlugin({
  id: PLUGIN_ID,
  name: "SMF - Local 11 Hours Export",
  description:
    "CSV export of worker hours by employer and month over a chosen " +
    "year/month range (legacy edi_local11): worker SSN and name, employer " +
    "name and code, year, month, hours, and hours type.",
  // CSV layouts have no fixed-width field metadata.
  ediFields: [],
  // Bespoke worker-hours range export runs its own read-only queries.
  needsReadOnlyDb: true,

  // inputSchema is a getter so the year/month defaults are computed when
  // the wizard's parameter form is rendered, not at boot.
  get inputSchema(): JsonSchema {
    const defStart = shiftedYm(10);
    const defEnd = shiftedYm(1);
    return {
      type: "object",
      properties: {
        startYear: {
          type: "integer",
          title: "Start Year",
          default: defStart.year,
        },
        startMonth: {
          type: "integer",
          title: "Start Month",
          minimum: 1,
          maximum: 12,
          default: defStart.month,
        },
        endYear: {
          type: "integer",
          title: "End Year",
          default: defEnd.year,
        },
        endMonth: {
          type: "integer",
          title: "End Month",
          minimum: 1,
          maximum: 12,
          default: defEnd.month,
        },
      },
      required: ["startYear", "startMonth", "endYear", "endMonth"],
    };
  },

  getColumns() {
    return COLUMNS.map((c) => ({ ...c }));
  },

  // Membership is the worker_hours rows in the range — each row id is the
  // stable, de-duplicated primary key (the table has a unique
  // (year, month, day, worker, employer) constraint behind it).
  async getPrimaryKeys(ctx) {
    const { startYm, endYm } = readYmRange(ctx);
    const ym = sql<number>`(${workerHours.year} * 100 + ${workerHours.month})`;
    const rows = await ctx.storage.readOnly.query(async (db) =>
      db
        .select({ id: workerHours.id })
        .from(workerHours)
        .where(and(gte(ym, startYm), lte(ym, endYm)))
        .orderBy(
          asc(workerHours.year),
          asc(workerHours.month),
          asc(workerHours.workerId),
          asc(workerHours.employerId),
          asc(workerHours.id),
        ),
    );
    return rows.map((r) => r.id);
  },

  async processBatch(keys, ctx) {
    const rows = await ctx.storage.readOnly.query(async (db) =>
      db
        .select({
          id: workerHours.id,
          hoursYear: workerHours.year,
          hoursMonth: workerHours.month,
          hoursAmt: workerHours.hours,
          workerSsn: workers.ssn,
          workerName: contacts.displayName,
          workerId: workers.id,
          employerName: employers.name,
          employerCode: employers.siriusId,
          hoursType: optionsEmploymentStatus.name,
        })
        .from(workerHours)
        .innerJoin(workers, eq(workerHours.workerId, workers.id))
        .innerJoin(contacts, eq(workers.contactId, contacts.id))
        .innerJoin(employers, eq(workerHours.employerId, employers.id))
        .leftJoin(
          optionsEmploymentStatus,
          eq(workerHours.employmentStatusId, optionsEmploymentStatus.id),
        )
        .where(inArray(workerHours.id, keys)),
    );
    // Preserve the batch's key order (query result order is unspecified).
    const byId = new Map(rows.map((r) => [r.id, r]));
    const out: Array<Record<string, unknown>> = [];
    for (const key of keys) {
      const r = byId.get(key);
      if (!r) continue; // row deleted mid-run; skip rather than fail
      out.push({
        pk: r.id,
        workerSsn: r.workerSsn ?? "",
        workerName: r.workerName ?? "",
        workerId: r.workerId,
        employerName: r.employerName ?? "",
        employerCode: r.employerCode ?? "",
        hoursYear: r.hoursYear,
        hoursMonth: r.hoursMonth,
        hoursAmt: r.hoursAmt ?? 0,
        hoursType: r.hoursType ?? "",
      });
    }
    return out;
  },

  encodeRow(row) {
    return LOCAL11_CSV_FIELDS.map((f) => csvField(row[f])).join(",");
  },

  buildFilename() {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    return `LOCAL11_HOURS_${stamp}.csv`;
  },
});
