import { logger } from "../logger";

export enum EventType {
  HOURS_SAVED = "hours.saved",
  PAYMENT_SAVED = "payment.saved",
  WMB_SAVED = "wmb.saved",
  PARTICIPANT_SAVED = "participant.saved",
  DISPATCH_DNC_SAVED = "dispatch.dnc.saved",
  CRON = "cron",
  LOG = "log",
}

export interface HoursSavedPayload {
  hoursId: string;
  workerId: string;
  employerId: string;
  year: number;
  month: number;
  day: number;
  hours: number;
  employmentStatusId: string;
  home: boolean;
}

export interface PaymentSavedPayload {
  paymentId: string;
  amount: string;
  status: string;
  ledgerEaId: string;
  accountId: string;
  entityType: string;
  entityId: string;
  dateCleared: Date | null;
  memo: string | null;
  paymentTypeId: string;
}

export interface WmbSavedPayload {
  wmbId: string;
  workerId: string;
  employerId: string;
  benefitId: string;
  year: number;
  month: number;
  isDeleted?: boolean;
}

export interface ParticipantSavedPayload {
  participantId: string;
  eventId: string;
  eventTypeId: string;
  contactId: string;
  role: string;
  status: string | null;
  workerId: string | null;
  isSteward: boolean;
}

export interface DispatchDncSavedPayload {
  dncId: string;
  workerId: string;
  employerId: string;
  type: string;
  isDeleted?: boolean;
}

export interface CronPayload {
  jobId: string;
  mode: "live" | "test";
}

export interface LogPayload {
  id: number;
  level: string | null;
  message: string | null;
  timestamp: Date | null;
  source: string | null;
  meta: unknown | null;
  module: string | null;
  operation: string | null;
  entityId: string | null;
  hostEntityId: string | null;
  description: string | null;
  userId: string | null;
  userEmail: string | null;
  ipAddress: string | null;
}

export interface EventPayloadMap {
  [EventType.HOURS_SAVED]: HoursSavedPayload;
  [EventType.PAYMENT_SAVED]: PaymentSavedPayload;
  [EventType.WMB_SAVED]: WmbSavedPayload;
  [EventType.PARTICIPANT_SAVED]: ParticipantSavedPayload;
  [EventType.DISPATCH_DNC_SAVED]: DispatchDncSavedPayload;
  [EventType.CRON]: CronPayload;
  [EventType.LOG]: LogPayload;
}

export type EventHandler<T extends EventType> = (payload: EventPayloadMap[T]) => Promise<void>;

interface RegisteredHandler {
  id: string;
  handler: (payload: any) => Promise<void>;
}

class EventBus {
  private handlers = new Map<EventType, RegisteredHandler[]>();
  private handlerIdCounter = 0;

  on<T extends EventType>(eventType: T, handler: EventHandler<T>): string {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    
    const handlerId = `handler_${++this.handlerIdCounter}`;
    this.handlers.get(eventType)!.push({
      id: handlerId,
      handler: handler as (payload: any) => Promise<void>,
    });
    
    logger.debug(`Event handler registered: ${handlerId} for ${eventType}`, {
      service: "event-bus",
    });
    
    return handlerId;
  }

  off(handlerId: string): boolean {
    const entries = Array.from(this.handlers.entries());
    for (const [eventType, handlers] of entries) {
      const index = handlers.findIndex((h: RegisteredHandler) => h.id === handlerId);
      if (index !== -1) {
        handlers.splice(index, 1);
        logger.debug(`Event handler unregistered: ${handlerId}`, {
          service: "event-bus",
        });
        return true;
      }
    }
    return false;
  }

  async emit<T extends EventType>(eventType: T, payload: EventPayloadMap[T]): Promise<void> {
    const handlers = this.handlers.get(eventType) || [];
    
    if (handlers.length === 0) {
      logger.debug(`No handlers for event: ${eventType}`, {
        service: "event-bus",
      });
      return;
    }

    logger.debug(`Emitting event: ${eventType} to ${handlers.length} handler(s)`, {
      service: "event-bus",
    });

    const results = await Promise.allSettled(
      handlers.map(({ id, handler }) => 
        handler(payload).catch(error => {
          logger.error(`Event handler ${id} failed for ${eventType}`, {
            service: "event-bus",
            handlerId: id,
            eventType,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        })
      )
    );

    const failures = results.filter(r => r.status === "rejected");
    if (failures.length > 0) {
      logger.warn(`${failures.length}/${handlers.length} handlers failed for event: ${eventType}`, {
        service: "event-bus",
      });
    }
  }

  getHandlerCount(eventType?: EventType): number {
    if (eventType) {
      return this.handlers.get(eventType)?.length || 0;
    }
    let total = 0;
    const allHandlers = Array.from(this.handlers.values());
    for (const handlers of allHandlers) {
      total += handlers.length;
    }
    return total;
  }
}

export const eventBus = new EventBus();
