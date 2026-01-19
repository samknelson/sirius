import { Router, type Express, type RequestHandler } from 'express';
import { requireWebServiceAuth, getWebServiceContext } from '../../middleware/webservice-auth';
import { logger } from '../../logger';

export interface WebServiceBundleConfig {
  bundleCode: string;
  basePath?: string;
  setupRoutes: (router: Router) => void;
}

export function createWebServiceRouter(bundleCode: string): Router {
  const router = Router();
  router.use(requireWebServiceAuth(bundleCode));
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
