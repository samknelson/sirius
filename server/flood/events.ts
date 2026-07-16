import { registerFloodEvent, floodEventRegistry } from "./registry";
import { FloodEventDefinition, FloodContext } from "./types";
import { storage } from "../storage";
import { logger } from "../logger";

export const bookmarkFloodEvent: FloodEventDefinition = {
  name: "bookmark",
  threshold: 1000,
  windowSeconds: 360,
  getIdentifier: (context: FloodContext): string => {
    if (!context.userId) {
      throw new Error("userId is required for bookmark flood event");
    }
    return context.userId;
  },
  resolveIdentifierName: async (identifier: string): Promise<string | null> => {
    try {
      const user = await storage.users.getUser(identifier);
      if (user) {
        return user.firstName && user.lastName 
          ? `${user.firstName} ${user.lastName}`.trim()
          : user.email || null;
      }
      return null;
    } catch {
      return null;
    }
  },
};

/**
 * Event-notifier flood protection.
 *
 * A single admin action (e.g. a bulk grievance update) can fan out into many
 * per-recipient notifications. To stop any one person being buried under a
 * runaway burst, the event-notifier dispatcher checks these flood events before
 * every send. There is one event per medium so email / in-app / SMS / postal
 * are throttled independently (and can be tuned to different limits). The bucket
 * identifier is `contactId|pluginId`, so counts are also isolated per recipient
 * and per notifier plugin: one plugin's burst to one person can't consume
 * another plugin's or another person's budget.
 *
 * Defaults: 20 sends per recipient, per plugin, per medium, per hour. Admins can
 * override each via the flood-config UI (persisted as `flood_<name>` variables).
 */
export const NOTIFICATION_FLOOD_EVENTS = {
  email: "notification-email",
  inapp: "notification-inapp",
  sms: "notification-sms",
  postal: "notification-postal",
} as const;

const NOTIFICATION_FLOOD_DEFAULT_THRESHOLD = 20;
const NOTIFICATION_FLOOD_DEFAULT_WINDOW_SECONDS = 3600;

/**
 * Resolve a `contactId|pluginId` identifier to a human-readable label for the
 * flood-events admin viewer: the recipient's contact name plus the notifier
 * plugin's display name. The plugin registry is imported lazily to avoid any
 * boot-time load-order coupling between the flood and plugin subsystems.
 */
async function resolveNotificationIdentifierName(
  identifier: string,
): Promise<string | null> {
  const [contactId, pluginId] = identifier.split("|");
  let contactLabel: string | null = null;
  try {
    if (contactId) {
      const contact = await storage.contacts.getContact(contactId);
      contactLabel = contact?.displayName || contact?.email || null;
    }
  } catch {
    contactLabel = null;
  }

  let pluginLabel: string | null = null;
  try {
    if (pluginId) {
      const { eventNotifierRegistry } = await import(
        "../plugins/event-notifier/registry"
      );
      pluginLabel = eventNotifierRegistry.get(pluginId)?.name ?? pluginId;
    }
  } catch {
    pluginLabel = pluginId || null;
  }

  const parts = [contactLabel, pluginLabel].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function makeNotificationFloodEvent(name: string): FloodEventDefinition {
  return {
    name,
    threshold: NOTIFICATION_FLOOD_DEFAULT_THRESHOLD,
    windowSeconds: NOTIFICATION_FLOOD_DEFAULT_WINDOW_SECONDS,
    getIdentifier: (context: FloodContext): string => {
      if (!context.contactId || !context.pluginId) {
        throw new Error(
          `contactId and pluginId are required for flood event "${name}"`,
        );
      }
      return `${context.contactId}|${context.pluginId}`;
    },
    resolveIdentifierName: resolveNotificationIdentifierName,
  };
}

export const notificationFloodEvents: FloodEventDefinition[] = Object.values(
  NOTIFICATION_FLOOD_EVENTS,
).map(makeNotificationFloodEvent);

/**
 * Local email+password login throttle. Bucketed by email|ip so an attacker
 * hammering one account from one address is cut off without locking out the
 * real user coming from a different address. Only FAILED attempts are
 * recorded (recordFloodEvent is called on failure paths in the local auth
 * provider), so normal successful logins never consume budget.
 * Defaults: 10 failed attempts per email+IP per 15 minutes; admins can tune
 * via the flood-config UI (`flood_local-login` variable).
 */
export const LOCAL_LOGIN_FLOOD_EVENT = "local-login";

export const localLoginFloodEvent: FloodEventDefinition = {
  name: LOCAL_LOGIN_FLOOD_EVENT,
  threshold: 10,
  windowSeconds: 900,
  getIdentifier: (context: FloodContext): string => {
    if (!context.email || !context.ip) {
      throw new Error("email and ip are required for local-login flood event");
    }
    return `${context.email}|${context.ip}`;
  },
  resolveIdentifierName: async (identifier: string): Promise<string | null> => {
    const [email] = identifier.split("|");
    return email || null;
  },
};

/**
 * Self-service local password change throttle. Bucketed by userId|ip. Only
 * FAILED current-password verifications are recorded, so legitimate changes
 * never consume budget. Defaults: 10 failed attempts per user+IP per 15
 * minutes; tunable via the flood-config UI (`flood_local-password-change`
 * variable).
 */
export const LOCAL_PASSWORD_CHANGE_FLOOD_EVENT = "local-password-change";

export const localPasswordChangeFloodEvent: FloodEventDefinition = {
  name: LOCAL_PASSWORD_CHANGE_FLOOD_EVENT,
  threshold: 10,
  windowSeconds: 900,
  getIdentifier: (context: FloodContext): string => {
    if (!context.userId || !context.ip) {
      throw new Error("userId and ip are required for local-password-change flood event");
    }
    return `${context.userId}|${context.ip}`;
  },
  resolveIdentifierName: async (identifier: string): Promise<string | null> => {
    const [userId] = identifier.split("|");
    return userId || null;
  },
};

export function registerFloodEvents(): void {
  registerFloodEvent(bookmarkFloodEvent);
  registerFloodEvent(localLoginFloodEvent);
  registerFloodEvent(localPasswordChangeFloodEvent);
  for (const event of notificationFloodEvents) {
    registerFloodEvent(event);
  }
}

export async function loadFloodConfigFromVariables(): Promise<void> {
  const definitions = floodEventRegistry.getAllDefinitions();
  
  for (const def of definitions) {
    const variableName = `flood_${def.name}`;
    try {
      const variable = await storage.variables.getByName(variableName);
      if (variable?.value) {
        const config = typeof variable.value === 'string' 
          ? JSON.parse(variable.value) 
          : variable.value;
        
        if (config.threshold && config.windowSeconds) {
          floodEventRegistry.updateConfig(def.name, config.threshold, config.windowSeconds);
          logger.info(`Loaded custom flood config for "${def.name}"`, {
            service: 'flood-config',
            threshold: config.threshold,
            windowSeconds: config.windowSeconds,
          });
        }
      }
    } catch (error) {
      logger.warn(`Failed to load flood config for "${def.name}"`, {
        service: 'flood-config',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
