import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { contacts, optionsWorkerIdType, phoneNumbers, workerIds, workers } from "@shared/schema";
import type { JsonSchema } from "@shared/json-schema-form";
import { createUnifiedOptionsStorage } from "../../../storage/unified-options";
import { registerQuicksearchPlugin } from "../registry";
import { correlated, type QuicksearchDb } from "../sql";
import type { QuicksearchContext, QuicksearchPlugin, QuicksearchResult } from "../types";

/** Digits only. Every identifier clause reasons about digits, not formatting. */
function digitsOf(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * A phone number needs enough digits to be a phone number. Seven is a local
 * number without the area code — below that, a "phone match" is noise.
 */
const MIN_PHONE_DIGITS = 7;

/** SSN comparison the input could support, if any. */
export type SsnPlan = { mode: "full" | "last4"; digits: string };

/**
 * What the typed string could plausibly BE. Kept separate from the SQL because
 * this — not the query building — is the interesting decision: an identifier
 * clause that participates when it should not turns a search box into a way to
 * enumerate records by typing digits.
 */
export interface WorkerSearchPlan {
  /** Contains-match on the display name. Always applies. */
  name: string;
  /** The whole worker number, or null when the input is not one. */
  siriusId: number | null;
  /** Configured id types to look in — empty means the clause is dropped. */
  workerIdTypeIds: string[];
  /** The exact identifier to look for, or null when the clause is dropped. */
  workerIdValue: string | null;
  /** Digits a stored phone number must end with, or null. */
  phoneDigits: string | null;
  /** How to compare an SSN, or null when the input cannot be one. */
  ssn: SsnPlan | null;
}

export interface WorkerSearchSettings {
  idTypeIds?: unknown;
  searchPhone?: unknown;
  searchSsn?: unknown;
}

/**
 * Decide which clauses the input could satisfy.
 *
 * `settings` arrives from the runner with every permission-gated option the
 * user may not use already forced off, so this function reads them as plain
 * configuration and never re-derives permission.
 */
export function planWorkerSearch(
  rawQuery: string,
  settings: WorkerSearchSettings,
): WorkerSearchPlan {
  const query = rawQuery.trim();
  const digits = digitsOf(query);
  const idTypeIds = Array.isArray(settings.idTypeIds)
    ? settings.idTypeIds.filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];

  // The worker number is the whole number, never a prefix of one.
  const numeric = /^\d+$/.test(query) && Number.isSafeInteger(Number(query));

  // A worker ID matches exactly. A partial identifier is not an identifier, so
  // there is deliberately no prefix search here.
  const workerIdValue = idTypeIds.length > 0 && query.length > 0 ? query : null;

  // Phone matches on digits, ignoring formatting on both sides, once there are
  // enough of them to be a number rather than a fragment.
  const phoneDigits =
    settings.searchPhone === true && digits.length >= MIN_PHONE_DIGITS ? digits : null;

  // SSN is compared with `=`, as a full number or a last-four. Anything else
  // is not an SSN and the clause is dropped entirely — typing `008` must not
  // walk the SSN column.
  let ssn: SsnPlan | null = null;
  if (settings.searchSsn === true) {
    if (digits.length === 9) ssn = { mode: "full", digits };
    else if (digits.length === 4) ssn = { mode: "last4", digits };
  }

  return {
    name: query,
    siriusId: numeric ? Number(query) : null,
    workerIdTypeIds: idTypeIds,
    workerIdValue,
    phoneDigits,
    ssn,
  };
}

/**
 * The worker id types an administrator may switch on, offered as a live enum
 * so the form lists the site's own id types rather than free text.
 */
async function settingsSchema(): Promise<JsonSchema> {
  const types = await createUnifiedOptionsStorage().list("worker-id-type");
  const idTypes = (Array.isArray(types) ? types : []) as Array<{ id: string; name: string }>;
  return {
    type: "object",
    properties: {
      idTypeIds: {
        type: "array",
        title: "Worker ID types to search",
        description:
          "Identifiers of these types are matched exactly — a partial identifier finds nothing.",
        items: {
          type: "string",
          oneOf: idTypes.map((t) => ({ const: t.id, title: t.name })),
        },
        uniqueItems: true,
        default: [],
      },
      searchPhone: {
        type: "boolean",
        title: "Search phone numbers",
        description:
          "Matches on digits only, so formatting does not matter. Requires the 'staff' permission, which is what grants access to contact details.",
        default: false,
      },
      searchSsn: {
        type: "boolean",
        title: "Search Social Security Numbers",
        description:
          "Full number or last four, matched exactly. Additionally requires the 'workers.ssn' permission, and the number itself is never shown in a result.",
        default: false,
      },
    },
    additionalProperties: false,
  } as JsonSchema;
}

