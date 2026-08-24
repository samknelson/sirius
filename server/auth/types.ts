import type { Express, RequestHandler, Request, Response, NextFunction } from "express";
import type { AuthProviderType } from "@shared/schema";

export interface AuthIdentityInfo {
  providerType: AuthProviderType;
  externalId: string;
  email?: string;
  displayName?: string;
  profileImageUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface AuthenticatedUser {
  claims: {
    sub: string;
    email?: string;
    first_name?: string;
    last_name?: string;
    profile_image_url?: string;
    exp?: number;
    [key: string]: unknown;
  };
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  dbUser?: {
    id: string;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    profileImageUrl?: string | null;
    isActive: boolean;
    [key: string]: unknown;
  };
  providerType: AuthProviderType;
}

export interface AuthProviderConfig {
  type: AuthProviderType;
  enabled: boolean;
  isDefault?: boolean;
}

export interface ReplitProviderConfig extends AuthProviderConfig {
  type: "replit";
  issuerUrl?: string;
  clientId?: string;
}

export interface OktaProviderConfig extends AuthProviderConfig {
  type: "okta";
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  callbackPath?: string;
}

export interface SamlProviderConfig extends AuthProviderConfig {
  type: "saml";
  // SAML core config is resolved at REQUEST time via getEnvironmentVariable
  // (so Variables-table overrides take effect without a restart). These
  // fields hold the boot-time snapshot only for logging/diagnostics and may
  // be absent — the provider registers "dormant" when saml is listed in
  // AUTH_PROVIDER but the variables are not yet resolvable.
  entryPoint?: string;
  issuer?: string;
  cert?: string;
  callbackPath?: string;
}

export interface OAuthProviderConfig extends AuthProviderConfig {
  type: "oauth";
  authorizationUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  callbackPath?: string;
}

export interface LocalProviderConfig extends AuthProviderConfig {
  type: "local";
  pepper?: string;
}

export interface ClerkProviderConfig extends AuthProviderConfig {
  type: "clerk";
  publishableKey: string;
  secretKey: string;
}

export type ProviderConfig =
  | ReplitProviderConfig
  | OktaProviderConfig
  | SamlProviderConfig
  | OAuthProviderConfig
  | LocalProviderConfig
  | ClerkProviderConfig;

export interface AuthConfig {
  sessionSecret: string;
  sessionTtl?: number;
  providers: ProviderConfig[];
  defaultProvider?: AuthProviderType;
}

export interface AuthProvider {
  type: AuthProviderType;
  
  setup(app: Express): Promise<void>;
  
  getLoginHandler(): RequestHandler;
  
  getCallbackHandler(): RequestHandler;
  
  getLogoutHandler(): RequestHandler;
  
  refreshToken?(user: AuthenticatedUser): Promise<AuthenticatedUser | null>;
  
  validateCredentials?(
    username: string,
    password: string
  ): Promise<AuthIdentityInfo | null>;
}

export interface ProviderRegistry {
  register(provider: AuthProvider): void;
  get(type: AuthProviderType): AuthProvider | undefined;
  getDefault(): AuthProvider | undefined;
  getAll(): AuthProvider[];
  setDefault(type: AuthProviderType): void;
}
