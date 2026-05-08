import { logger } from "../logger";

export type OktaPersona = "member" | "employer" | "staff";

interface OktaApiConfig {
  apiToken: string;
  issuerOrigin: string;
}

interface PersonaConfig {
  groupId?: string;
  userType?: string;
}

function getOktaApiConfig(issuerUrl: string): OktaApiConfig {
  const apiToken = process.env.OKTA_API_TOKEN;
  if (!apiToken) {
    throw new Error(
      "OKTA_API_TOKEN is not configured. It is required to create or link Okta users from Sirius."
    );
  }
  const u = new URL(issuerUrl);
  return {
    apiToken,
    issuerOrigin: `${u.protocol}//${u.host}`,
  };
}

export function isOktaProviderActive(): boolean {
  const v = process.env.AUTH_PROVIDER || "replit";
  return v
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .includes("okta");
}

export function getActiveOktaIssuerUrl(): string {
  const issuerUrl = process.env.OKTA_ISSUER_URL;
  if (!issuerUrl) {
    throw new Error(
      "OKTA_ISSUER_URL is not configured. Okta admin operations require it."
    );
  }
  return issuerUrl;
}

function readEnvTrim(name: string): string | undefined {
  const v = process.env[name];
  if (!v) return undefined;
  const t = v.trim();
  return t || undefined;
}

export function getPersonaConfig(persona: OktaPersona): PersonaConfig {
  const upper = persona.toUpperCase();
  const personaGroup = readEnvTrim(`OKTA_${upper}_GROUP_ID`);
  const personaType = readEnvTrim(`OKTA_${upper}_USER_TYPE`);

  if (persona === "member") {
    return {
      groupId: personaGroup || readEnvTrim("OKTA_NEW_USER_GROUP_ID"),
      userType: personaType || readEnvTrim("OKTA_NEW_USER_TYPE"),
    };
  }
  return { groupId: personaGroup, userType: personaType };
}

const userTypeIdCache = new Map<string, string>();

async function resolveUserTypeId(
  cfg: OktaApiConfig,
  value: string
): Promise<string> {
  const trimmed = value.trim();
  if (trimmed.startsWith("oty")) {
    return trimmed;
  }
  const cacheKey = `${cfg.issuerOrigin}|${trimmed.toLowerCase()}`;
  const cached = userTypeIdCache.get(cacheKey);
  if (cached) return cached;

  const types: any[] = await oktaApi(cfg, "/meta/types/user");
  const needle = trimmed.toLowerCase();
  const match = types.find(
    (t) =>
      typeof t?.name === "string" && t.name.toLowerCase() === needle ||
      typeof t?.displayName === "string" && t.displayName.toLowerCase() === needle
  );
  if (!match?.id) {
    throw new Error(
      `Okta user type "${trimmed}" not found. Available: ${types
        .map((t) => `${t.displayName} (${t.name})`)
        .join(", ")}`
    );
  }
  userTypeIdCache.set(cacheKey, match.id);
  return match.id;
}

async function oktaApi(
  cfg: OktaApiConfig,
  path: string,
  init: { method?: string; body?: any; headers?: Record<string, string> } = {}
): Promise<any> {
  const url = `${cfg.issuerOrigin}/api/v1${path}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `SSWS ${cfg.apiToken}`,
    ...(init.headers || {}),
  };
  let body: BodyInit | undefined;
  if (init.body !== undefined && init.body !== null) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  const response = await fetch(url, {
    method: init.method || "GET",
    headers,
    body,
  });
  const text = await response.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    const summary =
      (data && typeof data === "object" && data.errorSummary) ||
      (typeof data === "string" ? data : response.statusText);
    const err: any = new Error(`Okta API error ${response.status}: ${summary}`);
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
}

export interface OktaUserSummary {
  id: string;
  status: string;
  email: string;
}

/**
 * Look up an Okta user by login (email). Returns null on 404.
 */
export async function findOktaUserByLogin(
  issuerUrl: string,
  login: string
): Promise<OktaUserSummary | null> {
  const cfg = getOktaApiConfig(issuerUrl);
  try {
    const user = await oktaApi(cfg, `/users/${encodeURIComponent(login)}`);
    if (!user?.id) return null;
    return {
      id: user.id,
      status: user.status,
      email: user.profile?.email || login,
    };
  } catch (err: any) {
    if (err?.status === 404) return null;
    throw err;
  }
}

export interface CreateOktaUserArgs {
  issuerUrl: string;
  persona: OktaPersona;
  email: string;
  firstName: string;
  lastName: string;
}

/**
 * Creates a new Okta user in the persona's configured group / user type and
 * triggers Okta's activation email so the recipient sets their own password.
 */
export async function createOktaUserAndSendActivation(
  args: CreateOktaUserArgs
): Promise<OktaUserSummary> {
  const cfg = getOktaApiConfig(args.issuerUrl);
  const personaCfg = getPersonaConfig(args.persona);

  const body: any = {
    profile: {
      firstName: args.firstName,
      lastName: args.lastName,
      email: args.email,
      login: args.email,
    },
  };

  if (personaCfg.userType) {
    try {
      const typeId = await resolveUserTypeId(cfg, personaCfg.userType);
      body.type = { id: typeId };
    } catch (err) {
      logger.error("Failed to resolve Okta user type for persona", {
        persona: args.persona,
        value: personaCfg.userType,
        error: err,
      });
      throw err;
    }
  }

  const created = await oktaApi(cfg, "/users?activate=true", {
    method: "POST",
    body,
  });

  const oktaUserId: string = created?.id;
  if (!oktaUserId) {
    throw new Error("Okta user creation returned no id");
  }

  if (personaCfg.groupId) {
    try {
      await oktaApi(cfg, `/groups/${personaCfg.groupId}/users/${oktaUserId}`, {
        method: "PUT",
      });
    } catch (err) {
      logger.error("Failed to add new Okta user to persona group", {
        persona: args.persona,
        oktaUserId,
        groupId: personaCfg.groupId,
        error: err,
      });
      throw err;
    }
  } else {
    logger.warn(
      "No Okta group configured for persona; new user will not be added to a group and may lack OIDC app access",
      { persona: args.persona, oktaUserId }
    );
  }

  return {
    id: oktaUserId,
    status: created.status,
    email: created.profile?.email || args.email,
  };
}

export type OktaProvisionOutcome = "linked_existing" | "created_and_activated";

export interface LookupOrCreateResult {
  outcome: OktaProvisionOutcome;
  oktaUserId: string;
  email: string;
  status: string;
}

/**
 * Single entry point used by admin-driven credentialing flows for the
 * `employer` and `staff` personas (and reusable by `member`). If an Okta
 * user with the given login already exists, returns it untouched (no
 * activation email). Otherwise creates a new Okta user in the persona's
 * group / user type and triggers Okta's activation email.
 */
export async function lookupOrCreateOktaUserForPersona(args: {
  issuerUrl: string;
  persona: OktaPersona;
  email: string;
  firstName: string;
  lastName: string;
}): Promise<LookupOrCreateResult> {
  const existing = await findOktaUserByLogin(args.issuerUrl, args.email);
  if (existing) {
    return {
      outcome: "linked_existing",
      oktaUserId: existing.id,
      email: existing.email,
      status: existing.status,
    };
  }
  const created = await createOktaUserAndSendActivation(args);
  return {
    outcome: "created_and_activated",
    oktaUserId: created.id,
    email: created.email,
    status: created.status,
  };
}
