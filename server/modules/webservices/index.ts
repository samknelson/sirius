import { Router, type Express, type RequestHandler } from 'express';
import { requireWebServiceAuth, getWebServiceContext, type WebServiceContext } from '../../middleware/webservice-auth';
import { logger, logWsRequest } from '../../logger';

export interface WebServiceBundleConfig {
  bundleCode: string;
  basePath?: string;
  setupRoutes: (router: Router) => void;
}

// Middleware that logs WS requests after they complete
function createWsLoggingMiddleware(bundleCode: string): RequestHandler {
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
          bundleCode: context.bundleCode,
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          duration,
          ipAddress: context.ipAddress,
        });
      }
    });
    
    next();
  };
}

export function createWebServiceRouter(bundleCode: string): Router {
  const router = Router();
  router.use(requireWebServiceAuth(bundleCode));
  router.use(createWsLoggingMiddleware(bundleCode));
  return router;
}

export function registerWebServiceBundle(app: Express, config: WebServiceBundleConfig): void {
  const { bundleCode, basePath, setupRoutes } = config;
  const router = createWebServiceRouter(bundleCode);
  
  setupRoutes(router);
  
  // Add catch-all for unmatched routes within this bundle - returns JSON error
  // instead of falling through to the HTML catch-all
  router.all('*', (req, res) => {
    res.status(404).json({
      error: 'Not Found',
      message: `No endpoint matches ${req.method} ${req.baseUrl}${req.path}`,
      bundle: bundleCode
    });
  });
  
  const mountPath = basePath ?? `/api/ws/${bundleCode}`;
  app.use(mountPath, router);
  
  logger.info(`Registered web service bundle: ${bundleCode} at ${mountPath}`);
}

export { getWebServiceContext } from '../../middleware/webservice-auth';