interface MatchFlags {
  matchedName: boolean;
  matchedSiriusId: boolean;
  matchedWorkerId: boolean;
  matchedPhone: boolean;
  matchedSsn: boolean;
}

/**
 * Which clause to report. A row can satisfy several at once; report the most
 * specific, because that is the one that explains a surprising hit.
 */
function describeMatch(flags: MatchFlags, idTypeName: string | null): string | undefined {
  if (flags.matchedSsn) return "SSN";
  if (flags.matchedWorkerId) return idTypeName ?? "Worker ID";
  if (flags.matchedPhone) return "Phone";
  if (flags.matchedSiriusId) return "Worker number";
  if (flags.matchedName) return "Name";
  return undefined;
}

/**
 * The worker search statement, separated from the plugin so its generated SQL
 * can be asserted on without a database. Correlated references to the worker
 * being selected go through {@link correlated} — see that helper for why
 * interpolating the column directly is not safe in a select list. This select
 * joins `contacts`, which happens to make Drizzle qualify columns anyway; the
 * explicit form is what keeps that true if the join ever goes away.
 */
export function buildWorkerSearchQuery(
  client: QuicksearchDb,
  plan: WorkerSearchPlan,
  limit: number,
) {
  const workerId = correlated(workers.id);
  const workerContactId = correlated(workers.contactId);

  const nameMatch = sql<boolean>`${contacts.displayName} ILIKE ${`%${plan.name}%`}`;

  const siriusIdMatch =
    plan.siriusId !== null
      ? sql<boolean>`${workers.siriusId} = ${plan.siriusId}`
      : sql<boolean>`false`;

  const workerIdMatch =
    plan.workerIdValue !== null
      ? sql<boolean>`EXISTS (
          SELECT 1 FROM ${workerIds} wi
          WHERE wi.worker_id = ${workerId}
            AND wi.type_id IN (${sql.join(
              plan.workerIdTypeIds.map((id) => sql`${id}`),
              sql`, `,
            )})
            AND wi.value = ${plan.workerIdValue}
        )`
      : sql<boolean>`false`;

  // Suffix comparison so a local number finds a stored number that carries
  // an area or country code.
  const phoneMatch =
    plan.phoneDigits !== null
      ? sql<boolean>`EXISTS (
          SELECT 1 FROM ${phoneNumbers} pn
          WHERE pn.contact_id = ${workerContactId}
            AND regexp_replace(pn.phone_number, '[^0-9]', '', 'g') LIKE ${`%${plan.phoneDigits}`}
        )`
      : sql<boolean>`false`;

  const ssnMatch =
    plan.ssn === null
      ? sql<boolean>`false`
      : plan.ssn.mode === "full"
        ? sql<boolean>`regexp_replace(${workers.ssn}, '[^0-9]', '', 'g') = ${plan.ssn.digits}`
        : sql<boolean>`right(regexp_replace(${workers.ssn}, '[^0-9]', '', 'g'), 4) = ${plan.ssn.digits}`;

  const clauses: SQL[] = [nameMatch, siriusIdMatch, workerIdMatch, phoneMatch, ssnMatch];

  return client
    .select({
      id: workers.id,
      siriusId: workers.siriusId,
      displayName: contacts.displayName,
      matchedName: nameMatch,
      matchedSiriusId: siriusIdMatch,
      matchedWorkerId: workerIdMatch,
      matchedPhone: phoneMatch,
      matchedSsn: ssnMatch,
    })
    .from(workers)
    .innerJoin(contacts, eq(workers.contactId, contacts.id))
    .where(or(...clauses))
    .orderBy(contacts.displayName)
    // One more than the cap so the runner can report truncation.
    .limit(limit + 1);
}

