import type { Express } from "express";
import { eventBus, EventType, getEventTypes, type EventName, EVENT_BUS_RING_BUFFER_CAP } from "../../../../server/services/event-bus";
import { requireAccess } from "../../../../server/services/access-policy-evaluator";
import { requireComponent } from "../../../../server/modules/components";

const COMPONENT_ID = "debug";

export function registerEventBusIntrospectRoutes(app: Express): void {
  app.get(
    "/api/admin/debug/event-bus/catalog",
    requireAccess("admin"),
    requireComponent(COMPONENT_ID),
    async (_req, res) => {
      const eventTypes = getEventTypes();
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
      let typedEventType: EventName | undefined;
      if (eventType && typeof eventType === "string") {
        const found = (getEventTypes() as string[]).includes(eventType);
        if (!found) {
          res.status(400).json({ message: `Unknown eventType: ${eventType}` });
          return;
        }
        typedEventType = eventType as EventName;
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
