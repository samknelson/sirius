import express, {
  type Express,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import { logger } from "../logger";
import {
  tryAcquireAppWriteFence,
  type AppWriteFenceLease,
} from "../services/s1-write-fence";

export type AcquireAppWriteFence = () => Promise<AppWriteFenceLease | undefined>;

const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const FENCE_LIFECYCLE = Symbol("s1-write-fence-lifecycle");
const WRAPPED_HANDLER = Symbol("s1-write-fence-wrapped-handler");
const PATCHED_REGISTRAR = Symbol("s1-write-fence-patched-registrar");

interface FenceRequest extends Request {
  [FENCE_LIFECYCLE]?: FenceLifecycle;
}

interface FenceLifecycle {
  lease: AppWriteFenceLease;
  pendingHandlers: number;
  responseTerminal: boolean;
  releaseStarted: boolean;
}

type AnyHandler = (...args: any[]) => unknown;

function maybeRelease(state: FenceLifecycle): void {
  if (
    state.releaseStarted ||
    !state.responseTerminal ||
    state.pendingHandlers !== 0
  ) {
    return;
  }
  state.releaseStarted = true;
  void state.lease.release().catch((error) =>
    logger.error("Failed to release S1 app write fence", {
      source: "s1-write-fence",
      error: error instanceof Error ? error.message : String(error),
    }),
  );
}

function trackHandlerResult(
  req: FenceRequest,
  res: Response,
  next: NextFunction,
  result: unknown,
): unknown {
  if (
    !result ||
    (typeof result !== "object" && typeof result !== "function") ||
    typeof (result as PromiseLike<unknown>).then !== "function"
  ) {
    return result;
  }
  const state = req[FENCE_LIFECYCLE];
  if (!state) return result;

  state.pendingHandlers++;
  Promise.resolve(result).then(
    () => {
      state.pendingHandlers--;
      maybeRelease(state);
    },
    (error) => {
      state.pendingHandlers--;
      maybeRelease(state);
      // Express 4 ignores returned promises. Forward an async rejection just
      // as Express 5 does, while preserving fence cleanup.
      next(error);
    },
  );
  return result;
}

function wrapHandler(handler: AnyHandler): AnyHandler {
  if ((handler as any)[WRAPPED_HANDLER]) return handler;

  const wrapped = handler.length === 4
    ? function (
        this: unknown,
        error: unknown,
        req: FenceRequest,
        res: Response,
        next: NextFunction,
      ) {
        return trackHandlerResult(
          req,
          res,
          next,
          handler.call(this, error, req, res, next),
        );
      }
    : function (
        this: unknown,
        req: FenceRequest,
        res: Response,
        next: NextFunction,
      ) {
        return trackHandlerResult(
          req,
          res,
          next,
          handler.call(this, req, res, next),
        );
      };
  Object.defineProperty(wrapped, WRAPPED_HANDLER, { value: true });
  return wrapped;
}

function wrapRegistrationArg(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(wrapRegistrationArg);
  if (typeof value !== "function") return value;
  // Mounted Express apps/routers track their own Route handlers; preserving
  // the callable object also preserves their `.handle`/`.stack` metadata.
  if ((value as any).handle && (value as any).stack) return value;
  return wrapHandler(value as AnyHandler);
}

function patchRegistrar(target: any, method: string): void {
  const original = target?.[method] as AnyHandler | undefined;
  if (!original || (original as any)[PATCHED_REGISTRAR]) return;
  const patched = function (this: unknown, ...args: unknown[]) {
    return original.apply(this, args.map(wrapRegistrationArg));
  };
  Object.defineProperty(patched, PATCHED_REGISTRAR, { value: true });
  target[method] = patched;
}

/**
 * Express 4 does not await promises returned by route handlers. Patch the
 * registration boundary once so the fence can observe those promises and, on
 * a client disconnect, keep its lease until in-flight async handler work has
 * actually settled. This covers direct app routes and mounted Routers without
 * a route allowlist.
 */
export function installS1WriteFenceHandlerTracking(app: Express): void {
  for (const method of [
    "all",
    "delete",
    "get",
    "head",
    "options",
    "patch",
    "post",
    "put",
  ]) {
    patchRegistrar((express as any).Route.prototype, method);
  }
  patchRegistrar(app, "use");
  patchRegistrar((express as any).Router, "use");
}

/**
 * Conservatively fence every mutating HTTP method before auth or route
 * handlers run. Reads remain available while a wet S1 sync owns the exclusive
 * side of the fence.
 */
export function createS1WriteFenceMiddleware(
  acquireFence: AcquireAppWriteFence = tryAcquireAppWriteFence,
): RequestHandler {
  return async (req, res, next) => {
    if (READ_ONLY_METHODS.has(req.method)) {
      next();
      return;
    }

    try {
      const lease = await acquireFence();
      if (!lease) {
        res.set("Retry-After", "60").status(503).json({
          message:
            "Updates are temporarily paused while the S1 sync runs. Please retry shortly.",
          code: "S1_SYNC_WRITE_FENCE",
        });
        return;
      }

      const state: FenceLifecycle = {
        lease,
        pendingHandlers: 0,
        responseTerminal: false,
        releaseStarted: false,
      };
      (req as FenceRequest)[FENCE_LIFECYCLE] = state;
      const markResponseTerminal = () => {
        state.responseTerminal = true;
        maybeRelease(state);
      };
      res.once("finish", markResponseTerminal);
      res.once("close", markResponseTerminal);
      next();
    } catch (error) {
      logger.error("Unable to check S1 app write fence", {
        source: "s1-write-fence",
        error: error instanceof Error ? error.message : String(error),
      });
      res.set("Retry-After", "60").status(503).json({
        message: "Updates are temporarily unavailable. Please retry shortly.",
        code: "S1_SYNC_WRITE_FENCE",
      });
    }
  };
}