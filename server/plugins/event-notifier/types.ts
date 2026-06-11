import type { JsonSchema, UiSchema } from "@shared/json-schema-form";

/**
 * Editable per-row settings stored in `plugin_configs.data` for an
 * event-notifier config. The shape is intentionally open for now: this kind
 * is scaffolding only (Task #457). The eventual config (which event to
 * subscribe to, which comm channel/recipients to send through) will be
 * formalized when the event-subscription + send "wrapper" is built.
 */
export interface EventNotifierData {
  [key: string]: unknown;
}

/**
 * Context handed to a notifier when it eventually runs. Deliberately empty
 * for now — the event-bus wiring and the comm send "wrapper" are future work
 * (see Task #457 "Out of scope"). It exists so the placeholder `notify`
 * signature has a stable extension point.
 */
export interface EventNotifierContext {
  // future: resolved config row, storage handle, the event payload, etc.
}

/**
 * An event-notifier plugin. Its eventual job is to listen for an event on the
 * server event bus and fan it out to the comm send functions (`sendEmail`,
 * `sendPostal`, `sendSms`, `sendInapp`).
 *
 * For now this is scaffolding only: the kind registers, exposes a manifest,
 * and is configurable through the generic admin page. The `notify` method is
 * a documented placeholder — nothing subscribes to the event bus or calls it
 * yet.
 */
export interface EventNotifierPlugin {
  id: string;
  name: string;
  description?: string;
  requiredComponent?: string;
  requiredPolicy?: string;
  hidden?: boolean;
  /** Ordering hint mirrored onto manifest entries (ascending). */
  order?: number;
  /**
   * JSON Schema describing the editable `data` fields the generic admin UI
   * renders for a config row of this notifier. Omit for notifiers with no
   * editable settings.
   */
  configSchema?: JsonSchema;
  /** Optional RJSF UI hints paired with {@link configSchema}. */
  uiSchema?: UiSchema;
  /**
   * Placeholder for the future event-handling method. NOT yet wired to the
   * event bus and never invoked today. When the subscription + send wrapper
   * lands, this will receive the event payload and perform the sends.
   */
  notify?: (
    payload: unknown,
    ctx: EventNotifierContext,
  ) => Promise<void> | void;
}

export interface EventNotifierManifestEntry {
  id: string;
  name: string;
  description?: string;
  order: number;
  requiredComponent?: string;
  /** Attached by the kind's `decorateEntries` for the generic admin UI. */
  enabled?: boolean;
  configSchema?: JsonSchema;
  uiSchema?: UiSchema;
}
