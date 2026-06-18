import type { Express } from "express";
import { eventBus, EventType, EVENT_BUS_RING_BUFFER_CAP } from "../../services/event-bus";
import { requireAccess } from "../../services/access-policy-evaluator";
import { requireComponent } from "../components";

const COMPONENT_ID = "debug";

export function registerEventBusIntrospectRoutes(app: Express): void {
  app.get(
    "/api/admin/debug/event-bus/catalog",
    requireAccess("admin"),
    requireComponent(COMPONENT_ID),
    async (_req, res) => {
      const eventTypes = Object.values(EventType);
      const registry = eventBus.getRegistry();
      const handlers: Record<string, Array<{ id: string; name: string; description: string }>> = {};
      const handlerCounts: Record<string, number> = {};
      for (const et of eventTypes) {
        handlers[et] = registry[et] || [];
        handlerCounts[et] = handlers[et].length;
      }
      res.json({
        eventTypes,
        handlers,
        handlerCounts,
        ringBufferCap: EVENT_BUS_RING_BUFFER_CAP,
        excludedFromBuffer: [EventType.LOG],
      });
    },
  );

  app.get(
    "/api/admin/debug/event-bus/recent",
    requireAccess("admin"),
    requireComponent(COMPONENT_ID),
    async (req, res) => {
      const { eventType, limit } = req.query;
      let typedEventType: EventType | undefined;
      if (eventType && typeof eventType === "string") {
        const found = (Object.values(EventType) as string[]).includes(eventType);
        if (!found) {
          res.status(400).json({ message: `Unknown eventType: ${eventType}` });
          return;
        }
        typedEventType = eventType as EventType;
      }
      const limitNum = limit && typeof limit === "string" ? parseInt(limit, 10) : undefined;
      const entries = eventBus.getRecentEmits(typedEventType, limitNum);
      res.json({ entries });
    },
  );

  app.post(
    "/api/admin/debug/event-bus/clear",
    requireAccess("admin"),
    requireComponent(COMPONENT_ID),
    async (_req, res) => {
      eventBus.clearRecentEmits();
      res.json({ success: true });
    },
  );
}
