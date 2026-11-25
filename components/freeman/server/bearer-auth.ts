import "./vendor-contract";
import type { Request } from 'express';
import type { WsClient, WsClientCredential } from '@shared/schema';
import { wcRequest } from '../../../server/services/webclient/client';
import type { WcVendorOperations } from '../../../server/plugins/wc-vendors/types';
import { registerAuthenticationProvider, type AuthenticationResult as AuthResult } from '../../../server/modules/webservices/authentication-providers';
type BearerAuthorizationResult = WcVendorOperations['sitespecific.freeman.authorization.bearer']['result'];
const FREEMAN_AUTHORIZATION_OPERATION = 'sitespecific.freeman.authorization.bearer' as const;
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

  const result = response.value as BearerAuthorizationResult | undefined;
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


registerAuthenticationProvider({
 id: 'freeman-bearer', component: 'sitespecific.freeman.authorization',
 available: async selection => {
   if (!selection.configId) return false;
   const { describeWcVendor, WcVendorError } = await import('../../../server/services/webclient/wc-vendor-context');
   try {
     const connection = await describeWcVendor({ configId: selection.configId }, FREEMAN_AUTHORIZATION_OPERATION);
     return connection.pluginId === 'sitespecific-freeman-authorization' &&
       connection.operations.includes(FREEMAN_AUTHORIZATION_OPERATION);
   } catch (error) {
     if (error instanceof WcVendorError) return false;
     throw error;
   }
 },
 legacySelection: client => { const value = client.data?.freemanBearerAuthorizationConfigId; return typeof value === 'string' && value.trim() ? {provider: 'freeman-bearer', configId: value.trim()} : undefined; },
 authenticate: async (req, client, credential, selection) => {
   if (typeof selection.configId !== 'string' || !selection.configId.trim()) return {success:false, error:'The configured bearer authorization connection could not be used.', errorCode:'FREEMAN_AUTH_CONFIGURATION_UNAVAILABLE', client, credential};
   return authenticateFreemanBearer(req, client, credential, selection.configId);
 },
});
