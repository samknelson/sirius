import { logger } from "../logger";

interface OktaApiConfig {
  apiToken: string;
  issuerOrigin: string;
  newUserGroupId?: string;
  newUserType?: string;
}

function getOktaApiConfig(issuerUrl: string): OktaApiConfig {
  const apiToken = process.env.OKTA_API_TOKEN;
  if (!apiToken) {
    throw new Error(
      "OKTA_API_TOKEN is not configured. It is required to create Okta users from Sirius."
    );
  }
  const u = new URL(issuerUrl);
  return {
    apiToken,
    issuerOrigin: `${u.protocol}//${u.host}`,
    newUserGroupId: process.env.OKTA_NEW_USER_GROUP_ID || undefined,
    newUserType: process.env.OKTA_NEW_USER_TYPE?.trim() || undefined,
  };
}

const userTypeIdCache = new Map<string, string>();

/**
 * Resolves an Okta user type to its id. Accepts either the id directly
 * (recognized by the `oty` prefix) or a name/displayName lookup against
 * /api/v1/meta/types/user. Results are cached per (issuerOrigin, value).
 */
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

export interface CreateOktaUserArgs {
  issuerUrl: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface CreatedOktaUser {
  id: string;
  status: string;
  email: string;
}

/**
 * Creates an Okta user via the Users API and triggers Okta's activation
 * email so the worker can set their password through Okta's hosted
 * activation flow. If OKTA_NEW_USER_GROUP_ID is set, the new user is added
 * to that group (which must already be assigned to the OIDC app so they
 * can sign in afterwards).
 */
export async function createOktaUserAndSendActivation(
  args: CreateOktaUserArgs
): Promise<CreatedOktaUser> {
  const cfg = getOktaApiConfig(args.issuerUrl);

  const body: any = {
    profile: {
      firstName: args.firstName,
      lastName: args.lastName,
      email: args.email,
      login: args.email,
    },
  };

  if (cfg.newUserType) {
    try {
      const typeId = await resolveUserTypeId(cfg, cfg.newUserType);
      body.type = { id: typeId };
    } catch (err) {
      logger.error("Failed to resolve OKTA_NEW_USER_TYPE", {
        value: cfg.newUserType,
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

  if (cfg.newUserGroupId) {
    try {
      await oktaApi(cfg, `/groups/${cfg.newUserGroupId}/users/${oktaUserId}`, {
        method: "PUT",
      });
    } catch (err) {
      logger.error(
        "Failed to add new Okta user to OKTA_NEW_USER_GROUP_ID group",
        {
          oktaUserId,
          groupId: cfg.newUserGroupId,
          error: err,
        }
      );
      throw err;
    }
  } else {
    logger.warn(
      "OKTA_NEW_USER_GROUP_ID not set; new Okta user will not be added to any group and may not have access to the OIDC app",
      { oktaUserId }
    );
  }

  return {
    id: oktaUserId,
    status: created.status,
    email: created.profile?.email || args.email,
  };
}
