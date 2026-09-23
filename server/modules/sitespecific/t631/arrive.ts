import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../../../storage";
import { requireComponent } from "../../components";
import { logger } from "../../../logger";
import { wcRequest } from "../../../services/webclient";
import type { T631FetchResult } from "../../../plugins/wc-vendors/plugins/sitespecific-t631";

const arrivalRequestSchema = z.object({
  worker_id: z.string().refine((value) => value.trim().length > 0),
  token: z.string().refine((value) => value.trim().length > 0),
}).strict();

export interface T631ArrivalResult {
  authenticated: boolean;
  message: string;
}

async function resolveWorkerId(typeId: string, value: string): Promise<string | undefined> {
  const exact = await storage.workerIds.getWorkerIdByTypeAndValue(typeId, value);
  if (exact) return exact.workerId;

  const prefixed = await storage.workerIds.getWorkerIdByTypeAndValue(typeId, `I${value}`);
  if (prefixed) return prefixed.workerId;

  const normalized =
    await storage.workerIds.getWorkerIdsByTypeAndLeadingNonNumericPrefix(typeId, value);
  return normalized[0]?.workerId;
}

async function arrive(workerIdInput: string, token: string): Promise<T631ArrivalResult> {
  const typeId = await storage.workerIds.getTypeIdBySiriusId("t631");
  if (!typeId) {
    return {
      authenticated: false,
      message: "The T631 worker ID type does not exist on this server.",
    };
  }

  const workerId = await resolveWorkerId(typeId, workerIdInput);
  if (!workerId) {
    return {
      authenticated: false,
      message: `The worker with id [${workerIdInput}] does not exist on this server.`,
    };
  }

  try {
    const result = await wcRequest({
      vendor: { any: true },
      operation: "sitespecific.t631.server_switch.authenticate",
      args: { worker_id: workerIdInput, token },
      mode: "force",
    });
    const remoteBody = result.value?.data;
    const authenticated =
      remoteBody !== null &&
      typeof remoteBody === "object" &&
      !Array.isArray(remoteBody) &&
      (remoteBody as { data?: unknown }).data === true;

    if (!authenticated) {
      return {
        authenticated: false,
        message: `Authentication failed for worker [${workerIdInput}].`,
      };
    }
  } catch {
    logger.error("T631 public arrival authentication request failed", {
      source: "sitespecific-t631-arrive",
    });
    return {
      authenticated: false,
      message: `Authentication failed for worker [${workerIdInput}].`,
    };
  }

  const workerName = await storage.workers.getWorkerDisplayName(workerId);
  return {
    authenticated: true,
    message: `Showing schedule for worker [${workerName}].`,
  };
}

export function registerT631ArrivalRoutes(app: Express): void {
  const t631Component = requireComponent("sitespecific.t631.client");

  app.get(
    "/sitespecific/t631/arrive",
    t631Component,
    (_req: Request, res: Response, next: NextFunction) => {
      res.setHeader("Referrer-Policy", "no-referrer");
      next();
    },
  );

  app.post(
    "/api/public/sitespecific/t631/arrive",
    t631Component,
    async (req: Request, res: Response) => {
      const parsed = arrivalRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(200).json({
          authenticated: false,
          message: "A worker ID and token are required.",
        } satisfies T631ArrivalResult);
        return;
      }

      try {
        res.status(200).json(
          await arrive(parsed.data.worker_id, parsed.data.token),
        );
      } catch {
        logger.error("T631 public arrival lookup failed", {
          source: "sitespecific-t631-arrive",
        });
        res.status(200).json({
          authenticated: false,
          message: `Authentication failed for worker [${parsed.data.worker_id}].`,
        } satisfies T631ArrivalResult);
      }
    },
  );
}