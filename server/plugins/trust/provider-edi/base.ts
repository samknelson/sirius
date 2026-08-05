import { and, eq, inArray, isNotNull } from "drizzle-orm";
import {
  workers,
  contacts,
  contactPostal,
  phoneNumbers,
  optionsGender,
  trustBenefits,
  trustWmb,
  workerRelations,
  optionsWorkerRelationType,
  employers,
} from "@shared/schema";
import type {
  TrustProviderEdiContext,
  TrustProviderEdiPlugin,
  EdiBatchAggregates,
} from "./registry";
import { logger } from "../../../logger";

/**
 * Shared base logic for trust-provider EDI plugins.
 *
 * Every EDI file type so far shares the same skeleton: membership is the
 * set of workers holding a monthly benefit record (trust_wmb) for the
 * plugin's benefit(s) in the as-of month; each subscriber carries its
 * active dependents; records are fixed-width lines. This module holds all
 * of that so each plugin only implements its own field layout, code
 * mappings, and type-specific row fields.
 */

// ---------------------------------------------------------------------------
// Fixed-width encoding
// ---------------------------------------------------------------------------

/** One output field: `get` reads from the persisted row; no `get` emits spaces. */
export interface EdiField {
  name: string;
  width: number;
  /** 'left' (default, space pad) | 'right' (zero pad, numeric). */
  align?: "left" | "right";
  get?: (row: Record<string, unknown>) => string;
}

export function str(v: unknown): string {
  return v == null ? "" : String(v);
}

export function padField(value: string, field: EdiField): string {
  const v = value.slice(0, field.width);
  return field.align === "right"
    ? v.padStart(field.width, "0")
    : v.padEnd(field.width, " ");
}

/** Concatenate every field of `fields`, truncated/padded to its width. */
export function encodeFixedWidthRow(
  fields: readonly EdiField[],
  row: Record<string, unknown>,
): string {
  return fields.map((f) => padField(f.get ? f.get(row) : "", f)).join("");
}

// ---------------------------------------------------------------------------
// CSV encoding
// ---------------------------------------------------------------------------

/** One CSV output column: `get` reads from the persisted row; no `get` emits empty. */
export interface EdiCsvField {
  name: string;
  get?: (row: Record<string, unknown>) => string;
}

/** RFC-4180 escaping: quote when the value contains a comma, quote, or newline. */
export function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Encode one row as a CSV line (no trailing newline). */
export function encodeCsvRow(
  fields: readonly EdiCsvField[],
  row: Record<string, unknown>,
): string {
  return fields.map((f) => csvEscape(f.get ? f.get(row) : "")).join(",");
}

/** The CSV column-header line (field names, escaped). */
export function encodeCsvHeaderRow(fields: readonly EdiCsvField[]): string {
  return fields.map((f) => csvEscape(f.name)).join(",");
}

// ---------------------------------------------------------------------------
// File assembly (detail rows + optional header/trailer + CSV column header)
// ---------------------------------------------------------------------------

/**
 * Assemble the full ordered list of output lines for an EDI file:
 *
 *   1. `encodeFileHeader` record(s), when the plugin provides them
 *   2. the CSV column-header row (CSV format only, unless suppressed via
 *      `csvIncludeHeaderRow: false`)
 *   3. one detail line per persisted row (`encodeRow`)
 *   4. `encodeFileTrailer` record(s), when the plugin provides them
 *
 * Header/trailer hooks receive batch aggregates (currently the detail
 * record count) so trailers can carry record counts. Plugins with none of
 * the optional hooks produce exactly the detail lines — byte-identical to
 * the pre-header/trailer behavior (Kaiser, Health Net).
 */
