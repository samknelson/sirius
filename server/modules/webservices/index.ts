import { Router, type Express, type RequestHandler } from 'express';
import {
  requireWebServiceAuth,
  type WebServiceContext,
} from '../../middleware/webservice-auth';
import { logger, logWsRequest } from '../../logger';
import { storage } from '../../storage';
import { isPluginComponentEnabledAsync } from '../../plugins/_core';
import { webServiceRegistry, findWebServiceOperation } from '../../plugins/web-service';
import type { PluginConfig } from '@shared/schema';

/** Public mount point for every web service. */
export const WEB_SERVICE_BASE_PATH = '/api/ws';

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

// Middleware that logs WS requests after they complete
function createWsLoggingMiddleware(): RequestHandler {
  return (req, res, next) => {
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
 * Resolve the configuration a request is addressed to, EXACTLY ONCE.
 *
 * Resolution is by `plugin_configs.id` first, then by alias. Id wins so an
 * alias that happens to look like a configuration id can never shadow the real
 * record. An alias matching more than one configuration is refused rather than
 * silently picking one: the grant check still runs on whichever record won, so
 * there is no privilege escalation, but a client granted both services would
 * quietly reach the wrong one.
 */
async function resolveConfiguration(
  configRef: string,
): Promise<
  | { ok: true; config: PluginConfig }
  | { ok: false; reason: 'UNKNOWN_CONFIG' | 'AMBIGUOUS_ALIAS' }
> {
  const byId = await storage.pluginConfigs.get(configRef);
  if (byId && byId.pluginKind === 'web-service') {
    return { ok: true, config: byId };
  }

  const all = await storage.pluginConfigs.getByKind('web-service');
  const byAlias = all.filter((c) => {
    const data = (c.data ?? {}) as Record<string, unknown>;
    return typeof data.alias === 'string' && data.alias === configRef;
  });
  if (byAlias.length === 1) return { ok: true, config: byAlias[0] };
  if (byAlias.length > 1) return { ok: false, reason: 'AMBIGUOUS_ALIAS' };
  return { ok: false, reason: 'UNKNOWN_CONFIG' };
}

/**
 * The one dispatcher for every web service. Per request it authenticates the
 * credential, resolves the configuration once, and reuses that same resolved
 * record for the grant check, the enabled checks and the handler call.
 */
export function registerWebServiceDispatcher(app: Express): void {
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
