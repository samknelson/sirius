export function getPublicBaseUrl(): string | undefined {
  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  }
  
  if (process.env.REPLIT_DEPLOYMENT_DOMAIN) {
    return `https://${process.env.REPLIT_DEPLOYMENT_DOMAIN}`;
  }
  
  if (process.env.PUBLIC_URL) {
    return process.env.PUBLIC_URL;
  }
  
  return undefined;
}

export function buildStatusCallbackUrl(commId: string): string | undefined {
  const baseUrl = getPublicBaseUrl();
  
  if (!baseUrl) {
    console.warn('No public URL available for status callback - REPLIT_DEV_DOMAIN, REPLIT_DEPLOYMENT_DOMAIN, and PUBLIC_URL are all undefined');
    return undefined;
  }
  
  return `${baseUrl}/api/comm/statuscallback/${commId}`;
}
