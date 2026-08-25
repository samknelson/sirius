import { z } from "zod";
import { storage } from "../../../storage";
import { buildPassportExportEnvelope } from "../../../modules/webservices/edls-passport-export-mapper";
import { registerWebServicePlugin } from "../registry";
import type { WebServiceOperationContext } from "../types";

/**
 * Page size used when the filter does not name one, matching the legacy
 * service.
 */
const DEFAULT_EXPORT_LIMIT = 100;

/** Hard ceiling on the page size, whatever the caller asks for. */
const MAX_EXPORT_LIMIT = 500;

/**
 * The legacy Sirius positional-argument body the Freeman client posts:
 * `[<operation>, <ignored>, <ignored>, <JSON-encoded filter>]`.
 *
 * The operation name in element 0 is NO LONGER VALIDATED. The path now names
 * the operation (`/api/ws/<configuration>/v1_sheet_export`) and the dispatcher
 * refuses anything the plugin does not declare, so re-checking a second copy
 * of the name inside the body can only ever produce a disagreement between the
 * two — the request would be routed by one and rejected by the other. Elements
 * 0 through 2 are therefore accepted and ignored, exactly as elements 1 and 2
 * always were. The body SHAPE is still enforced (four strings) so the existing
 * client's request continues to be accepted unchanged.
 */
const genericBodySchema = z.tuple([z.string(), z.string(), z.string(), z.string()]);

/** Every supported filter value arrives as a string, legacy-style. */
const passportExportFilterSchema = z.object({
  start_date: z.string().optional(),
  page: z.string().optional(),
  limit: z.string().optional(),
});

/** Parse a legacy string-valued integer; null when it is not one. */
function parseNonNegativeInt(value: string | undefined, fallback: number): number | null {
  if (value === undefined || value.trim() === '') return fallback;
  if (!/^\d+$/.test(value.trim())) return null;
  return Number(value.trim());
}

async function runPassportExport({ req, res }: WebServiceOperationContext): Promise<void> {
  const bodyResult = genericBodySchema.safeParse(req.body);
  if (!bodyResult.success) {
    res.status(400).json({
      error: 'Invalid request body: expected a JSON array of four strings',
      code: 'INVALID_BODY',
    });
    return;
  }

  // Elements 0, 1 and 2 are legacy identifiers and are ignored entirely; see
  // `genericBodySchema` above.
  const [, , , filterJson] = bodyResult.data;

  let filterRaw: unknown;
  try {
    filterRaw = JSON.parse(filterJson);
  } catch {
    res.status(400).json({
      error: 'Invalid filter: element 4 must be a JSON-encoded object',
      code: 'INVALID_FILTER',
    });
    return;
  }

  const filterResult = passportExportFilterSchema.safeParse(filterRaw);
  if (!filterResult.success) {
    res.status(400).json({
      error: 'Invalid filter: start_date, page and limit must be strings',
      code: 'INVALID_FILTER',
      details: filterResult.error.issues.map(i => ({
        field: i.path.join('.'),
        message: i.message,
      })),
    });
    return;
  }

  const filter = filterResult.data;

  let changedSince: Date | null = null;
  if (filter.start_date !== undefined && filter.start_date.trim() !== '') {
    const parsed = new Date(filter.start_date.trim());
    if (Number.isNaN(parsed.getTime())) {
      res.status(400).json({
        error: `Invalid start_date '${filter.start_date}'`,
        code: 'INVALID_START_DATE',
      });
      return;
    }
    changedSince = parsed;
  }

  const page = parseNonNegativeInt(filter.page, 0);
  if (page === null) {
    res.status(400).json({
      error: `Invalid page '${filter.page}': expected a non-negative integer`,
      code: 'INVALID_PAGE',
    });
    return;
  }

  const requestedLimit = parseNonNegativeInt(filter.limit, DEFAULT_EXPORT_LIMIT);
  if (requestedLimit === null || requestedLimit === 0) {
    res.status(400).json({
      error: `Invalid limit '${filter.limit}': expected a positive integer`,
      code: 'INVALID_LIMIT',
    });
    return;
  }
  const limit = Math.min(requestedLimit, MAX_EXPORT_LIMIT);

  try {
    const result = await storage.edlsSheets.getPassportExportPage({ changedSince, page, limit });
    res.json(buildPassportExportEnvelope(result, { page, limit }));
  } catch {
    res.status(500).json({
      error: 'Failed to build passport export',
      code: 'EXPORT_ERROR',
    });
  }
}

/**
 * EDLS Sheet Export v1 — the legacy Freeman passport export, exposed as a web
 * service operation. The request body and response envelope are unchanged from
 * the endpoint this replaced; only the address moved.
 */
