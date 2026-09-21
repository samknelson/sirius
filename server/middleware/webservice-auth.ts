import { AsyncLocalStorage } from 'async_hooks';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { storage } from '../storage';
import { logger, logWsRequest } from '../logger';
import type { WsClient, WsClientCredential } from '@shared/schema';
import { wcRequest } from '../services/webclient/client';
import type { FreemanAuthorizationResult } from '../plugins/wc-vendors/plugins/sitespecific-freeman-authorization';

const FREEMAN_AUTHORIZATION_CONFIG_KEY = 'freemanBearerAuthorizationConfigId';
const FREEMAN_AUTHORIZATION_OPERATION = 'sitespecific.freeman.authorization.bearer' as const;

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
  const clientId = req.headers['x-ws-client-id'] as string | undefined;
  const clientSecret = req.headers['x-ws-client-secret'] as string | undefined;

  if (clientId) {
    return authenticateIdentifiedRequest(clientId, clientSecret, req);
  }

  const authHeader = req.headers['authorization'];
  if (authHeader?.startsWith('Basic ')) {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
    const colonIndex = decoded.indexOf(':');
    if (colonIndex > 0) {
      const basicId = decoded.slice(0, colonIndex);
      const basicSecret = decoded.slice(colonIndex + 1);
      return authenticateIdentifiedRequest(basicId, basicSecret, req);
    }
  }

  return { success: false, error: 'Missing credentials', errorCode: 'MISSING_CREDENTIALS' };
}

async function authenticateIdentifiedRequest(
  clientId: string,
  clientSecret: string | undefined,
  req: Request,
): Promise<AuthResult> {
  const credential = await storage.wsClientCredentials.getByClientKey(clientId);
  if (!credential) {
    return { success: false, error: 'Invalid credentials', errorCode: 'INVALID_CREDENTIALS' };
  }
  const client = await storage.wsClients.get(credential.clientId);
  if (!client) {
    return { success: false, error: 'Client not found', errorCode: 'CLIENT_NOT_FOUND', credential };
  }

  if (requiresFreemanBearerAuthorization(client)) {
    return authenticateSelectedClient(req, client, credential);
  }
  if (!clientSecret) {
    return {
      success: false,
      error: 'Missing credentials',
      errorCode: 'MISSING_CREDENTIALS',
      client,
      credential,
    };
  }
  return authenticateWithCredentials(clientId, clientSecret, req);
}

export function freemanAuthorizationConfigId(client: WsClient): string | undefined {
  const value = client.data?.[FREEMAN_AUTHORIZATION_CONFIG_KEY];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function requiresFreemanBearerAuthorization(client: WsClient): boolean {
  // The saved client setting is the authentication contract. Component
  // availability may decide whether the configured vendor call can run, but
  // must never downgrade this client to secret or Basic authentication.
  return Boolean(freemanAuthorizationConfigId(client));
}

function bearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  const match = typeof header === 'string' ? /^Bearer\s+(\S+)\s*$/i.exec(header) : null;
  return match?.[1];
}

function freemanFailure(
  client: WsClient,
  credential: WsClientCredential,
  error: string,
  errorCode: string,
): AuthResult {
  return { success: false, error, errorCode, client, credential };
}

async function authenticateFreemanBearer(
  req: Request,
  client: WsClient,
  credential: WsClientCredential,
  configId: string,
): Promise<AuthResult | undefined> {
  const token = bearerToken(req);
  if (!token) {
    return freemanFailure(
      client,
      credential,
      'A valid Authorization: Bearer header is required.',
      'FREEMAN_BEARER_REQUIRED',
    );
  }

  let response;
  try {
    response = await wcRequest({
      vendor: { configId },
      operation: FREEMAN_AUTHORIZATION_OPERATION,
      args: { bearerCredential: token },
    });
  } catch {
    // Addressing, component, maintenance, and configuration refusals happen
    // before a vendor request and throw from the framework. Keep their details
    // out of this public authentication response: they may name private site
    // configuration, and the actionable fact for this caller is the stage.
    return freemanFailure(
      client,
      credential,
      'The configured Freeman bearer authorization connection could not be used.',
      'FREEMAN_AUTH_CONFIGURATION_UNAVAILABLE',
    );
  }

  const result = response.value as FreemanAuthorizationResult | undefined;
  if (!result) {
    return freemanFailure(
      client,
      credential,
      'The Freeman bearer authorization service did not return an answer.',
      'FREEMAN_AUTH_NO_ANSWER',
    );
  }
  if (result.outcome === 'network_error') {
    return freemanFailure(
      client,
      credential,
      'The Freeman bearer authorization service could not be reached.',
      'FREEMAN_AUTH_NETWORK_ERROR',
    );
  }
  if (result.outcome === 'malformed_response') {
    return freemanFailure(
      client,
      credential,
      'The Freeman bearer authorization service returned invalid JSON.',
      'FREEMAN_AUTH_INVALID_JSON',
    );
  }
  if (result.status !== 200) {
    return freemanFailure(
      client,
      credential,
      result.status === undefined
        ? 'The Freeman bearer authorization service returned no HTTP status.'
        : `The Freeman bearer authorization service returned HTTP ${result.status}; expected HTTP 200.`,
      'FREEMAN_AUTH_HTTP_STATUS',
    );
  }
  if (!result.success || result.outcome !== 'success') {
    return freemanFailure(
      client,
      credential,
      'The Freeman bearer authorization service refused the request.',
      'FREEMAN_AUTH_REFUSED',
    );
  }

  return undefined;
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

  return authenticateSelectedClient(req, client, credential);
}

async function authenticateSelectedClient(
  req: Request,
  client: WsClient,
  credential: WsClientCredential,
): Promise<AuthResult> {
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

  /*
   * SITE-SPECIFIC EXCEPTION: for a Freeman-configured client, the issued client
   * id selects the client but is not itself authenticated. The vendor-backed
   * bearer is the sole credential check; X-WS-Client-Secret is intentionally
   * ignored. A valid bearer can therefore select any Freeman-enabled client
   * whose id it knows. That accepted limitation remains until bearer metadata
   * or IP rules can bind the caller more narrowly.
   */
  const freemanConfigId = freemanAuthorizationConfigId(client);
  if (freemanConfigId && requiresFreemanBearerAuthorization(client)) {
    const failure = await authenticateFreemanBearer(
      req,
      client,
      credential,
      freemanConfigId,
    );
    if (failure) return failure;
  }

  // The "last used" stamp is bookkeeping, not an input to any decision made
  // here, so it must never fail a credential that has already proven itself.
  // Any write can fail transiently, and this one is attempted on every single
  // authenticated call — turning that into a 500 would reject a valid caller
  // over a timestamp.
  try {
    await storage.wsClientCredentials.recordUsage(credential.id);
  } catch (error) {
    logger.warn('Failed to record web service credential usage', {
      credentialId: credential.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

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
