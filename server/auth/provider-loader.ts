import type { AuthProviderConfig, AuthProvider } from "./types";
import type { AuthProviderType } from "@shared/schema";

import * as replitProvider from "./providers/replit";

type ProviderModule = {
  createProvider: (config: any) => AuthProvider;
};

const loadSamlProvider = async (): Promise<ProviderModule> => {
  const samlProvider = await import("./providers/saml");
  return samlProvider as ProviderModule;
};

const loadClerkProvider = async (): Promise<ProviderModule> => {
  const clerkProvider = await import("./providers/clerk");
  return clerkProvider as ProviderModule;
};

export async function loadProvider(config: AuthProviderConfig): Promise<AuthProvider> {
  if (config.type === "replit") {
    return (replitProvider as ProviderModule).createProvider(config);
  }
  
  if (config.type === "saml" || config.type === "okta" || config.type === "oauth") {
    const samlProvider = await loadSamlProvider();
    return samlProvider.createProvider(config);
  }

  if (config.type === "clerk") {
    const clerkProvider = await loadClerkProvider();
    return clerkProvider.createProvider(config);
  }

  throw new Error(`Unknown auth provider type: ${config.type}`);
}

export function isValidProviderType(type: string): type is AuthProviderType {
  return ["replit", "saml", "okta", "oauth", "local", "clerk"].includes(type);
}
