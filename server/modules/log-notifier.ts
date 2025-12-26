import { eventBus, EventType, type LogPayload } from "../services/event-bus";
import { logger } from "../logger";
import { sendInapp } from "../services/inapp-sender";
import { storage } from "../storage";

const IGNORED_SOURCES = new Set([
  "log-notifier",
  "alert-dispatcher",
  "inapp-sender",
]);

type ReactionHandler = (payload: LogPayload) => Promise<void>;

interface Reaction {
  name: string;
  matches: (payload: LogPayload) => boolean;
  handle: ReactionHandler;
}

async function findUserForWorker(workerId: string): Promise<{ userId: string; contactId: string } | null> {
  const worker = await storage.workers.getWorker(workerId);
  if (!worker) {
    logger.debug("Worker not found for notification", { 
      source: "log-notifier", 
      workerId 
    });
    return null;
  }

  const contact = await storage.contacts.getContact(worker.contactId);
  if (!contact || !contact.email) {
    logger.debug("Worker contact has no email", { 
      source: "log-notifier", 
      workerId,
      contactId: worker.contactId 
    });
    return null;
  }

  const user = await storage.users.getUserByEmail(contact.email);
  if (!user) {
    logger.debug("No user found for worker contact email", { 
      source: "log-notifier", 
      workerId,
      email: contact.email 
    });
    return null;
  }

  return { userId: user.id, contactId: contact.id };
}

const stewardAssignmentReaction: Reaction = {
  name: "steward-assignment",
  matches: (payload) => {
    if (payload.module !== "worker-steward-assignments") return false;
    if (!payload.operation) return false;
    return ["createAssignment", "updateAssignment", "deleteAssignment"].includes(payload.operation);
  },
  handle: async (payload) => {
    if (!payload.hostEntityId) {
      logger.debug("Steward assignment log has no hostEntityId", {
        source: "log-notifier",
        logId: payload.id,
      });
      return;
    }

    const target = await findUserForWorker(payload.hostEntityId);
    if (!target) {
      return;
    }

    const result = await sendInapp({
      contactId: target.contactId,
      userId: target.userId,
      title: "Steward Assignment Update",
      body: payload.message || "Your steward assignment has been updated.",
      linkUrl: `/workers/${payload.hostEntityId}/union/steward`,
      linkLabel: "View Stewards",
      initiatedBy: "log-notifier",
    });

    if (result.success) {
      logger.debug("Steward assignment notification sent", {
        source: "log-notifier",
        userId: target.userId,
        workerId: payload.hostEntityId,
        commId: result.comm?.id,
      });
    } else {
      logger.warn("Failed to send steward assignment notification", {
        source: "log-notifier",
        userId: target.userId,
        workerId: payload.hostEntityId,
        error: result.error,
      });
    }
  },
};

const reactions: Reaction[] = [
  stewardAssignmentReaction,
];

async function handleLogEvent(payload: LogPayload): Promise<void> {
  if (payload.source && IGNORED_SOURCES.has(payload.source)) {
    return;
  }

  for (const reaction of reactions) {
    if (reaction.matches(payload)) {
      try {
        await reaction.handle(payload);
      } catch (error: any) {
        logger.error(`Reaction "${reaction.name}" failed`, {
          source: "log-notifier",
          reactionName: reaction.name,
          logId: payload.id,
          error: error?.message,
        });
      }
    }
  }
}

export function initLogNotifier(): void {
  eventBus.on(EventType.LOG, handleLogEvent);
  logger.info("Log notifier initialized", { source: "log-notifier" });
}
