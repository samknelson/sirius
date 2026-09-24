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
