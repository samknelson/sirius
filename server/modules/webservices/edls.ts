import { Router } from 'express';
import { z } from 'zod';
import { storage } from '../../storage';
import { logger } from '../../logger';
import { getWebServiceContext } from '../../middleware/webservice-auth';

const sheetsQuerySchema = z.object({
  status: z.enum(['draft', 'active', 'closed', 'cancelled']).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format').optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format').optional(),
  employerId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export function setupEdlsRoutes(router: Router): void {
  router.get('/sheets', async (req, res) => {
    const context = getWebServiceContext();
    
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

      logger.info('EDLS sheets query executed via web service', {
        clientId: context?.clientId,
        clientName: context?.clientName,
        filters: { status, dateFrom, dateTo, employerId },
        resultCount: result.data.length,
        totalCount: result.total,
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
      logger.error('EDLS sheets query failed', {
        error,
        clientId: context?.clientId,
        path: req.path,
      });
      return res.status(500).json({
        error: 'Failed to query sheets',
        code: 'QUERY_ERROR',
      });
    }
  });

  router.get('/sheets/:id', async (req, res) => {
    const context = getWebServiceContext();
    const { id } = req.params;

    try {
      const sheet = await storage.edlsSheets.getWithRelations(id);

      if (!sheet) {
        return res.status(404).json({
          error: 'Sheet not found',
          code: 'NOT_FOUND',
        });
      }

      logger.info('EDLS sheet retrieved via web service', {
        clientId: context?.clientId,
        clientName: context?.clientName,
        sheetId: id,
      });

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
      logger.error('EDLS sheet get failed', {
        error,
        clientId: context?.clientId,
        sheetId: id,
      });
      return res.status(500).json({
        error: 'Failed to get sheet',
        code: 'GET_ERROR',
      });
    }
  });
}

export const EDLS_BUNDLE_CODE = 'edls';
