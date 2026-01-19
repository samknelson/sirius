import { AsyncLocalStorage } from 'async_hooks';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { storage } from '../storage';
import { logger } from '../logger';
import type { WsClient, WsBundle, WsClientCredential } from '@shared/schema';

export interface WebServiceContext {
  clientId: string;
  clientName: string;
  bundleId: string;
  bundleCode: string;
  credentialId: string;
  ipAddress: string;
}

export const webServiceContext = new AsyncLocalStorage<WebServiceContext>();

export function getWebServiceContext(): WebServiceContext | undefined {
  return webServiceContext.getStore();
}

function getClientIp(req: Request): string {
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
  client?: WsClient & { bundle?: WsBundle | null };
  credential?: WsClientCredential;
}

async function authenticateRequest(req: Request, bundleCode?: string): Promise<AuthResult> {
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
        return authenticateWithCredentials(basicKey, basicSecret, req, bundleCode);
      }
    }
    return { success: false, error: 'Missing credentials', errorCode: 'MISSING_CREDENTIALS' };
  }

  return authenticateWithCredentials(clientKey, clientSecret, req, bundleCode);
}

async function authenticateWithCredentials(
  clientKey: string,
  clientSecret: string,
  req: Request,
  bundleCode?: string
): Promise<AuthResult> {
  const validation = await storage.wsClientCredentials.validateSecret(clientKey, clientSecret);
  
  if (!validation.valid || !validation.credential) {
    return { success: false, error: 'Invalid credentials', errorCode: 'INVALID_CREDENTIALS' };
  }

  const credential = validation.credential;
  const client = await storage.wsClients.get(credential.clientId);

  if (!client) {
    return { success: false, error: 'Client not found', errorCode: 'CLIENT_NOT_FOUND' };
  }

  if (client.status !== 'active') {
    return { success: false, error: 'Client is not active', errorCode: 'CLIENT_INACTIVE' };
  }

  if (!client.bundle) {
    return { success: false, error: 'Bundle not found', errorCode: 'BUNDLE_NOT_FOUND' };
  }

  if (client.bundle.status !== 'active') {
    return { success: false, error: 'Bundle is not active', errorCode: 'BUNDLE_INACTIVE' };
  }

  if (bundleCode && client.bundle.code !== bundleCode) {
    return { success: false, error: 'Client not authorized for this bundle', errorCode: 'BUNDLE_MISMATCH' };
  }

  if (client.ipAllowlistEnabled) {
    const clientIp = getClientIp(req);
    const isAllowed = await storage.wsClientIpRules.isIpAllowed(client.id, clientIp);
    if (!isAllowed) {
      logger.warn('Web service request from unauthorized IP', {
        clientId: client.id,
        clientName: client.name,
        ipAddress: clientIp,
      });
      return { success: false, error: 'IP address not allowed', errorCode: 'IP_NOT_ALLOWED' };
    }
  }

  await storage.wsClientCredentials.recordUsage(credential.id);

  return { success: true, client, credential };
}

export interface WebServiceAuthOptions {
  bundleCode?: string;
}

export function createWebServiceAuthMiddleware(options: WebServiceAuthOptions = {}): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const ipAddress = getClientIp(req);
    
    try {
      const result = await authenticateRequest(req, options.bundleCode);

      if (!result.success) {
        logger.warn('Web service authentication failed', {
          error: result.error,
          errorCode: result.errorCode,
          ipAddress,
          path: req.path,
          method: req.method,
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
        bundleId: client.bundleId,
        bundleCode: client.bundle!.code,
        credentialId: credential.id,
        ipAddress,
      };

      logger.info('Web service request authenticated', {
        clientId: client.id,
        clientName: client.name,
        bundleCode: client.bundle!.code,
        path: req.path,
        method: req.method,
        ipAddress,
      });

      webServiceContext.run(context, () => {
        next();
      });
    } catch (error) {
      logger.error('Web service authentication error', { error, ipAddress, path: req.path });
      return res.status(500).json({
        error: 'Authentication error',
        code: 'AUTH_ERROR',
      });
    }
  };
}

export function requireWebServiceAuth(bundleCode?: string): RequestHandler {
  return createWebServiceAuthMiddleware({ bundleCode });
}
