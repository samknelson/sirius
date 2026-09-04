import { registerFloodEvent, floodEventRegistry } from "./registry";
import { FloodEventDefinition, FloodContext } from "./types";
import { storage } from "../storage";
import { logger } from "../logger";

/**
 * Quicksearch rate cap.
 *
 * Search-as-you-type is debounced client-side, but the endpoint is reachable
 * directly, and each request fans out into several database scans across every
 * searcher a user's roles allow. This bounds how often one person can pay that
 * cost. The threshold is deliberately generous — a person typing steadily for a
 * minute must never hit it — and the check FAILS OPEN, so a flood-store problem
 * degrades to an unthrottled search rather than a broken one.
 *
 * Tunable at runtime via the `flood_quicksearch` variable like every other
 * flood event; no migration needed, and expired rows are swept by the flood cron.
 */
export const QUICKSEARCH_FLOOD_EVENT = "quicksearch";

export const quicksearchFloodEvent: FloodEventDefinition = {
  name: QUICKSEARCH_FLOOD_EVENT,
  threshold: 120,
  windowSeconds: 60,
  getIdentifier: (context: FloodContext): string => {
    // Authenticated-only endpoint, so the user is the bucket. The IP fallback
    // exists so a missing session can never throw inside the rate check.
    const id = context.userId || context.ip;
    if (!id) {
      throw new Error("userId or ip is required for quicksearch flood event");
    }
    return id;
  },
  resolveIdentifierName: async (identifier: string): Promise<string | null> => {
    try {
      const user = await storage.users.getUser(identifier);
      if (!user) return null;
      return user.firstName && user.lastName
        ? `${user.firstName} ${user.lastName}`.trim()
        : user.email || null;
    } catch {
      return null;
    }
  },
};

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

/**
 * Immediate WMB scan rate caps. When a per-worker scan job is enqueued from an
 * event-driven trigger source, an "immediate scan" fast path may process it
 * right away instead of waiting for the 5-minute cron. Two caps bound that
 * fast path:
 *
 * - `wmb-immediate-scan`: global budget — at most `threshold` immediate scans
 *   per minute of clock time across ALL instances (the flood table is
 *   DB-backed, so multi-instance ECS shares one budget). Setting the
 *   threshold to 0 (via the `flood_wmb-immediate-scan` variable / flood-config
 *   UI) disables the fast path entirely, reverting to pure cron behavior.
 * - `wmb-immediate-scan-worker`: per-worker budget — a given worker is
 *   immediately scanned at most once per minute (identifier = worker id).
 *
 * Both fail OPEN toward the cron path: any error checking/recording means
 * "skip immediate, let the cron handle it" — never an error surfaced to the
 * request/event that caused the enqueue.
 */
export const WMB_IMMEDIATE_SCAN_FLOOD_EVENT = "wmb-immediate-scan";
export const WMB_IMMEDIATE_SCAN_WORKER_FLOOD_EVENT = "wmb-immediate-scan-worker";

export const wmbImmediateScanFloodEvent: FloodEventDefinition = {
  name: WMB_IMMEDIATE_SCAN_FLOOD_EVENT,
  threshold: 30,
  windowSeconds: 60,
  // One shared global bucket: the cap is on total immediate scans per minute.
  getIdentifier: (): string => "global",
};

export const wmbImmediateScanWorkerFloodEvent: FloodEventDefinition = {
  name: WMB_IMMEDIATE_SCAN_WORKER_FLOOD_EVENT,
  threshold: 1,
  windowSeconds: 60,
  getIdentifier: (context: FloodContext): string => {
    if (!context.workerId) {
      throw new Error("workerId is required for wmb-immediate-scan-worker flood event");
    }
    return context.workerId;
  },
  resolveIdentifierName: async (identifier: string): Promise<string | null> => {
    try {
      const worker = await storage.workers.getWorker(identifier);
      if (!worker) return null;
      return worker.siriusId != null ? `Worker #${worker.siriusId}` : identifier;
    } catch {
      return null;
    }
  },
};

/**
 * Public EDLS schedule answer throttle: the unauthenticated endpoint a worker
 * uses to accept or decline an assignment from the link they were texted.
 *
 * Bucketed by `scheduleId|ip` — the id in the schedule URL, whether or not it
 * resolves to anybody, plus the caller's address. Per-link bucketing is the
 * point: one worker (or someone hammering one worker's link) must not be able
 * to consume the budget of every other worker answering their own text at the
 * same time, which a single global or per-IP-only bucket would allow behind a
 * shared carrier NAT.
 *
 * EVERY attempt is recorded, not just refused ones: unlike a failed login, a
 * successful answer is a one-shot act, so a caller making many of them is
 * enumerating rather than working. Defaults: 30 attempts per link+IP per 15
 * minutes — ample for a worker answering a week of assignments and retrying —
 * tunable via the flood-config UI (`flood_edls-schedule-answer` variable).
 */
export const EDLS_SCHEDULE_ANSWER_FLOOD_EVENT = "edls-schedule-answer";

export const edlsScheduleAnswerFloodEvent: FloodEventDefinition = {
  name: EDLS_SCHEDULE_ANSWER_FLOOD_EVENT,
  threshold: 30,
  windowSeconds: 900,
  getIdentifier: (context: FloodContext): string => {
    if (!context.scheduleId || !context.ip) {
      throw new Error("scheduleId and ip are required for edls-schedule-answer flood event");
    }
    return `${context.scheduleId}|${context.ip}`;
  },
  resolveIdentifierName: async (identifier: string): Promise<string | null> => {
    const [scheduleId] = identifier.split("|");
    return scheduleId || null;
  },
};

export function registerFloodEvents(): void {
  registerFloodEvent(quicksearchFloodEvent);
  registerFloodEvent(bookmarkFloodEvent);
  registerFloodEvent(localLoginFloodEvent);
  registerFloodEvent(localPasswordChangeFloodEvent);
  registerFloodEvent(wmbImmediateScanFloodEvent);
  registerFloodEvent(wmbImmediateScanWorkerFloodEvent);
  registerFloodEvent(edlsScheduleAnswerFloodEvent);
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
        
        // Explicit 0 thresholds are valid (they disable the capped action),
        // so check numeric presence rather than truthiness.
        if (
          typeof config.threshold === "number" &&
          config.threshold >= 0 &&
          typeof config.windowSeconds === "number" &&
          config.windowSeconds > 0
        ) {
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
