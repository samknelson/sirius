/**
 * Shared machinery for the trust-provider EDI suites: reaching the registered
 * plugins, and reading a record through the expected layout of record rather
 * than through the encoder that produced it.
 *
 * Everything here computes offsets and padding from a `LegacyLayout` fixture,
 * independently of `server/plugins/trust/provider-edi/base.ts`. That is the
 * point: a test that measured a record with the encoder's own helpers would
 * agree with any bug the encoder has.
 */
import {
  trustProviderEdiPluginRegistry,
  type TrustProviderEdiContext,
  type TrustProviderEdiPlugin,
} from "../../../server/plugins/trust/provider-edi";
import type { LegacyLayout } from "./legacy-layouts";

/**
 * Script only the read results, not buildMemberUnits or the provider mappers.
 * The real shared assembly and serializers run against mixed-case contacts.
 * No write API is offered, and unexpected/missing reads fail the fixture.
 *
 * `db.execute()` consumes the next scripted result as well. The one raw
 * statement on this path is the segment-start read, which returns ONE
 * aggregated row per anchor record: script those with `segmentStartRow`.
 */
export function ediReadFixture(results: readonly (readonly unknown[])[]): {
  ctx: TrustProviderEdiContext;
  assertReadsConsumed(): void;
  readLimits: (number | undefined)[];
} {
  let next = 0;
  const readLimits: (number | undefined)[] = [];
  const db = {
    select() {
      if (next >= results.length) throw new Error("Unexpected EDI fixture read");
      const rows = results[next++];
      const index = readLimits.push(undefined) - 1;
      const chain = {
        from: () => chain,
        where: () => chain,
        innerJoin: () => chain,
        leftJoin: () => chain,
        orderBy: () => chain,
        limit: (limit: number) => { readLimits[index] = limit; return chain; },
        then: (resolve: (value: readonly unknown[]) => unknown) =>
          Promise.resolve(rows).then(resolve),
      };
      return chain;
    },
    async execute() {
      if (next >= results.length) throw new Error("Unexpected EDI fixture read");
      return { rows: results[next++] };
    },
  };
  const ctx = {
    configId: "fixture-config",
    configData: {},
    providerId: null,
    sftpClientId: null,
    input: { asOfDate: "2026-10-01" },
    storage: { readOnly: { query: (read: (db: unknown) => unknown) => read(db) } },
  } as unknown as TrustProviderEdiContext;
  return {
    ctx,
    readLimits,
    assertReadsConsumed() {
      if (next !== results.length) throw new Error(`EDI fixture used ${next}/${results.length} reads`);
    },
  };
}

/**
 * What the database answers for one anchor coverage record: the `restart`
 * event month, how many months of the run are covered, and the latest month
 * in the run without a record of the anchor's own class.
 */
export function segmentStartRow(
  anchor: { id: string; workerId: string; benefitId: string; year: number; month: number },
  run: {
    cobra?: boolean;
    /** Calendar month (same year as the anchor) of the `restart` event; null = no event. */
    restart: number | null;
    /** Latest month of the run with no record of the anchor's class. */
    lastBreak?: number;
    /** Covered months found in the run, when that is not every month. */
    covered?: number;
    /** Conflicting months inside the segment before the anchor month, and the records they hold. */
    conflictMonths?: number;
    conflictRecords?: number;
  },
): Record<string, unknown> {
  const index = (month: number) => anchor.year * 12 + month - 1;
  const restart = run.restart == null ? null : index(run.restart);
  return {
    id: anchor.id, worker_id: anchor.workerId, benefit_id: anchor.benefitId, cobra: run.cobra ?? false,
    anchor_idx: index(anchor.month), restart_idx: restart,
    last_break: run.lastBreak == null ? null : index(run.lastBreak),
    covered: restart == null ? null : run.covered ?? index(anchor.month) - restart + 1,
    first_idx: restart,
    conflict_months: run.conflictMonths ?? 0,
    conflict_records: run.conflictRecords ?? (run.conflictMonths ?? 0) * 2,
  };
}

/**
 * Every registered EDI plugin, ignoring component gating — a plugin behind a
 * disabled component still produces files elsewhere and still has to conform.
 */
export function registeredEdiPlugins(): TrustProviderEdiPlugin[] {
  return trustProviderEdiPluginRegistry.list();
}

export function requireEdiPlugin(id: string): TrustProviderEdiPlugin {
  const plugin = trustProviderEdiPluginRegistry.get(id);
  if (!plugin) throw new Error(`Trust-provider EDI plugin '${id}' is not registered.`);
  return plugin;
}

/**
 * Row encoder for one plugin. Layout and encoding read nothing off the
 * context, so the golden suites hand it an empty one.
 */
export function encoderFor(
  plugin: TrustProviderEdiPlugin,
): (row: Record<string, unknown>) => string {
  const ctx = {} as TrustProviderEdiContext;
  return (row) => plugin.encodeRow(row, ctx);
}

export interface FieldSpan {
  name: string;
  width: number;
  /** Byte offset of the field's first character within a record. */
  start: number;
}

/** Field spans in output order, offsets accumulated from the fixture widths. */
export function fieldSpans(layout: LegacyLayout): FieldSpan[] {
  let start = 0;
  return layout.fields.map(([name, width]) => {
    const span = { name, width, start };
    start += width;
    return span;
  });
}

/** The bytes the expected layout assigns to `name`. */
export function sliceField(record: string, layout: LegacyLayout, name: string): string {
  const span = fieldSpans(layout).find((f) => f.name === name);
  if (!span) throw new Error(`No field '${name}' in the expected layout.`);
  return record.slice(span.start, span.start + span.width);
}

/**
 * Independent re-implementation of the fixed-width cell rule: truncate to the
 * width, then pad — spaces on the right for a left-aligned field, zeros on the
 * left for a right-aligned (numeric) one.
 */
export function padCell(
  value: string,
  width: number,
  align: "left" | "right" = "left",
): string {
  const truncated = value.slice(0, width);
  return align === "right"
    ? "0".repeat(Math.max(0, width - truncated.length)) + truncated
    : truncated + " ".repeat(Math.max(0, width - truncated.length));
}

/**
 * A row that answers every field's `get` with the same value, so a provider's
 * field table can be exercised without knowing which row keys it reads.
 */
export function uniformRow(value: unknown): Record<string, unknown> {
  return new Proxy(
    {},
    { get: (_target, prop) => (typeof prop === "string" ? value : undefined) },
  ) as Record<string, unknown>;
}