registerWebServicePlugin({
  id: "edls-sheet-export-v1",
  name: "Sheet Export v1",
  description:
    "Legacy EDLS passport export: paginated sheet assignments in the Freeman v1 envelope.",
  requiredComponent: "edls",
  order: 10,
  operations: [
    {
      name: "v1_sheet_export",
      methods: ["POST"],
      description:
        "Passport export. POST the legacy positional body " +
        "[operation, ignored, ignored, JSON filter] where the filter may carry " +
        "start_date, page and limit as strings.",
      // The legacy shape is the contract, quirks and all: a four-string array
      // whose last element is itself JSON, a string-valued total_records, and
      // a double-wrapped payload. Documented as it IS, not as it should be.
      requestSchema: {
        type: "array",
        title: "Legacy positional arguments",
        description:
          "Four strings. Elements 1-3 are legacy identifiers and are ignored; element 4 is a JSON-encoded filter object.",
        minItems: 4,
        maxItems: 4,
        items: [
          { type: "string", description: "Legacy operation name. Accepted and ignored — the URL names the operation." },
          { type: "string", description: "Legacy identifier. Accepted and ignored." },
          { type: "string", description: "Legacy identifier. Accepted and ignored." },
          {
            type: "string",
            description:
              'JSON-encoded filter object. Every value is a string. Supported keys: start_date (any parseable date; only sheets changed since then), page (zero-based, default "0"), limit (default "100", capped at 500). Example: {"start_date":"2026-01-01","page":"0","limit":"100"}',
          },
        ],
      },
      responseSchema: {
        type: "object",
        title: "Legacy passport export envelope",
        required: ["success", "ts", "is_remote", "data"],
        properties: {
          success: { type: "boolean", const: true },
          ts: { type: "integer", description: "Unix timestamp, in seconds, of this response." },
          is_remote: { type: "boolean", const: true },
          data: {
            type: "object",
            description: "Legacy double wrapper: the payload sits at data.data.",
            required: ["success", "data"],
            properties: {
              success: { type: "boolean", const: true },
              data: {
                type: "object",
                required: ["paging", "sheets"],
                properties: {
                  paging: {
                    type: "object",
                    required: ["total_records", "page", "limit", "offset"],
                    properties: {
                      total_records: {
                        type: "string",
                        description: "Total matching sheets, as a STRING — a legacy quirk.",
                      },
                      page: { type: "integer", description: "Zero-based page number echoed back." },
                      limit: { type: "integer", description: "Page size actually applied, capped at 500." },
                      offset: { type: "integer" },
                    },
                  },
                  sheets: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        uuid: { type: "string" },
                        nid: { type: "string", description: "Same value as uuid." },
                        title: { type: "string" },
                        version: {
                          type: "string",
                          description:
                            "'<sheet id>::<latest snapshot id>'; the second half is empty when the sheet has never been snapshotted.",
                        },
                        status: { type: "string", const: "Scheduled", description: "Only locked sheets are exported." },
                        employer: { type: ["string", "null"] },
                        supervisor: { type: ["string", "null"] },
                        creator: { type: ["string", "null"] },
                        changed_date: { type: "string", description: "RFC-2822 style, in the server's local zone." },
                        date: { type: "string", description: "Long form, e.g. 'Tuesday, May 19, 2026'." },
                        event: { type: ["string", "null"] },
                        event_status: { type: ["string", "null"] },
                        dept: { type: ["string", "null"] },
                        job_number: { type: "string" },
                        facility: { type: ["string", "null"] },
                        hall: { type: "null", description: "Always null." },
                        count: { type: "string", description: "'<assigned> / <planned>'." },
                        notes: { type: "string" },
                        crews: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              uuid: { type: "string" },
                              name: { type: "string" },
                              task: { type: "string" },
                              start_time: { type: ["string", "null"], description: "HH:MM." },
                              end_time: { type: ["string", "null"], description: "HH:MM." },
                              checkin_location: { type: ["string", "null"] },
                              count: { type: "integer", description: "Planned worker count." },
                              crewlead: { type: "string" },
                              supervisor: { type: ["string", "null"] },
                              assignments: {
                                type: "array",
                                items: {
                                  type: "object",
                                  properties: {
                                    worker_name: { type: "string", description: "'Family, Given'." },
                                    worker_ms: { type: ["string", "null"], description: "Member status code." },
                                    worker_id: { type: ["integer", "null"] },
                                    worker_empid: { type: ["string", "null"] },
                                    assignment_extra: {
                                      type: "object",
                                      properties: {
                                        time: { type: ["string", "null"] },
                                        classification: { type: ["string", "null"] },
                                        note: { type: ["string", "null"] },
                                      },
                                    },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          minilog: { type: "string", description: "Always empty." },
          drupal_messages: { type: "array", description: "Always empty." },
        },
      },
      handler: runPassportExport,
    },
  ],
});
