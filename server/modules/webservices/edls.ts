import { Router } from 'express';
import { z } from 'zod';
import { storage } from '../../storage';
import { buildPassportExportEnvelope } from './edls-passport-export-mapper';

/**
 * The only operation the legacy generic endpoint accepts. The Freeman client
 * posts the legacy Sirius positional-argument body:
 * `[<operation>, <ignored>, <ignored>, <JSON-encoded filter>]`.
 */
const PASSPORT_EXPORT_OPERATION = 'sirius_freeman_edls_passport_export';

/** Page size used when the filter does not name one, matching the legacy service. */
const DEFAULT_EXPORT_LIMIT = 100;

/** Hard ceiling on the page size, whatever the caller asks for. */
const MAX_EXPORT_LIMIT = 500;

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

const sheetsQuerySchema = z.object({
  status: z.enum(['draft', 'active', 'closed', 'cancelled']).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format').optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format').optional(),
  employerId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export function setupEdlsRoutes(router: Router): void {
  /**
   * Legacy Freeman passport export. Mounted under the bundle's base path so
   * it resolves at `/api/ws/edls/generic.json` and inherits the bundle's
   * credential auth and request logging.
   */
  router.post('/generic.json', async (req, res) => {
    const bodyResult = genericBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      return res.status(400).json({
        error: 'Invalid request body: expected a JSON array of four strings',
        code: 'INVALID_BODY',
      });
    }

    // Elements 1 and 2 are legacy identifiers and are ignored entirely.
    const [operation, , , filterJson] = bodyResult.data;

    if (operation !== PASSPORT_EXPORT_OPERATION) {
      return res.status(400).json({
        error: `Unsupported operation '${operation}'. Only '${PASSPORT_EXPORT_OPERATION}' is supported.`,
        code: 'UNKNOWN_OPERATION',
      });
    }

    let filterRaw: unknown;
    try {
      filterRaw = JSON.parse(filterJson);
    } catch {
      return res.status(400).json({
        error: 'Invalid filter: element 4 must be a JSON-encoded object',
        code: 'INVALID_FILTER',
      });
    }

    const filterResult = passportExportFilterSchema.safeParse(filterRaw);
    if (!filterResult.success) {
      return res.status(400).json({
        error: 'Invalid filter: start_date, page and limit must be strings',
        code: 'INVALID_FILTER',
        details: filterResult.error.issues.map(i => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      });
    }

    const filter = filterResult.data;

    let changedSince: Date | null = null;
    if (filter.start_date !== undefined && filter.start_date.trim() !== '') {
      const parsed = new Date(filter.start_date.trim());
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({
          error: `Invalid start_date '${filter.start_date}'`,
          code: 'INVALID_START_DATE',
        });
      }
      changedSince = parsed;
    }

    const page = parseNonNegativeInt(filter.page, 0);
    if (page === null) {
      return res.status(400).json({
        error: `Invalid page '${filter.page}': expected a non-negative integer`,
        code: 'INVALID_PAGE',
      });
    }

    const requestedLimit = parseNonNegativeInt(filter.limit, DEFAULT_EXPORT_LIMIT);
    if (requestedLimit === null || requestedLimit === 0) {
      return res.status(400).json({
        error: `Invalid limit '${filter.limit}': expected a positive integer`,
        code: 'INVALID_LIMIT',
      });
    }
    const limit = Math.min(requestedLimit, MAX_EXPORT_LIMIT);

    try {
      const result = await storage.edlsSheets.getPassportExportPage({ changedSince, page, limit });
      return res.json(buildPassportExportEnvelope(result, { page, limit }));
    } catch (error) {
      return res.status(500).json({
        error: 'Failed to build passport export',
        code: 'EXPORT_ERROR',
      });
    }
  });

  router.get('/sheets', async (req, res) => {
    try {
      const parseResult = sheetsQuerySchema.safeParse(req.query);
      
      if (!parseResult.success) {
        return res.status(400).json({
          error: 'Invalid query parameters',
          details: parseResult.error.issues.map(i => ({
            field: i.path.join('.'),
            message: i.message,
          })),
        });
      }

      const { page, limit, status, dateFrom, dateTo, employerId } = parseResult.data;

      const result = await storage.edlsSheets.getPaginated(page, limit, {
        status,
        dateFrom,
        dateTo,
        employerId,
      });

      return res.json({
        data: result.data.map(sheet => ({
          id: sheet.id,
          ymd: sheet.ymd,
          status: sheet.status,
          workerCount: sheet.workerCount,
          employer: sheet.employer ? {
            id: sheet.employer.id,
            name: sheet.employer.name,
          } : null,
          department: sheet.department ? {
            id: sheet.department.id,
            name: sheet.department.name,
          } : null,
          supervisor: sheet.supervisorUser ? {
            id: sheet.supervisorUser.id,
            name: [sheet.supervisorUser.firstName, sheet.supervisorUser.lastName].filter(Boolean).join(' ') || sheet.supervisorUser.email,
          } : null,
          assignee: sheet.assigneeUser ? {
            id: sheet.assigneeUser.id,
            name: [sheet.assigneeUser.firstName, sheet.assigneeUser.lastName].filter(Boolean).join(' ') || sheet.assigneeUser.email,
          } : null,
          assignedCount: sheet.assignedCount ?? 0,
        })),
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: Math.ceil(result.total / result.limit),
        },
      });
    } catch (error) {
      return res.status(500).json({
        error: 'Failed to query sheets',
        code: 'QUERY_ERROR',
      });
    }
  });

  router.get('/sheets/:id', async (req, res) => {
    const { id } = req.params;

    try {
      const sheet = await storage.edlsSheets.getWithRelations(id);

      if (!sheet) {
        return res.status(404).json({
          error: 'Sheet not found',
          code: 'NOT_FOUND',
        });
      }

      return res.json({
        id: sheet.id,
        ymd: sheet.ymd,
        status: sheet.status,
        workerCount: sheet.workerCount,
        employer: sheet.employer ? {
          id: sheet.employer.id,
          name: sheet.employer.name,
        } : null,
        department: sheet.department ? {
          id: sheet.department.id,
          name: sheet.department.name,
        } : null,
        supervisor: sheet.supervisorUser ? {
          id: sheet.supervisorUser.id,
          name: [sheet.supervisorUser.firstName, sheet.supervisorUser.lastName].filter(Boolean).join(' ') || sheet.supervisorUser.email,
        } : null,
        assignee: sheet.assigneeUser ? {
          id: sheet.assigneeUser.id,
          name: [sheet.assigneeUser.firstName, sheet.assigneeUser.lastName].filter(Boolean).join(' ') || sheet.assigneeUser.email,
        } : null,
        assignedCount: sheet.assignedCount ?? 0,
      });
    } catch (error) {
      return res.status(500).json({
        error: 'Failed to get sheet',
        code: 'GET_ERROR',
      });
    }
  });
}

export const EDLS_BUNDLE_CODE = 'edls';