export const workerQuicksearchPlugin: QuicksearchPlugin = {
  id: "worker",
  name: "Workers",
  description:
    "Find a worker by name, worker number, a configured worker ID type, and optionally phone or SSN.",
  icon: "users",
  needsReadOnlyDb: true,
  settingsSchema,
  // The runner forces these off for a user without the permission, BEFORE the
  // search runs. `searchPhone` is tied to `staff` because that is the
  // permission the `contact.view` policy grants contact details on.
  permissionGatedOptions: {
    searchPhone: "staff",
    searchSsn: "workers.ssn",
  },

  async search(ctx: QuicksearchContext): Promise<QuicksearchResult[]> {
    const plan = planWorkerSearch(ctx.query, ctx.settings as WorkerSearchSettings);

    const rows = await ctx.storage.readOnly.query(async (client) =>
      buildWorkerSearchQuery(client, plan, ctx.limit),
    );

    if (rows.length === 0) return [];

    // Fetch the detail that EXPLAINS an identifier or phone match, only for
    // the handful of rows being shown.
    const rowIds = rows.map((r) => r.id);
    const idDetails = new Map<string, { value: string; typeName: string | null }>();
    const matchedIdValue = plan.workerIdValue;
    if (matchedIdValue !== null && rows.some((r) => r.matchedWorkerId)) {
      const detailRows = await ctx.storage.readOnly.query(async (client) =>
        client
          .select({
            workerId: workerIds.workerId,
            value: workerIds.value,
            typeName: optionsWorkerIdType.name,
          })
          .from(workerIds)
          .innerJoin(optionsWorkerIdType, eq(workerIds.typeId, optionsWorkerIdType.id))
          .where(
            and(
              inArray(workerIds.workerId, rowIds),
              inArray(workerIds.typeId, plan.workerIdTypeIds),
              eq(workerIds.value, matchedIdValue),
            ),
          ),
      );
      for (const d of detailRows) {
        if (!idDetails.has(d.workerId)) {
          idDetails.set(d.workerId, { value: d.value, typeName: d.typeName });
        }
      }
    }

    const phoneDetails = new Map<string, string>();
    if (plan.phoneDigits !== null && rows.some((r) => r.matchedPhone)) {
      const digits = plan.phoneDigits;
      const detailRows = await ctx.storage.readOnly.query(async (client) =>
        client
          .select({ workerId: workers.id, phoneNumber: phoneNumbers.phoneNumber })
          .from(workers)
          .innerJoin(phoneNumbers, eq(phoneNumbers.contactId, workers.contactId))
          .where(
            and(
              inArray(workers.id, rowIds),
              sql`regexp_replace(${phoneNumbers.phoneNumber}, '[^0-9]', '', 'g') LIKE ${`%${digits}`}`,
            ),
          ),
      );
      for (const d of detailRows) {
        if (!phoneDetails.has(d.workerId)) phoneDetails.set(d.workerId, d.phoneNumber);
      }
    }

    return rows.map((r) => {
      const flags: MatchFlags = {
        matchedName: r.matchedName === true,
        matchedSiriusId: r.matchedSiriusId === true,
        matchedWorkerId: r.matchedWorkerId === true,
        matchedPhone: r.matchedPhone === true,
        matchedSsn: r.matchedSsn === true,
      };
      const detail = idDetails.get(r.id) ?? null;
      const phone = phoneDetails.get(r.id) ?? null;

      const subtitle: string[] = [`#${r.siriusId}`];
      if (flags.matchedWorkerId && detail) {
        subtitle.push(`${detail.typeName ?? "ID"} ${detail.value}`);
      }
      // The phone shows only when it is what matched, and phone matching is
      // itself permission-gated — a result never volunteers contact details
      // that had nothing to do with the query. An SSN match is reported by
      // name only; the number is never part of a result.
      if (flags.matchedPhone && phone) subtitle.push(phone);

      return {
        id: r.id,
        title: r.displayName || `Worker #${r.siriusId}`,
        subtitle: subtitle.join(" · "),
        href: `/workers/${r.id}`,
        matchedOn: describeMatch(flags, detail?.typeName ?? null),
      };
    });
  },
};

registerQuicksearchPlugin(workerQuicksearchPlugin);
