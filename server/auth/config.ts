import { z } from "zod";
import type {
  AuthConfig,
  ProviderConfig,
  ReplitProviderConfig,
  OktaProviderConfig,
  SamlProviderConfig,
  OAuthProviderConfig,
  LocalProviderConfig,
} from "./types";
import type { AuthProviderType } from "@shared/schema";

const baseProviderSchema = z.object({
  enabled: z.boolean().default(true),
  isDefault: z.boolean().optional(),
});

const replitProviderSchema = baseProviderSchema.extend({
  type: z.literal("replit"),
  issuerUrl: z.string().url().optional(),
  clientId: z.string().optional(),
});

const oktaProviderSchema = baseProviderSchema.extend({
  type: z.literal("okta"),
  issuerUrl: z.string().url(),
  clientId: z.string(),
  clientSecret: z.string(),
  callbackPath: z.string().optional(),
});

const samlProviderSchema = baseProviderSchema.extend({
  type: z.literal("saml"),
  entryPoint: z.string().url(),
  issuer: z.string(),
  cert: z.string(),
  callbackPath: z.string().optional(),
});

const oauthProviderSchema = baseProviderSchema.extend({
  type: z.literal("oauth"),
  authorizationUrl: z.string().url(),
  tokenUrl: z.string().url(),
  userInfoUrl: z.string().url(),
  clientId: z.string(),
  clientSecret: z.string(),
  scope: z.string().optional(),
  callbackPath: z.string().optional(),
});

const localProviderSchema = baseProviderSchema.extend({
  type: z.literal("local"),
  pepper: z.string().optional(),
});

const providerConfigSchema = z.discriminatedUnion("type", [
  replitProviderSchema,
  oktaProviderSchema,
  samlProviderSchema,
  oauthProviderSchema,
  localProviderSchema,
]);

const authConfigSchema = z.object({
  sessionSecret: z.string().min(32),
  sessionTtl: z.number().positive().optional(),
  providers: z.array(providerConfigSchema).min(1),
  defaultProvider: z.enum(["replit", "okta", "saml", "oauth", "local"]).optional(),
});

function parseProviderFromEnv(type: AuthProviderType): ProviderConfig | null {
  switch (type) {
    case "replit": {
      const config: ReplitProviderConfig = {
        type: "replit",
        enabled: true,
        issuerUrl: process.env.REPLIT_ISSUER_URL || process.env.ISSUER_URL,
        clientId: process.env.REPLIT_CLIENT_ID || process.env.REPL_ID,
      };
      return config;
    }

    case "okta": {
      const issuerUrl = process.env.OKTA_ISSUER_URL;
      const clientId = process.env.OKTA_CLIENT_ID;
      const clientSecret = process.env.OKTA_CLIENT_SECRET;
      if (!issuerUrl || !clientId || !clientSecret) {
        return null;
      }
      const config: OktaProviderConfig = {
        type: "okta",
        enabled: true,
        issuerUrl,
        clientId,
        clientSecret,
        callbackPath: process.env.OKTA_CALLBACK_PATH,
      };
      return config;
    }

    case "saml": {
      const entryPoint = process.env.SAML_ENTRY_POINT;
      const issuer = process.env.SAML_ISSUER;
      const cert = process.env.SAML_CERT;
      if (!entryPoint || !issuer || !cert) {
        return null;
      }
      const config: SamlProviderConfig = {
        type: "saml",
        enabled: true,
        entryPoint,
        issuer,
        cert,
        callbackPath: process.env.SAML_CALLBACK_PATH,
      };
      return config;
    }

    case "oauth": {
      const authorizationUrl = process.env.OAUTH_AUTHORIZATION_URL;
      const tokenUrl = process.env.OAUTH_TOKEN_URL;
      const userInfoUrl = process.env.OAUTH_USERINFO_URL;
      const clientId = process.env.OAUTH_CLIENT_ID;
      const clientSecret = process.env.OAUTH_CLIENT_SECRET;
      if (!authorizationUrl || !tokenUrl || !userInfoUrl || !clientId || !clientSecret) {
        return null;
      }
      const config: OAuthProviderConfig = {
        type: "oauth",
        enabled: true,
        authorizationUrl,
        tokenUrl,
        userInfoUrl,
        clientId,
        clientSecret,
        scope: process.env.OAUTH_SCOPE,
        callbackPath: process.env.OAUTH_CALLBACK_PATH,
      };
      return config;
    }

    case "local": {
      const config: LocalProviderConfig = {
        type: "local",
        enabled: process.env.AUTH_LOCAL_ENABLED === "true",
        pepper: process.env.AUTH_LOCAL_PEPPER,
      };
      return config.enabled ? config : null;
    }

    default:
      return null;
  }
}

export function loadAuthConfig(): AuthConfig {
  const authProviderEnv = process.env.AUTH_PROVIDER || "replit";
  const enabledProviders = authProviderEnv.split(",").map((p) => p.trim()) as AuthProviderType[];

  const providers: ProviderConfig[] = [];

  for (const providerType of enabledProviders) {
    const config = parseProviderFromEnv(providerType);
    if (config) {
      providers.push(config);
    }
  }

  if (providers.length === 0) {
    const replitConfig = parseProviderFromEnv("replit");
    if (replitConfig) {
      providers.push(replitConfig);
    } else {
      throw new Error("No auth providers configured. Set AUTH_PROVIDER environment variable.");
    }
  }

  const defaultProvider =
    (process.env.AUTH_DEFAULT_PROVIDER as AuthProviderType) ||
    providers.find((p) => p.isDefault)?.type ||
    providers[0]?.type;

  if (defaultProvider && providers.length > 0) {
    const defaultConfig = providers.find((p) => p.type === defaultProvider);
    if (defaultConfig) {
      defaultConfig.isDefault = true;
    }
  }

  let sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SESSION_SECRET environment variable is required in production");
    }
    console.warn("WARNING: Using fallback SESSION_SECRET for development.");
    sessionSecret = "dev-secret-change-in-production-minimum-32-chars";
  }

  const config: AuthConfig = {
    sessionSecret,
    sessionTtl: process.env.SESSION_TTL ? parseInt(process.env.SESSION_TTL, 10) : undefined,
    providers,
    defaultProvider,
  };

  const result = authConfigSchema.safeParse(config);
  if (!result.success) {
    console.error("Auth config validation errors:", result.error.format());
    throw new Error(`Invalid auth configuration: ${result.error.message}`);
  }

  return result.data as AuthConfig;
}

export function getProviderConfig<T extends ProviderConfig>(
  config: AuthConfig,
  type: T["type"]
): T | undefined {
  return config.providers.find((p) => p.type === type) as T | undefined;
}
