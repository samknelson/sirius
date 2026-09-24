import { Router, type Express, type RequestHandler } from 'express';
import {
  requireWebServiceAuth,
  type WebServiceContext,
} from '../../middleware/webservice-auth';
import { logger, logWsRequest } from '../../logger';
import { storage } from '../../storage';
import { runOutsideTransaction } from '../../storage/transaction-context';
import { getTodayYmd } from '@shared/utils/date';
import { isPluginComponentEnabledAsync } from '../../plugins/_core';
import { webServiceRegistry, findWebServiceOperation } from '../../plugins/web-service';
import type { PluginConfig } from '@shared/schema';

export { WEB_SERVICE_BASE_PATH } from './base-path';
import { WEB_SERVICE_BASE_PATH } from './base-path';
// Resolution lives beside its inverse (the address the API document
// publishes), so the two can never drift apart.
import { resolveConfiguration } from './addressing';
import { assertMaintenanceGateInstalled } from './maintenance';

/**
 * The single refusal returned for every reason a caller may not reach a
 * configuration: it does not exist, its alias is ambiguous, the client holds
 * no grant for it, it is disabled, or its plugin's component is off. They are
 * deliberately indistinguishable — an outsider probing the URL space must not
 * be able to tell an unknown service from one they simply aren't allowed to
 * call.
 */
const REFUSAL = {
  error: 'Not Found',
  code: 'NOT_FOUND',
} as const;

/** Internal reason for a refusal — logged, never returned to the caller. */
type RefusalReason =
  | 'UNKNOWN_CONFIG'
  | 'AMBIGUOUS_ALIAS'
  | 'NOT_GRANTED'
  | 'CONFIG_DISABLED'
  | 'PLUGIN_UNREGISTERED'
  | 'COMPONENT_DISABLED';

/**
 * Count one served call, if this request actually reached a service handler.
 *
 * The flag is set immediately before the handler is called, so what is counted
 * is "a call reached the service", whatever the handler then did with it — an
 * error it raised is work we did, and its outcome is the request log's
 * business, not the counter's. Every refusal above the handler counts nothing,
 * because none of them did any work.
 *
 * Off the caller's transaction, deliberately, and for the same two reasons as
 * the outbound counter: on the caller's client a failed upsert would abort the
 * caller's transaction and turn a best-effort statistic into a fatal error,
 * and a handler that later rolled back would discard the record of a call that
 * really happened. Failures are logged and swallowed — this runs after the
 * response is gone, so there is nothing left to fail.
 */
