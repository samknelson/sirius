import { registerTokenPlugin } from "../registry";
import { tokenEntityOf } from "../types";
import { formatPhpDate, fmtDateShort } from "../php-date";

export const EVENT_ENVELOPE_KIND = "event";

/** The root name the event envelope is seeded under (`{{event.…}}`). */
export const EVENT_ROOT_NAME = "event";

/**
 * Root: {{event...}} — the ENVELOPE of the fired event, and nothing
 * else. It answers "which event was this, and when did it happen": it
 * has no relations and no record behind it.
 *
 * The records an event is ABOUT are seeded as roots of their own, named
 * for what they are (`{{dispatch.field(name="status")}}`,
 * `{{sitespecific_t631_interview.worker…}}`) — see
 * `server/plugins/tokens/context-roots.ts`. There is deliberately no
 * `event.<record>` spelling: one root, one record.
 *
 * A context root (see `contextRoot`): outside a surface that seeds an
 * event — bulk messaging, ad-hoc fields — `{{event.…}}` is an unknown
 * token.
 */
registerTokenPlugin({
  metadata: {
    id: "token.event",
    name: "Event",
    description:
      "The event that triggered this message: which event it was and when it fired",
    segmentName: "event",
    inputTypes: ["root"],
    outputType: EVENT_ENVELOPE_KIND,
    contextRoot: true,
    // A closed, framework-owned field set — the envelope is not a table
    // row, so there is nothing else to read off it.
    entityFields: ["type"],
    // `{{event}}` on its own means the event's type — the only field the
    // envelope carries, and the phrase a human uses to say WHICH event.
    defaultLeaf: "type",
  },
  async resolve(_entity, _args, ctx) {
    return ctx.roots.event ?? null;
  },
});

/** The date every sample event renders as (static by design). */
const SAMPLE_DATE = new Date(new Date().getFullYear(), 3, 17, 9, 30);

/**
 * {{event.date(which="fired")}} — when the event happened, or
 * {{event.date(which="sent")}} — when this message is being composed.
 * Both accept a PHP-style `format`.
 */
registerTokenPlugin({
  metadata: {
    id: "token.event.date",
    name: "Event date",
    shortLabel: "date",
    description:
      'When the event fired (which="fired") or when the message is sent (which="sent")',
    segmentName: "date",
    inputTypes: [EVENT_ENVELOPE_KIND],
    outputType: "value",
    args: {
      which: {
        default: "fired",
        description: '"fired" (when the event happened) or "sent" (now)',
      },
      format: {
        default: "l, F j, Y",
        description: "PHP-style date format string",
      },
    },
    example: fmtDateShort(SAMPLE_DATE),
  },
  async resolve(entity, args, ctx) {
    const e = tokenEntityOf(entity, EVENT_ENVELOPE_KIND);
    const firedAt = e?.row.firedAt;
    const when =
      args.which === "sent"
        ? ctx.now
        : firedAt instanceof Date
          ? firedAt
          : ctx.now;
    return formatPhpDate(when, args.format ?? "l, F j, Y");
  },
  // Argument-dependent sample: a fixed example would contradict the
  // format the author asked for.
  sampleValue(args) {
    return formatPhpDate(SAMPLE_DATE, args.format ?? "l, F j, Y");
  },
});
