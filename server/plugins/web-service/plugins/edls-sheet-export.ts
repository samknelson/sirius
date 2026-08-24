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
      handler: runPassportExport,
    },
  ],
});