export function assembleEdiFileLines(
  plugin: TrustProviderEdiPlugin,
  rows: ReadonlyArray<Record<string, unknown>>,
  ctx: TrustProviderEdiContext,
): string[] {
  const detail = rows.map((r) => plugin.encodeRow(r, ctx));
  const aggregates: EdiBatchAggregates = { detailRecordCount: detail.length };
  const lines: string[] = [];
  const push = (v: string | string[] | null | undefined) => {
    if (v == null) return;
    if (Array.isArray(v)) lines.push(...v);
    else lines.push(v);
  };
  push(plugin.encodeFileHeader?.(ctx, aggregates));
  if (
    (plugin.outputFormat ?? "fixed-width") === "csv" &&
    plugin.csvIncludeHeaderRow !== false
  ) {
    push(plugin.encodeCsvHeaderRow?.(ctx));
  }
  lines.push(...detail);
  push(plugin.encodeFileTrailer?.(ctx, aggregates));
  return lines;
}

// ---------------------------------------------------------------------------
// Value normalization
// ---------------------------------------------------------------------------

/** yyyy-mm-dd (or Date) → YYYYMMDD; empty when absent. */
export function ymdCompact(value: unknown): string {
  if (!value) return "";
  const s = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.replace(/-/g, "") : "";
}

/** SSN digits, zero-padded to 9; empty stays empty. */
export function padSsn(ssn: unknown): string {
  const digits = String(ssn ?? "").replace(/\D/g, "");
  return digits ? digits.padStart(9, "0").slice(-9) : "";
}

/** Phone digits, 10 wide; a leading US country code 1 is stripped. */
export function phoneDigits(phone: unknown): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1")
    ? digits.slice(1)
    : digits.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Run input
// ---------------------------------------------------------------------------

/** The wizard's as-of date (defaults to today). */
export function readAsOfYmd(ctx: TrustProviderEdiContext): string {
  const input = ctx.input ?? {};
  const today = new Date().toISOString().slice(0, 10);
  return typeof input.asOfDate === "string" && input.asOfDate
    ? input.asOfDate
    : today;
}

// ---------------------------------------------------------------------------
// Membership (default getPrimaryKeys)
// ---------------------------------------------------------------------------

/**
 * The benefit Sirius IDs a run should use: the config-level override
 * (`benefitSiriusIds` array or single `benefitSiriusId` in the config data
 * blob) when present, else the plugin's registered defaults.
 */
export function effectiveBenefitSiriusIds(
  ctx: TrustProviderEdiContext,
  registeredSiriusIds: readonly string[],
): string[] {
  const data = ctx.configData ?? {};
  const listOverride = data.benefitSiriusIds;
  if (Array.isArray(listOverride)) {
    const ids = listOverride.filter(
      (s): s is string => typeof s === "string" && !!s,
    );
    if (ids.length) return ids;
  }
  const override = data.benefitSiriusId;
  if (typeof override === "string" && override) return [override];
  return [...registeredSiriusIds];
}

/** Resolve benefit Sirius IDs to row ids; throws when any is missing. */
export async function resolveBenefitIds(
  ctx: TrustProviderEdiContext,
  benefitSiriusIds: readonly string[],
): Promise<string[]> {
  const rows = await ctx.storage.readOnly.query(async (db) =>
    db
      .select({ id: trustBenefits.id, siriusId: trustBenefits.siriusId })
      .from(trustBenefits)
      .where(inArray(trustBenefits.siriusId, [...benefitSiriusIds])),
  );
  const found = new Map(rows.map((r) => [r.siriusId, r.id]));
  const missing = benefitSiriusIds.filter((s) => !found.has(s));
  if (missing.length) {
    throw new Error(
      `No trust benefit found with Sirius ID '${missing.join("', '")}' — check the EDI configuration.`,
    );
  }
  return benefitSiriusIds.map((s) => found.get(s)!);
}

// NOTE on provider scoping: file membership is defined by the benefit(s) —
// workers with a monthly benefit record (trust_wmb) in the as-of month. The
// config's providerId is an organizational dimension (which provider entity
// the file/SFTP destination belongs to); the schema has no provider→benefit
// relation to filter by. Admins must point each config at the correct benefit.

