import type { Request } from "express";
import type { WsClient, WsClientCredential } from "@shared/schema";
import { isComponentEnabledSync } from "../../services/component/cache";
import type { AuthResult } from "../../middleware/webservice-auth";
import { hasLegacyAuthenticationSelection } from "@shared/webservice-authentication";
export type AuthenticationResult = AuthResult;
export interface AuthenticationSelection { provider: string; configId?: string }
interface AuthenticationProvider {
  id: string;
  component: string;
  /** Read old package settings without rewriting or requiring its tables. */
  legacySelection?: (client: WsClient) => AuthenticationSelection | undefined;
  /** Side-effect-free configuration check for generated documentation. */
  available?: (selection: AuthenticationSelection) => Promise<boolean>;
  authenticate: (request: Request, client: WsClient, credential: WsClientCredential, selection: AuthenticationSelection) => Promise<AuthResult | undefined>;
}
const providers = new Map<string, AuthenticationProvider>();
export function registerAuthenticationProvider(provider: AuthenticationProvider): void {
  if (providers.has(provider.id)) throw new Error(`Duplicate authentication provider: ${provider.id}`);
  providers.set(provider.id, provider);
}
export function authenticationSelection(client: WsClient): AuthenticationSelection | undefined {
  const data = client.data ?? {};
  if (Object.hasOwn(data, "authenticationProvider")) {
    const value = data.authenticationProvider;
    if (value === null) return undefined; // explicit administrator choice of client-secret authentication
    if (value && typeof value === "object" && typeof (value as AuthenticationSelection).provider === "string") {
      return value as AuthenticationSelection;
    }
    return { provider: "unresolved" };
  }
  for (const provider of providers.values()) {
    const selection = provider.legacySelection?.(client);
    if (selection) return selection;
  }
  // An absent package cannot interpret its old settings. Never reinterpret
  // unclaimed legacy authorization selections as permission to use a client secret.
  return hasLegacyAuthenticationSelection(data) ? { provider: "unresolved" } : undefined;
}
export function authenticationProviderAvailable(selection: AuthenticationSelection): boolean {
  const provider = providers.get(selection.provider);
  return Boolean(provider && isComponentEnabledSync(provider.component));
}
export async function authenticationSelectionAvailable(selection: AuthenticationSelection): Promise<boolean> {
  if (!authenticationProviderAvailable(selection)) return false;
  const provider = providers.get(selection.provider)!;
  return provider.available ? provider.available(selection) : true;
}
export async function authenticateWithProvider(req: Request, client: WsClient, credential: WsClientCredential, selection: AuthenticationSelection) {
  const provider = providers.get(selection.provider);
  if (!provider || !authenticationProviderAvailable(selection)) {
    return { success: false, client, credential, error: "The selected authentication provider is unavailable.", errorCode: "AUTH_PROVIDER_UNAVAILABLE" };
  }
  return provider.authenticate(req, client, credential, selection);
}