function countServedCall(res: Parameters<RequestHandler>[1]): void {
  if (res.locals.wsHandled !== true) return;
  const context = res.locals.wsContext as WebServiceContext | undefined;
  if (!context?.pluginId || !context.operation) return;

  const { pluginId, clientId, operation } = context;
  void (async () => {
    try {
      await runOutsideTransaction(() =>
        storage.wsStats.recordCall(pluginId, clientId, operation, getTodayYmd()),
      );
    } catch (error) {
      logger.error('Failed to count an incoming web service call', {
        service: 'webservices',
        pluginId,
        clientId,
        wsOperation: operation,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();
}

// Middleware that logs WS requests after they complete, and counts the ones
// that reached a service handler.
function createWsLoggingMiddleware(): RequestHandler {
  return (req, res, next) => {
    // Counting hangs off 'close' rather than 'finish', and the difference is
    // deliberate: 'finish' means we sent the whole response, 'close' means the
    // exchange is over either way. A partner who hangs up halfway through a
    // long export still made us do that export, so it is a call we served;
    // logging keeps 'finish' because a response nobody received has no status
    // worth recording. 'close' fires exactly once in both cases.
    res.on('close', () => countServedCall(res));

    // Log when response finishes
    res.on('finish', () => {
      const context = res.locals.wsContext as WebServiceContext | undefined;
      const startTime = res.locals.wsStartTime as number | undefined;

      // Only log if we have context (authenticated requests)
      // Auth failures are logged by the auth middleware itself
      if (context && startTime) {
        const duration = Date.now() - startTime;

        logWsRequest({
          clientId: context.clientId,
          clientName: context.clientName,
          credentialId: context.credentialId,
          configId: context.configId ?? null,
          configAlias: context.configAlias ?? null,
          pluginId: context.pluginId ?? null,
          wsOperation: context.operation ?? null,
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          duration,
          ipAddress: context.ipAddress,
          errorCode: (res.locals.wsErrorCode as string | undefined) ?? null,
        });
      }
    });

    next();
  };
}

/**
 * The one dispatcher for every web service. Per request it authenticates the
 * credential, resolves the configuration once, and reuses that same resolved
 * record for the grant check, the enabled checks and the handler call.
 */
export function registerWebServiceDispatcher(app: Express): void {
  // Maintenance refusal is not mounted here: it has to beat the base
  // middleware, which is registered long before this runs. This insists the
  // entry point installed it — see `./maintenance` for why the ordering is
  // load-bearing rather than tidy.
  assertMaintenanceGateInstalled(app);

  const router = Router();
  router.use(requireWebServiceAuth());
  router.use(createWsLoggingMiddleware());

  router.all('/:configRef/:operation', async (req, res) => {
    const context = res.locals.wsContext as WebServiceContext;
    const { configRef, operation } = req.params;

    const refuse = (reason: RefusalReason) => {
      res.locals.wsErrorCode = reason;
      res.status(404).json(REFUSAL);
    };

    try {
      // 1. Resolve the configuration — once, for every check below.
      const resolved = await resolveConfiguration(configRef);
      if (!resolved.ok) return refuse(resolved.reason);
      const config = resolved.config;

      const data = (config.data ?? {}) as Record<string, unknown>;
      context.configId = config.id;
      context.configAlias = typeof data.alias === 'string' ? data.alias : null;
      context.pluginId = config.pluginId;
      context.operation = operation;

      // 2. The client must hold a grant for THIS configuration.
      const granted = await storage.wsClientGrants.has(context.clientId, config.id);
      if (!granted) return refuse('NOT_GRANTED');

      // 3. The configuration itself must be switched on.
      if (!config.enabled) return refuse('CONFIG_DISABLED');

      // 4. Its plugin must be registered and its component enabled.
      const plugin = webServiceRegistry.get(config.pluginId);
      if (!plugin) return refuse('PLUGIN_UNREGISTERED');
      if (!(await isPluginComponentEnabledAsync(webServiceRegistry.getMetadata(plugin)))) {
        return refuse('COMPONENT_DISABLED');
      }

      // 5. The operation must be declared, and must accept this verb. Past
      //    this point the caller has proven they may reach the configuration,
      //    so these refusals name the actual problem.
      const op = findWebServiceOperation(plugin, operation);
      if (!op) {
        res.locals.wsErrorCode = 'UNKNOWN_OPERATION';
        return res.status(404).json({
          error: 'Not Found',
          code: 'UNKNOWN_OPERATION',
          message: `This service declares no operation named '${operation}'`,
        });
      }
      const method = req.method.toUpperCase();
      if (!op.methods.includes(method as (typeof op.methods)[number])) {
        res.locals.wsErrorCode = 'METHOD_NOT_ALLOWED';
        res.setHeader('Allow', op.methods.join(', '));
        return res.status(405).json({
          error: 'Method Not Allowed',
          code: 'METHOD_NOT_ALLOWED',
          message: `Operation '${operation}' accepts ${op.methods.join(', ')}`,
        });
      }

      // Past this line the call is served, and counted, whatever the handler
      // does with it — including throwing. See `countServedCall`.
      res.locals.wsHandled = true;
      await op.handler({ config, settings: data, req, res });
    } catch (error) {
      logger.error('Web service dispatch failed', {
        error,
        configRef,
        operation,
        clientId: context?.clientId,
      });
      res.locals.wsErrorCode = 'DISPATCH_ERROR';
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal Server Error', code: 'DISPATCH_ERROR' });
      }
    }
  });

  // Anything else under the web service mount is JSON, never the app's HTML
  // catch-all.
  router.all('*', (req, res) => {
    res.status(404).json({
      error: 'Not Found',
      code: 'NOT_FOUND',
      message: `Web services are addressed as ${WEB_SERVICE_BASE_PATH}/<configuration>/<operation>`,
    });
  });

  app.use(WEB_SERVICE_BASE_PATH, router);

  logger.info(`Registered web service dispatcher at ${WEB_SERVICE_BASE_PATH}/:configuration/:operation`);
}

export { getWebServiceContext } from '../../middleware/webservice-auth';