/**
 * Default membership: one trust_wmb row id per worker holding a monthly
 * benefit record for any of the benefits in the as-of month. If a worker
 * has several qualifying rows (e.g. two employers), pick deterministically —
 * prefer a non-COBRA employer row, then lowest row id.
 *
 * DECISION (dependents-as-subscribers): a covered dependent must appear on
 * the file ONLY as a dependent record under their subscriber — never also as
 * their own standalone subscriber. So relation-sourced rows (non-null
 * `source_relation_id`) are excluded from subscriber selection whenever the
 * relation's subscriber (worker1) also holds their OWN (null-source) row for
 * the same benefit/month, i.e. is a subscriber on this file. Fail-safe: when
 * the subscriber is NOT in the file (or the source relation is dangling),
 * the relation-sourced row is kept as a standalone subscriber so the covered
 * person never silently drops off the file.
 */
export async function wmbPrimaryKeys(
  ctx: TrustProviderEdiContext,
  benefitSiriusIds: readonly string[],
): Promise<string[]> {
  const siriusIds = effectiveBenefitSiriusIds(ctx, benefitSiriusIds);
  const benefitIds = await resolveBenefitIds(ctx, siriusIds);
  const asOfYmd = readAsOfYmd(ctx);
  const asOfYear = Number(asOfYmd.slice(0, 4));
  const asOfMonth = Number(asOfYmd.slice(5, 7));
  const wmbRows = await ctx.storage.readOnly.query(async (db) =>
    db
      .select({
        id: trustWmb.id,
        workerId: trustWmb.workerId,
        benefitId: trustWmb.benefitId,
        sourceRelationId: trustWmb.sourceRelationId,
        subscriberWorkerId: workerRelations.worker1,
        employerSiriusId: employers.siriusId,
      })
      .from(trustWmb)
      .leftJoin(employers, eq(trustWmb.employerId, employers.id))
      .leftJoin(
        workerRelations,
        eq(trustWmb.sourceRelationId, workerRelations.id),
      )
      .where(
        and(
          inArray(trustWmb.benefitId, benefitIds),
          eq(trustWmb.year, asOfYear),
          eq(trustWmb.month, asOfMonth),
        ),
      ),
  );
  // Subscribers on this file: workers holding their own (null-source) row
  // for a benefit. Keyed per benefit so multi-benefit runs don't cross-mask.
  const subscriberKeys = new Set(
    wmbRows
      .filter((r) => r.sourceRelationId == null)
      .map((r) => `${r.workerId}|${r.benefitId}`),
  );
  // Exclude dependent (relation-sourced) rows whose subscriber is in the
  // file — those people are emitted as dependent records instead.
  const candidateRows = wmbRows.filter(
    (r) =>
      r.sourceRelationId == null ||
      !r.subscriberWorkerId ||
      !subscriberKeys.has(`${r.subscriberWorkerId}|${r.benefitId}`),
  );
  const byWorker = new Map<string, (typeof wmbRows)[number]>();
  for (const row of candidateRows) {
    const prev = byWorker.get(row.workerId);
    if (!prev) {
      byWorker.set(row.workerId, row);
      continue;
    }
    const prevCobra = prev.employerSiriusId === "COBRA";
    const rowCobra = row.employerSiriusId === "COBRA";
    if (
      (prevCobra && !rowCobra) ||
      (prevCobra === rowCobra && row.id < prev.id)
    ) {
      byWorker.set(row.workerId, row);
    }
  }
  return Array.from(byWorker.values()).map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Member model (shared processBatch data assembly)
// ---------------------------------------------------------------------------

export interface EdiPostal {
  street: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
}

export interface EdiPerson {
  ssn: string | null;
  contactId: string;
  givenName: string | null;
  familyName: string | null;
  middleName: string | null;
  birthDate: unknown;
  /** Raw gender option code (e.g. "M"/"F"); plugins map to their own codes. */
  genderCode: string | null;
  /** Primary active postal address, when present. */
  postal: EdiPostal | null;
  /** Primary active phone number digits source, when present. */
  phoneNumber: string | null;
}

export interface EdiDependent extends EdiPerson {
  relationId: string;
  /** Relation-type Sirius ID (e.g. SP/DP/C/QMSCO). */
  relationSiriusId: string | null;
}

/** One subscriber (wmb row) plus their active dependents. */
export interface EdiMemberUnit {
  wmb: typeof trustWmb.$inferSelect;
  /**
   * Sirius ID of the benefit this unit's wmb row belongs to — lets a
   * multi-benefit plugin tell which benefit a member unit came from.
   */
  benefitSiriusId: string | null;
  /** True when the wmb row's employer has the Sirius ID "COBRA". */
  isCobra: boolean;
  /**
   * yyyy-mm-dd first day of the worker's CONTIGUOUS run of monthly records
   * for this benefit ending at the wmb month (unfloored — plugins apply
   * their own go-live floors).
   */
  coverageStartYmd: string;
  subscriber: EdiPerson;
  dependents: EdiDependent[];
}

const personColumns = {
  ssn: workers.ssn,
  contactId: contacts.id,
  givenName: contacts.given,
  familyName: contacts.family,
  middleName: contacts.middle,
  birthDate: contacts.birthDate,
  genderCode: optionsGender.code,
};

/**
 * Materialize a batch of trust_wmb keys into the normalized member model:
 * subscriber demographics/address/phone, covered dependents with their own
 * address/phone, COBRA flag, and contiguous coverage start.
 *
 * Dependents are derived from trust_wmb itself: a dependent is anyone who
 * holds a monthly benefit record for the SAME benefit and month whose
 * `source_relation_id` points at a relation whose worker1 is the
 * subscriber. This keeps the file in lockstep with what the benefits scan
 * actually granted — a relation that looks active but was not granted the
 * benefit does not appear, and a granted dependent always does (even if
 * the relation has since ended). Relation-type codes still come from the
 * relation the WMB row references, so provider role mappings are
 * unchanged. Dependent rows with a dangling source relation are skipped
 * with a warning (null-source rows are treated as subscribers upstream).
 * Order follows the batch's wmb rows; missing workers are skipped.
 */
export async function buildMemberUnits(
  keys: string[],
  ctx: TrustProviderEdiContext,
): Promise<EdiMemberUnit[]> {
  return ctx.storage.readOnly.query(async (db) => {
    const wmbRows = await db
      .select()
      .from(trustWmb)
      .where(inArray(trustWmb.id, keys));

    // COBRA subscribers are those whose monthly benefit record's employer
    // has the Sirius ID "COBRA".
    const employerIds = Array.from(
      new Set(wmbRows.map((e) => e.employerId).filter(Boolean)),
    );
    const cobraEmployers = employerIds.length
      ? await db
          .select({ id: employers.id })
          .from(employers)
          .where(
            and(
              inArray(employers.id, employerIds),
              eq(employers.siriusId, "COBRA"),
            ),
          )
      : [];
    const cobraEmployerIds = new Set(cobraEmployers.map((e) => e.id));

    // Coverage start = first month of the worker's CONTIGUOUS run of
    // monthly records for this benefit ending at the wmb month. Load all
    // (worker, year, month) pairs for the batch's workers + benefits once.
    const workerIds = Array.from(new Set(wmbRows.map((r) => r.workerId)));
    const benefitIds = Array.from(new Set(wmbRows.map((r) => r.benefitId)));

    // Benefit Sirius IDs so multi-benefit plugins can tell which benefit a
    // unit came from.
    const benefitRows = benefitIds.length
      ? await db
          .select({ id: trustBenefits.id, siriusId: trustBenefits.siriusId })
          .from(trustBenefits)
          .where(inArray(trustBenefits.id, benefitIds))
      : [];
    const siriusByBenefitId = new Map(
      benefitRows.map((b) => [b.id, b.siriusId]),
    );
    const allMonths = workerIds.length
      ? await db
          .select({
            workerId: trustWmb.workerId,
            year: trustWmb.year,
            month: trustWmb.month,
          })
          .from(trustWmb)
          .where(
            and(
              inArray(trustWmb.workerId, workerIds),
              inArray(trustWmb.benefitId, benefitIds),
            ),
          )
      : [];
    const monthsByWorker = new Map<string, Set<string>>();
    for (const m of allMonths) {
      let set = monthsByWorker.get(m.workerId);
      if (!set) monthsByWorker.set(m.workerId, (set = new Set()));
      set.add(`${m.year}-${m.month}`);
    }
    /** Walk back from (year, month) while the previous month exists. */
    function coverageStartFor(workerId: string, year: number, month: number): string {
      const set = monthsByWorker.get(workerId);
      let y = year;
      let m = month;
      while (set) {
        let py = y;
        let pm = m - 1;
        if (pm === 0) {
          pm = 12;
          py -= 1;
        }
        if (!set.has(`${py}-${pm}`)) break;
        y = py;
        m = pm;
      }
      return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
    }

    // Dependent WMB rows for the batch's benefits/months, keyed to their
    // subscriber via the source relation's worker1. One batched query; the
    // exact (benefit, year, month) match happens in JS since a batch can in
    // principle span months.
    const years = Array.from(new Set(wmbRows.map((r) => r.year)));
    const months = Array.from(new Set(wmbRows.map((r) => r.month)));
    const depWmbRows =
      benefitIds.length && years.length
        ? await db
            .select({
              depWmbId: trustWmb.id,
              benefitId: trustWmb.benefitId,
              year: trustWmb.year,
              month: trustWmb.month,
              depWorkerId: trustWmb.workerId,
              sourceRelationId: trustWmb.sourceRelationId,
              relationId: workerRelations.id,
              subscriberWorkerId: workerRelations.worker1,
              relationSiriusId: optionsWorkerRelationType.siriusId,
              ...personColumns,
            })
            .from(trustWmb)
            .leftJoin(
              workerRelations,
              eq(trustWmb.sourceRelationId, workerRelations.id),
            )
            .leftJoin(
              optionsWorkerRelationType,
              eq(workerRelations.relationType, optionsWorkerRelationType.id),
            )
            .innerJoin(workers, eq(trustWmb.workerId, workers.id))
            .innerJoin(contacts, eq(workers.contactId, contacts.id))
            .leftJoin(optionsGender, eq(contacts.gender, optionsGender.id))
            .where(
              and(
                inArray(trustWmb.benefitId, benefitIds),
                inArray(trustWmb.year, years),
                inArray(trustWmb.month, months),
                isNotNull(trustWmb.sourceRelationId),
              ),
            )
        : [];
    // subscriberWorkerId|benefitId|year-month → dependent rows.
    const depsBySubscriber = new Map<string, typeof depWmbRows>();
    for (const dep of depWmbRows) {
      if (!dep.relationId || !dep.subscriberWorkerId) {
        // Dangling source relation: the scan granted this row through a
        // relation that no longer exists, so it can't be attached to a
        // subscriber unit. Skip it rather than fail the batch.
        logger.warn(
          "EDI dependent WMB row has a dangling source relation; skipping",
          {
            service: "trust-provider-edi",
            wmbId: dep.depWmbId,
            sourceRelationId: dep.sourceRelationId,
          },
        );
        continue;
      }
      const key = `${dep.subscriberWorkerId}|${dep.benefitId}|${dep.year}-${dep.month}`;
      let list = depsBySubscriber.get(key);
      if (!list) depsBySubscriber.set(key, (list = []));
      list.push(dep);
    }

    async function primaryPostal(contactId: string): Promise<EdiPostal | null> {
      const [postal] = await db
        .select({
          street: contactPostal.street,
          city: contactPostal.city,
          state: contactPostal.state,
          postalCode: contactPostal.postalCode,
        })
        .from(contactPostal)
        .where(
          and(
            eq(contactPostal.contactId, contactId),
            eq(contactPostal.isActive, true),
            eq(contactPostal.isPrimary, true),
          ),
        );
      return postal ?? null;
    }
    async function primaryPhone(contactId: string): Promise<string | null> {
      const [phone] = await db
        .select({ phoneNumber: phoneNumbers.phoneNumber })
        .from(phoneNumbers)
        .where(
          and(
            eq(phoneNumbers.contactId, contactId),
            eq(phoneNumbers.isActive, true),
            eq(phoneNumbers.isPrimary, true),
          ),
        );
      return phone?.phoneNumber ?? null;
    }

    const units: EdiMemberUnit[] = [];
    for (const wmb of wmbRows) {
      const [subscriber] = await db
        .select(personColumns)
        .from(workers)
        .innerJoin(contacts, eq(workers.contactId, contacts.id))
        .leftJoin(optionsGender, eq(contacts.gender, optionsGender.id))
        .where(eq(workers.id, wmb.workerId));
      if (!subscriber) continue;

      const subscriberPostal = await primaryPostal(subscriber.contactId);
      const subscriberPhone = await primaryPhone(subscriber.contactId);

      // Covered dependents: WMB rows for the same benefit and month whose
      // source relation points back at this subscriber. Deduped by
      // dependent worker (lowest wmb row id wins deterministically).
      const depKey = `${wmb.workerId}|${wmb.benefitId}|${wmb.year}-${wmb.month}`;
      const depRows = (depsBySubscriber.get(depKey) ?? [])
        .slice()
        .sort((a, b) => (a.depWmbId < b.depWmbId ? -1 : 1));
      const dependents: EdiDependent[] = [];
      const seenDepWorkers = new Set<string>();
      for (const dep of depRows) {
        if (seenDepWorkers.has(dep.depWorkerId)) continue;
        seenDepWorkers.add(dep.depWorkerId);
        dependents.push({
          relationId: dep.relationId!,
          relationSiriusId: dep.relationSiriusId ?? null,
          ssn: dep.ssn,
          contactId: dep.contactId,
          givenName: dep.givenName,
          familyName: dep.familyName,
          middleName: dep.middleName,
          birthDate: dep.birthDate,
          genderCode: dep.genderCode,
          postal: await primaryPostal(dep.contactId),
          phoneNumber: await primaryPhone(dep.contactId),
        });
      }

      units.push({
        wmb,
        benefitSiriusId: siriusByBenefitId.get(wmb.benefitId) ?? null,
        isCobra: cobraEmployerIds.has(wmb.employerId),
        coverageStartYmd: coverageStartFor(wmb.workerId, wmb.year, wmb.month),
        subscriber: {
          ...subscriber,
          postal: subscriberPostal,
          phoneNumber: subscriberPhone,
        },
        dependents,
      });
    }
    return units;
  });
}

/** "Given Family" display name used in preview columns. */
export function displayName(p: {
  givenName: string | null;
  familyName: string | null;
}): string {
  return [p.givenName, p.familyName].filter(Boolean).join(" ");
}

/** Common postal → row fields (street/city/state/5-digit zip). */
export function postalFields(postal: EdiPostal | null): {
  street: string;
  city: string;
  state: string;
  zip: string;
} {
  return {
    street: postal?.street ?? "",
    city: postal?.city ?? "",
    state: postal?.state ?? "",
    zip: String(postal?.postalCode ?? "").replace(/\D/g, "").slice(0, 5),
  };
}
