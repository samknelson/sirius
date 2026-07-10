import type { JsonSchema, UiSchema } from "@shared/json-schema-form";
import type { BasePluginMetadata } from "../../_core";
import type { EventType } from "../../../services/event-bus";

/**
 * One event a denorm plugin responds to, plus how to react when it fires.
 *
 * The common case is that the event payload already carries everything the
 * denorm row needs, so the handler can write directly without recomputing.
 * For that case provide `getPayload`: the registry hands its result straight
 * to `write`. When the event only identifies the affected entity (no usable
 * payload), omit `getPayload` and the registry falls back to `compute(entityId)`
 * before writing.
 */
export interface DenormEventHandler<TPayload = unknown> {
  /** The event-bus event this handler subscribes to. */
  event: EventType;
  /** Pull the affected entity's id out of the event payload. */
  getEntityId: (payload: unknown) => string;
  /**
   * Build the denorm payload directly from the event payload. When present,
   * the registry passes the result to `write` without calling `compute`. When
   * omitted, the registry recomputes via `compute(entityId)` first.
   */
  getPayload?: (payload: unknown) => TPayload;
}

/**
 * A denormalization plugin: keeps a precomputed (denormalized) copy of an
 * entity's data in sync. Each plugin TYPE declares the single `entityType` it
 * owns and the events it reacts to, and implements three pieces of behaviour:
 *
 *   - `compute(entityId)`         build the full denorm payload from scratch.
 *   - event response             via `eventHandlers`; the registry subscribes
 *                                each one to the event bus and, when it fires,
 *                                either derives the payload from the event
 *                                (`getPayload`) or recomputes it, then calls
 *                                `write`.
 *   - `write(entityId, payload, denormRowId)` persist the denorm payload for
 *                                the entity. The wrapper has already upserted
 *                                the `denorm` status row (to `ok`) and passes
 *                                its id; the plugin writes only payload rows.
 *
 * Metadata is nested under `.metadata` (matching the cron / charge / trust
 * conventions). A denorm plugin is typically a singleton: exactly one config
 * row exists for it, seeded at boot from the kind adapter's `seedDefault`.
 */
export interface DenormPlugin<TPayload = unknown> {
  /** Base metadata. `id` is the stable identifier keying the config row. */
  metadata: BasePluginMetadata;
  /** The single entity type this plugin denormalizes (e.g. "worker"). */
  entityType: string;
  /** Events this plugin reacts to. Omit / empty for a plugin with no triggers. */
  eventHandlers?: DenormEventHandler<TPayload>[];
  /** Build the denorm payload for an entity from scratch. */
  compute(entityId: string): Promise<TPayload>;
  /**
   * Persist the denorm payload for an entity. Receives the id of the entity's
   * `denorm` status row (already upserted to `ok` by the wrapper) so payload
   * rows can reference it via FK. The plugin writes ONLY payload rows here; the
   * wrapper owns the `denorm` status row.
   */
  write(entityId: string, payload: TPayload, denormRowId: string): Promise<void>;
  /**
   * Optional backfill source. Enumerate up to `limit` entity ids that SHOULD
   * have a denorm row for this plugin's config (`configId`) but currently have
   * none. The registry's `backfillAll` enqueues the returned ids as `stale`.
   *
   * This is a read-only anti-join against the plugin's source domain (e.g. the
   * `workers` table for `worker_ms`); it must not mutate anything. The wrapper
   * supplies the already-resolved `configId` so the plugin does not re-resolve
   * it. Plugins that omit this method do not participate in backfill.
   */
  backfill?(configId: string, limit: number): Promise<string[]>;
  /**
   * Optional widow source — the mirror image of `backfill`. Enumerate up to
   * `limit` entity ids that HAVE a denorm row for this plugin's config
   * (`configId`) but whose underlying entity no longer exists. The wrapper's
   * `backfillAll` deletes the returned ids' denorm rows (and, via the FK
   * cascade, their dependent payload rows).
   *
   * This is a read-only anti-join from the `denorm` table back to the plugin's
   * source domain (e.g. `denorm` LEFT JOIN `workers` for `worker_ms`); it must
   * not mutate anything. The wrapper supplies the already-resolved `configId`.
   * Plugins that omit this method do not participate in widow cleanup.
   */
  findWidows?(configId: string, limit: number): Promise<string[]>;
  /**
   * Optional pre-fire validity check for denorm plugins that schedule EBS
   * (deferred event-bus) events. The generic EBS pump calls this for each due
   * scheduled event IMMEDIATELY before delivering it, passing the event's
   * `uniqueId`. Return `false` when the underlying subject is no longer a valid
   * reason to fire (e.g. the absence was ended/deleted, or the worker was
   * removed): the pump then marks the event terminal (`expired`) without
   * delivering it.
   *
   * This is the correctness guarantee that a due reminder does NOT fire after
   * its subject changed, independent of when the hourly `findWidows` cleanup
   * happens to run — it queries LIVE domain state, not the (possibly not-yet
   * cleaned) `ebs_denorm` row. It must be read-only. Plugins that do not
   * schedule EBS events omit this method (the pump then delivers unconditionally
   * once due, as before).
   */
  isScheduledEventLive?(uniqueId: string): Promise<boolean>;
  /**
   * JSON Schema describing the editable `data` fields the generic plugin admin
   * UI renders for this plugin's config row. Omit for plugins with no editable
   * settings (their Edit modal shows only name / enabled). Surfaced through the
   * denorm manifest entry so the shared RJSF form (mirroring cron) can render
   * them.
   */
  configSchema?: JsonSchema;
  /** Optional RJSF UI hints paired with {@link configSchema}. */
  uiSchema?: UiSchema;
}

/**
 * Manifest entry shape for denorm plugins. Extends the base metadata with the
 * `entityType` so the generic admin manifest can surface which entity each
 * denorm plugin owns.
 */
export interface DenormManifestEntry extends BasePluginMetadata {
  entityType: string;
  /** Per-plugin settings form schema (mirrors cron / event-notifier). */
  configSchema?: JsonSchema;
  /** Optional RJSF UI hints paired with {@link configSchema}. */
  uiSchema?: UiSchema;
}
