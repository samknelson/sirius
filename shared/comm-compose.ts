/**
 * MANUAL COMPOSE — WHAT A ONE-OFF MESSAGE IS ABOUT.
 *
 * The Communications tabs let an admin write one message to one person.
 * The same four compose screens (email, SMS, postal, in-app) appear in
 * three places, and what differs between them is not the form — it is
 * WHOSE record the message is about:
 *
 *   - a worker's Communications tab      → the worker
 *   - an employer contact's              → the employer-contact link
 *   - a trust provider contact's         → the provider-contact link
 *
 * That record is the SCOPE. It decides which token roots the author may
 * write against, and it is the only thing the client names: the client
 * says "this is a worker compose screen, and here is the worker id",
 * and the server derives everything else (the roots, the addressee, the
 * gating) from that. A client that could name the roots could name a
 * root the page has no record for.
 *
 * The scope list is CLOSED and hardcoded, here, once. Both sides import
 * it, so a screen cannot invent a scope and the server cannot serve one
 * no screen offers.
 */

/** Every compose scope, in no particular order — a set, not a menu. */
export const COMPOSE_SCOPE_NAMES = [
  "worker",
  "employer_contact",
  "provider_contact",
] as const;

export type ComposeScopeName = (typeof COMPOSE_SCOPE_NAMES)[number];

export function isComposeScopeName(value: unknown): value is ComposeScopeName {
  return (
    typeof value === "string" &&
    (COMPOSE_SCOPE_NAMES as readonly string[]).includes(value)
  );
}

/** The media a compose screen offers. Keys of `COMPOSE_CHANNEL_FIELDS`. */
export const COMPOSE_CHANNELS = ["email", "sms", "postal", "inapp"] as const;

export type ComposeChannel = (typeof COMPOSE_CHANNELS)[number];

export function isComposeChannel(value: unknown): value is ComposeChannel {
  return (
    typeof value === "string" &&
    (COMPOSE_CHANNELS as readonly string[]).includes(value)
  );
}

/**
 * WHICH RECORD a compose screen is about: the scope, and the one id the
 * client names within it.
 *
 * For `worker` that id is the WORKER's id — not their contact's. The
 * page is about the worker, the studio's `{{worker…}}` root is seeded
 * with that record, and the contact is derived from it server-side. The
 * two association scopes name their link row for the same reason: the
 * link is what carries the contact type.
 */
export interface ComposeTemplateTarget {
  scope: ComposeScopeName;
  recordId: string;
}

/** What the render endpoint reports back for one composed field. */
export interface ComposeRenderedField {
  /** The finished text, shaped exactly as the send path shapes it. */
  rendered: string;
  /**
   * Tokens that do not exist for this scope. A render carrying any of
   * these must NOT be applied: the finished text would contain the
   * evaluator's "[unknown token: …]" marker, and a marker in a letter
   * is worse than an editor that refuses.
   */
  unknownTokens: string[];
  /** Tokens that resolved to nothing — a hole the author may have meant. */
  emptyValues: string[];
}

export interface ComposeRenderResponse {
  /** Finished text per field key; only the fields a template was sent for. */
  fields: Record<string, ComposeRenderedField>;
  /** The record the render was seeded with, as the server named it. */
  recordLabel: string;
}
