import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../../../storage";
import { requireComponent } from "../../components";
import { logger } from "../../../logger";
import { wcRequest } from "../../../services/webclient";
import type { T631FetchResult } from "../../../plugins/wc-vendors/plugins/sitespecific-t631";
import { WcVendorNoAssignedOperationError } from "../../../services/webclient/wc-vendor-context";
import { checkFlood, recordFloodEvent } from "../../../flood/service";
import {
  T631_ARRIVAL_IP_FLOOD_EVENT,
  T631_ARRIVAL_WORKER_FLOOD_EVENT,
} from "../../../flood/events";

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

const authenticationFailed = (workerIdInput: string): T631ArrivalResult => ({
  authenticated: false,
  message: `Authentication failed for worker [${workerIdInput}].`,
});

const providerConfigurationError = (): T631ArrivalResult => ({
  authenticated: false,
  message:
    "Configuration error: please make sure that there is a default provider for the operation sitespecific.t631.server_switch.authenticate.",
});

async function arrive(
  workerIdInput: string,
  token: string,
  ip: string,
): Promise<T631ArrivalResult> {
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

  const floodContext = { workerIdInput, ip };
  let limited = false;
  for (const eventName of [
    T631_ARRIVAL_WORKER_FLOOD_EVENT,
    T631_ARRIVAL_IP_FLOOD_EVENT,
  ]) {
    try {
      if (!(await checkFlood(eventName, floodContext)).allowed) {
        limited = true;
      }
    } catch (error) {
      logger.warn("T631 public arrival flood check failed; allowing authentication", {
        source: "sitespecific-t631-arrive",
        event: eventName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (limited) return authenticationFailed(workerIdInput);

  let authenticated = false;
  try {
    const result = await wcRequest({
      vendor: { any: true },
      operation: "sitespecific.t631.server_switch.authenticate",
      args: { worker_id: workerIdInput, token },
      mode: "force",
    });
    const remoteBody = result.value?.data;
    authenticated =
      remoteBody !== null &&
      typeof remoteBody === "object" &&
      !Array.isArray(remoteBody) &&
      (remoteBody as { data?: unknown }).data === true;

  } catch (error) {
    if (error instanceof WcVendorNoAssignedOperationError) {
      return providerConfigurationError();
    }
    logger.error("T631 public arrival authentication request failed", {
      source: "sitespecific-t631-arrive",
    });
  }

  if (!authenticated) {
    for (const eventName of [
      T631_ARRIVAL_WORKER_FLOOD_EVENT,
      T631_ARRIVAL_IP_FLOOD_EVENT,
    ]) {
      try {
        await recordFloodEvent(eventName, floodContext);
      } catch (error) {
        logger.warn("T631 public arrival flood recording failed", {
          source: "sitespecific-t631-arrive",
          event: eventName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return authenticationFailed(workerIdInput);
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
          await arrive(parsed.data.worker_id, parsed.data.token, req.ip || "unknown"),
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