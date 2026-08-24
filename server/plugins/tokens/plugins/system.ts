import { registerTokenPlugin } from "../registry";
import { tokenEntityOf } from "../types";
import { formatPhpDate, fmtDateShort } from "../php-date";

function nowOf(entity: unknown, fallback: Date): Date {
  const e = tokenEntityOf(entity, "system");
  return e?.row.now instanceof Date ? e.row.now : fallback;
}

/**
 * The one date the picker's example column shows for a system date.
 * Sample data is static metadata by design (never randomized — two
 * renders of the same catalog must agree), pinned to the current year so
 * it stays consistent with what {{system.year}} shows. A PREVIEW does not
 * use these: the system root is `seedless`, so it renders the real
 * current date there.
 */
const SAMPLE_DATE = new Date(new Date().getFullYear(), 3, 17, 9, 30);

/**
 * Root NAME of the system values. It is SEEDLESS — there is no record to
 * pick — but it is still a root a surface must name if its authors may
 * write `{{system.…}}`, so it belongs in the declared list like any
 * other.
 */
export const SYSTEM_ROOT_NAME = "system";

/** Root: {{system...}} — server-side values independent of the recipient. */
registerTokenPlugin({
  metadata: {
    id: "token.system",
    name: "System",
    description: "System values (dates, year) independent of the recipient",
    segmentName: SYSTEM_ROOT_NAME,
    inputTypes: ["root"],
    outputType: "system",
    // Nothing to pick for this root, and nothing personal behind it (see
    // `seedless`): every preview — all-sample ones included — renders the
    // deployment's real origin and the real current date, so the author
    // can click the link and check the date format they wrote.
    seedless: true,
  },
  async resolve(_entity, _args, ctx) {
    return { kind: "system", row: { now: ctx.now } };
  },
});

registerTokenPlugin({
  metadata: {
    id: "token.leaf.year",
    name: "Current year",
    shortLabel: "current year",
    description: "Four-digit current year",
    segmentName: "year",
    inputTypes: ["system"],
    outputType: "value",
    defaultValue: String(new Date().getFullYear()),
    example: String(new Date().getFullYear()),
  },
  async resolve(entity, _args, ctx) {
    return String(nowOf(entity, ctx.now).getFullYear());
  },
});

/**
 * {{system.base_url}} — the absolute origin (https://…) for links that
 * leave the app. Always returns the deployment's absolute site origin,
 * regardless of delivery medium. In-app notifier templates that need
 * relative paths should use a plain relative path in their linkUrl
 * slot instead of this token.
 */
registerTokenPlugin({
  metadata: {
    id: "token.leaf.baseUrl",
    name: "Base URL",
    shortLabel: "base URL",
    description: "Absolute site origin for use in links",
    segmentName: "base_url",
    inputTypes: ["system"],
    outputType: "value",
    defaultValue: "",
    example: "https://example.com",
  },
  async resolve(_entity, _args, _ctx) {
    const { absoluteBaseUrl } = await import("../../../lib/base-url");
    return absoluteBaseUrl();
  },
});

registerTokenPlugin({
  metadata: {
    id: "token.leaf.dateToday",
    name: "Today's date",
    shortLabel: "today's date",
    description: "Today's date, e.g. Apr 17, 2026",
    segmentName: "dateToday",
    inputTypes: ["system"],
    outputType: "value",
    example: fmtDateShort(SAMPLE_DATE),
  },
  async resolve(entity, _args, ctx) {
    return fmtDateShort(nowOf(entity, ctx.now));
  },
});

registerTokenPlugin({
  metadata: {
    id: "token.leaf.date",
    name: "Formatted date",
    shortLabel: "date (custom format)",
    description:
      'Today\'s date with a custom PHP-style format, e.g. date(format="Y-m-d")',
    segmentName: "date",
    inputTypes: ["system"],
    outputType: "value",
    args: {
      format: {
        default: "l, F j, Y",
        description: "PHP-style date format string",
      },
    },
    example: formatPhpDate(SAMPLE_DATE, "l, F j, Y"),
  },
  async resolve(entity, args, ctx) {
    return formatPhpDate(nowOf(entity, ctx.now), args.format ?? "l, F j, Y");
  },
  // Argument-dependent sample: a fixed `example` would contradict the
  // format the author actually asked for (a Y-m-d token previewing as
  // "Friday, April 17, 2026" is worse than no preview at all).
  sampleValue(args) {
    return formatPhpDate(SAMPLE_DATE, args.format ?? "l, F j, Y");
  },
});
