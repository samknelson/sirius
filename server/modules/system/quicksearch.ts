import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { QUICKSEARCH_MIN_QUERY_LENGTH } from "@shared/quicksearch";
import { getEffectiveUser } from "../masquerade";
import { runQuicksearch, userHasQuicksearch } from "../../plugins/quicksearch";
import { checkFlood, recordFloodEvent } from "../../flood/service";
import { QUICKSEARCH_FLOOD_EVENT } from "../../flood/events";
import { logger } from "../../logger";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

const searchBodySchema = z.object({
  // A search term is user content: it belongs in the body, never in a URL that
  // ends up in access logs, browser history or a Referer header. An SSN or a
  // worker's name is exactly the sort of string that must not be logged as a
  // side effect of searching for it.
  q: z.string().max(200),
});

export function registerQuicksearchRoutes(app: Express, requireAuth: AuthMiddleware): void {
  /**
   * Whether to offer the search control at all. Cheap and side-effect free, so
   * it is not rate limited — it does not touch record data.
   */
  app.get("/api/quicksearch/available", requireAuth, async (req, res) => {
    try {
      const { dbUser } = await getEffectiveUser(req.session as any, req.user as any);
      if (!dbUser) return res.status(401).json({ message: "Not authenticated" });
      res.json({ available: await userHasQuicksearch(dbUser) });
    } catch (error) {
      logger.error("Failed to resolve quicksearch availability", {
        service: "quicksearch",
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ message: "Failed to resolve quicksearch availability" });
    }
  });

  app.post("/api/quicksearch", requireAuth, async (req, res) => {
    try {
      const parsed = searchBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "A search term is required" });
      }

      const { dbUser } = await getEffectiveUser(req.session as any, req.user as any);
      if (!dbUser) return res.status(401).json({ message: "Not authenticated" });

      // Rate cap. Fails OPEN: if the flood store is unavailable the search
      // still runs, because a rate limiter breaking must not break search.
      try {
        const flood = await checkFlood(QUICKSEARCH_FLOOD_EVENT, {
          userId: dbUser.id,
          ip: req.ip,
        });
        if (!flood.allowed) {
          return res.status(429).json({
            message: "Too many searches. Wait a moment and try again.",
          });
        }
        await recordFloodEvent(QUICKSEARCH_FLOOD_EVENT, { userId: dbUser.id, ip: req.ip });
      } catch (floodError) {
        logger.warn("Quicksearch flood check failed; allowing the search", {
          service: "quicksearch",
          error: floodError instanceof Error ? floodError.message : String(floodError),
        });
      }

      const query = parsed.data.q.trim();
      if (query.length < QUICKSEARCH_MIN_QUERY_LENGTH) {
        return res.json({ query, groups: [], failures: [] });
      }

      // Every access decision (which searchers run, and which of their options
      // are permitted) is made inside the runner from the effective user's own
      // roles and permissions. Nothing in the request selects a searcher.
      res.json(await runQuicksearch(dbUser, query));
    } catch (error) {
      // The query itself is deliberately absent from this log line.
      logger.error("Quicksearch failed", {
        service: "quicksearch",
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ message: "Search failed" });
    }
  });
}
