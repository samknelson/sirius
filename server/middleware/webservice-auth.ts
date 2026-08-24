import { AsyncLocalStorage } from 'async_hooks';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { storage } from '../storage';
import { logger, logWsRequest } from '../logger';
import type { WsClient, WsClientCredential } from '@shared/schema';

/**
 * Per-request identity of a web service call. The client/credential half is
 * filled by the auth middleware; the service half (configuration, plugin,
 * operation) is filled by the dispatcher once it has resolved the address, so
 * request logs name the service that actually served the call.
 */
export interface WebServiceContext {
  clientId: string;
  clientName: string;
  credentialId: string;
  ipAddress: string;
  /** Resolved `plugin_configs.id`. Absent when the address never resolved. */
  configId?: string;
  /** Configuration's alias, when it has one. */
  configAlias?: string | null;
  /** Registered web-service plugin id backing the configuration. */
  pluginId?: string;
  /** Declared operation name from the path. */
  operation?: string;
}

export const webServiceContext = new AsyncLocalStorage<WebServiceContext>();

export function getWebServiceContext(): WebServiceContext | undefined {
  return webServiceContext.getStore();
}

export function getClientIp(req: Request): string {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    const ips = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
    return ips.split(',')[0].trim();
  }

  const realIp = req.headers['x-real-ip'];
  if (realIp) {
    return Array.isArray(realIp) ? realIp[0] : realIp;
  }

  return req.socket.remoteAddress || 'unknown';
}

interface AuthResult {
  success: boolean;
  error?: string;
  errorCode?: string;
  client?: WsClient;
  credential?: WsClientCredential;
}

async function authenticateRequest(req: Request): Promise<AuthResult> {
  const clientKey = req.headers['x-ws-client-key'] as string | undefined;
  const clientSecret = req.headers['x-ws-client-secret'] as string | undefined;

  if (!clientKey || !clientSecret) {
    const authHeader = req.headers['authorization'];
    if (authHeader?.startsWith('Basic ')) {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
      const colonIndex = decoded.indexOf(':');
      if (colonIndex > 0) {
        const basicKey = decoded.slice(0, colonIndex);
        const basicSecret = decoded.slice(colonIndex + 1);
        return authenticateWithCredentials(basicKey, basicSecret, req);
      }
    }
    return { success: false, error: 'Missing credentials', errorCode: 'MISSING_CREDENTIALS' };
  }

  return authenticateWithCredentials(clientKey, clientSecret, req);
}

async function authenticateWithCredentials(
  clientKey: string,
  clientSecret: string,
  req: Request,
): Promise<AuthResult> {
  const validation = await storage.wsClientCredentials.validateSecret(clientKey, clientSecret);

  if (!validation.valid || !validation.credential) {
    return { success: false, error: 'Invalid credentials', errorCode: 'INVALID_CREDENTIALS' };
  }

  const credential = validation.credential;
  const client = await storage.wsClients.get(credential.clientId);

  if (!client) {
    return { success: false, error: 'Client not found', errorCode: 'CLIENT_NOT_FOUND', credential };
  }

  if (client.status !== 'active') {
    return { success: false, error: 'Client is not active', errorCode: 'CLIENT_INACTIVE', client, credential };
  }

  if (client.ipAllowlistEnabled) {
    const clientIp = getClientIp(req);
    const isAllowed = await storage.wsClientIpRules.isIpAllowed(client.id, clientIp);
    if (!isAllowed) {
      return { success: false, error: 'IP address not allowed', errorCode: 'IP_NOT_ALLOWED', client, credential };
    }
  }

  await storage.wsClientCredentials.recordUsage(credential.id);

  return { success: true, client, credential };
}

/**
 * Authenticate the caller's credential and establish the request context.
 * Authorization (which services this client may call) is NOT decided here —
 * that is the dispatcher's job, because it depends on the resolved
 * configuration.
 */
export function createWebServiceAuthMiddleware(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const ipAddress = getClientIp(req);
    const startTime = Date.now();

    try {
      const result = await authenticateRequest(req);

      if (!result.success) {
        const duration = Date.now() - startTime;

        // Log auth failure to database with client ID if available
        logWsRequest({
          clientId: result.client?.id || null,
          clientName: result.client?.name || null,
          credentialId: result.credential?.id || null,
          method: req.method,
          path: req.originalUrl,
          status: 401,
          duration,
          ipAddress,
          errorCode: result.errorCode,
          errorMessage: result.error,
        });

        return res.status(401).json({
          error: result.error,
          code: result.errorCode,
        });
      }

      const client = result.client!;
      const credential = result.credential!;

      const context: WebServiceContext = {
        clientId: client.id,
        clientName: client.name,
        credentialId: credential.id,
        ipAddress,
      };

      // Store start time and context for centralized logging middleware
      res.locals.wsStartTime = startTime;
      res.locals.wsContext = context;

      webServiceContext.run(context, () => {
        next();
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      // PII triage (accepted): caller IP is required to investigate
      // web-service auth failures and abuse; no other PII is logged here.
      logger.error('Web service authentication error', { error, ipAddress, path: req.path });

      logWsRequest({
        clientId: null,
        clientName: null,
        credentialId: null,
        method: req.method,
        path: req.originalUrl,
        status: 500,
        duration,
        ipAddress,
        errorCode: 'AUTH_ERROR',
        errorMessage: 'Authentication error',
      });

      return res.status(500).json({
        error: 'Authentication error',
        code: 'AUTH_ERROR',
      });
    }
  };
}

export function requireWebServiceAuth(): RequestHandler {
  return createWebServiceAuthMiddleware();
}
