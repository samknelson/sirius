import type { Express, Request, Response, NextFunction } from "express";
import { requireComponent } from "../../../components";
import { z } from "zod";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

interface T631Config {
  url: string;
  accountId: string;
  accessToken: string;
  employerId: string;
  employerToken: string;
}

interface T631FetchResult {
  success: boolean;
  action: string;
  data?: unknown;
  error?: string;
  timestamp: string;
  durationMs: number;
}

function getConfig(): T631Config {
  const url = process.env.SITESPECIFIC_T631_CLIENT_URL;
  const accountId = process.env.SITESPECIFIC_T631_CLIENT_ACCOUNT_ID;
  const accessToken = process.env.SITESPECIFIC_T631_CLIENT_ACCESS_TOKEN;
  const employerId = process.env.SITESPECIFIC_T631_CLIENT_EMPLOYER_ID;
  const employerToken = process.env.SITESPECIFIC_T631_CLIENT_EMPLOYER_TOKEN;

  if (!url || !accountId || !accessToken || !employerId || !employerToken) {
    const missing = [];
    if (!url) missing.push("SITESPECIFIC_T631_CLIENT_URL");
    if (!accountId) missing.push("SITESPECIFIC_T631_CLIENT_ACCOUNT_ID");
    if (!accessToken) missing.push("SITESPECIFIC_T631_CLIENT_ACCESS_TOKEN");
    if (!employerId) missing.push("SITESPECIFIC_T631_CLIENT_EMPLOYER_ID");
    if (!employerToken) missing.push("SITESPECIFIC_T631_CLIENT_EMPLOYER_TOKEN");
    throw new Error(`Missing T631 client configuration: ${missing.join(", ")}`);
  }

  return { url, accountId, accessToken, employerId, employerToken };
}

const VALID_ACTIONS = ["ping"] as const;
type T631Action = typeof VALID_ACTIONS[number];

export async function t631Fetch(action: T631Action, params?: Record<string, unknown>): Promise<T631FetchResult> {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  try {
    const config = getConfig();

    const requestBody: Record<string, unknown> = {
      action,
      account_id: config.accountId,
      access_token: config.accessToken,
      employer_id: config.employerId,
      employer_token: config.employerToken,
      ...params,
    };

    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    const durationMs = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unable to read response body");
      return {
        success: false,
        action,
        error: `HTTP ${response.status}: ${errorText}`,
        timestamp,
        durationMs,
      };
    }

    const data = await response.json().catch(() => null);

    return {
      success: true,
      action,
      data,
      timestamp,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    return {
      success: false,
      action,
      error: error instanceof Error ? error.message : "Unknown error",
      timestamp,
      durationMs,
    };
  }
}

const fetchRequestSchema = z.object({
  action: z.enum(VALID_ACTIONS),
  params: z.record(z.unknown()).optional(),
});

export function registerT631ClientFetchRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  requirePermission: PermissionMiddleware
) {
  const edlsComponent = requireComponent("edls");
  const t631Component = requireComponent("sitespecific.t631.client");

  app.post(
    "/api/sitespecific/t631/client/fetch",
    requireAuth,
    requirePermission("admin"),
    edlsComponent,
    t631Component,
    async (req: Request, res: Response) => {
      try {
        const parsed = fetchRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({
            message: `Invalid request: ${parsed.error.errors.map(e => e.message).join(", ")}`,
            validActions: [...VALID_ACTIONS],
          });
        }

        const { action, params } = parsed.data;
        const result = await t631Fetch(action, params);

        res.json(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to execute T631 fetch";
        res.status(500).json({ message });
      }
    }
  );
}
