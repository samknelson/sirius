import type { RequestHandler } from "express";
import { loadComponentCache } from "../services/component-cache";

/** Mounted at /api. Exempt only the exact read-only storage-status endpoint. */
export const refreshComponentStateForApi: RequestHandler = async (req, res, next) => {
  // Express also handles HEAD through the GET route and accepts a trailing slash.
  const isStatusRead = (req.method === "GET" || req.method === "HEAD") &&
    /^\/components\/config\/?$/i.test(req.path);
  if (isStatusRead) {
    next();
    return;
  }
  try {
    await loadComponentCache();
    next();
  } catch {
    res.status(503).json({ message: "Current component settings are unavailable. Please retry." });
  }
};
