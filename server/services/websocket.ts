import { WebSocket, WebSocketServer } from "ws";
import type { Server } from "http";
import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import { logger } from "../logger";
import { hasTrustedExplicitOrigin } from "../middleware/browser-request-protection";
import { onSessionAuthorityEnded, sessionSocketIdentity } from "../auth/socket-authority";
import { runOutsideTransaction } from "../storage/transaction-context";
import { currentSessionAccounts, withRequestAccounts } from "../auth/account-authority";

interface SocketAuthority {
  sid: string;
  ownerId: string;
  userId: string;
  generation: unknown;
  store: { get(sid: string, callback: (error: unknown, sess?: any) => void): void };
}

interface UserConnection extends SocketAuthority {
  ws: WebSocket;
  lastPing: number;
  active: boolean;
  unsubscribe: () => void;
}

interface AlertUpdateMessage {
  type: "alert_update";
  payload: {
    unreadCount: number;
  };
}

interface NotificationSummaryMessage {
  type: "notification_summary";
  id: string;
  payload: {
    counts: Partial<Record<"email" | "sms" | "inapp" | "postal", number>>;
  };
}

interface BadgeGrantMessage {
  type: "badge_granted";
  payload: { badgeName: string };
}

type WebSocketMessage = AlertUpdateMessage | NotificationSummaryMessage | BadgeGrantMessage;

const connections: Map<string, Set<UserConnection>> = new Map();
let wss: WebSocketServer | null = null;
let pingInterval: NodeJS.Timeout | null = null;
let removeUpgradeListener: (() => void) | null = null;

type ConnectionListener = (userId: string) => void;
const connectionListeners: Set<ConnectionListener> = new Set();

type AckListener = (userId: string, id: string) => void;
const ackListeners: Set<AckListener> = new Set();

/**
 * Register a callback fired whenever a client acknowledges receipt of a
 * notification-summary message (by id). The flash-summary outbox uses this to
 * stop re-sending a summary once the browser has actually rendered its toast —
 * a socket being server-OPEN is not proof the client received the message, so
 * delivery is confirmed by an explicit client ack rather than by send() alone.
 */
export function onNotificationSummaryAck(listener: AckListener): void {
  ackListeners.add(listener);
}

function notifyAckListeners(userId: string, id: string): void {
  ackListeners.forEach((listener) => {
    try {
      listener(userId, id);
    } catch (error) {
      logger.error("WebSocket ack listener failed", {
        service: "websocket",
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

/**
 * Register a callback fired whenever a user establishes a new authenticated
 * socket. Used by the flash-summary buffer to replay a toast that could not be
 * delivered while the user was momentarily disconnected. Listeners are held in
 * module-level state, so registration order relative to {@link initializeWebSocket}
 * does not matter.
 */
export function onUserConnected(listener: ConnectionListener): void {
  connectionListeners.add(listener);
}

function notifyConnectionListeners(userId: string): void {
  connectionListeners.forEach((listener) => {
    try {
      listener(userId);
    } catch (error) {
      logger.error("WebSocket connection listener failed", {
        service: "websocket",
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

const PING_INTERVAL = 30000;
const CONNECTION_TIMEOUT = 60000;

export function initializeWebSocket(
  server: Server,
  sessionMiddleware: any
): WebSocketServer {
  // The automatic { server, path } listener rejects other listeners' paths.
  // Own only /ws, in every environment; Vite HMR keeps its own upgrade path.
  const appWss = new WebSocketServer({ noServer: true, path: "/ws" });
  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (req.url?.split("?")[0] !== "/ws") return;
    // This session-authorized endpoint requires an explicit canonical Origin
    // even for non-browser clients. No Referer, Host, forwarded-header, or
    // missing-Origin exemption: Origin is a browser boundary, not client auth.
    if (!hasTrustedExplicitOrigin(req.headers.origin)) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    appWss.handleUpgrade(req, socket, head, (ws) => {
      appWss.emit("connection", ws, req);
    });
  };
  server.on("upgrade", onUpgrade);
  removeUpgradeListener = () => server.off("upgrade", onUpgrade);
  wss = appWss;

  wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
    // Install handlers before asynchronous sign-in checks. A peer may disappear
    // while the session store is answering; never register it afterwards.
    let connection: UserConnection | undefined;
    ws.on("close", () => {
      if (connection) removeConnection(connection.userId, connection);
    });
    ws.on("error", () => {
      if (connection) removeConnection(connection.userId, connection);
    });
    try {
      const authority = await authenticateConnection(req, sessionMiddleware);
      
      if (!authority || ws.readyState !== WebSocket.OPEN) {
        ws.close(4001, "Unauthorized");
        return;
      }

      const userId = authority.userId;
      const established: UserConnection = {
        ...authority,
        ws,
        lastPing: Date.now(),
        active: true,
        unsubscribe: () => {},
      };
      connection = established;
      established.unsubscribe = onSessionAuthorityEnded(authority.sid, () => {
        refuseConnection(established);
      });

      // Read again after subscribing, covering revocation during restoration.
      if (!await validateConnection(established) || !established.active || wss !== appWss) {
        refuseConnection(established);
        return;
      }
      addConnection(userId, established);
      logger.debug("WebSocket connection established", { 
        service: "websocket",
        userId 
      });

      ws.on("message", async (data) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === "pong") {
            // Transport liveness is not authenticated activity.
            established.lastPing = Date.now();
          } else if (
            message.type === "notification_summary_ack" &&
            typeof message.id === "string" &&
            await validateConnection(established) && established.active
          ) {
            // The client confirmed it rendered this summary; let the outbox
            // drop it so it is not re-sent on the next reconnect.
            notifyAckListeners(userId, message.id);
          }
        } catch {
          // Ignore invalid messages
        }
      });

      ws.on("close", () => {
        removeConnection(userId, established);
        logger.debug("WebSocket connection closed", { 
          service: "websocket",
          userId 
        });
      });

      ws.on("error", (error) => {
        logger.error("WebSocket error", {
          service: "websocket",
          userId,
          error: error.message,
        });
        removeConnection(userId, established);
      });

      ws.send(JSON.stringify({ type: "connected" }));

      // The socket is now OPEN and the client's message handler is live; let
      // listeners (e.g. the flash-summary buffer) replay anything that could
      // not be delivered while this user was disconnected.
      notifyConnectionListeners(userId);

    } catch (error) {
      logger.error("Failed to establish WebSocket connection", {
        service: "websocket",
        error: error instanceof Error ? error.message : String(error),
      });
      ws.close(4000, "Connection error");
    }
  });

  pingInterval = setInterval(() => {
    const now = Date.now();
    connections.forEach((userConnections, userId) => {
      userConnections.forEach((connection) => {
        if (now - connection.lastPing > CONNECTION_TIMEOUT) {
          // Forcibly destroy an unresponsive socket instead of a graceful
          // close(): a half-open connection never completes the closing
          // handshake, so close() can leave a zombie in the OPEN state that
          // silently swallows sends. terminate() drops it immediately.
          connection.ws.terminate();
          removeConnection(userId, connection);
        } else if (connection.ws.readyState === WebSocket.OPEN) {
          void validateConnection(connection).then(valid => {
            if (valid && connection.active && connection.ws.readyState === WebSocket.OPEN) {
              connection.ws.send(JSON.stringify({ type: "ping" }));
            }
          });
        }
      });
    });
  }, PING_INTERVAL);

  logger.info("WebSocket server initialized", { service: "websocket" });
  return wss;
}

function authenticateConnection(
  req: IncomingMessage,
  sessionMiddleware: any
): Promise<SocketAuthority | null> {
  return new Promise((resolve, reject) => {
    const mockRes = {
      setHeader: () => {},
      end: () => {},
    };

    sessionMiddleware(req, mockRes, (error?: unknown) => {
      if (error) return reject(error);
      const session = (req as any).session;
      const identity = sessionSocketIdentity(session);
      const sid = (req as any).sessionID;
      const store = (req as any).sessionStore;
      if (!identity || !sid || !store?.get) return resolve(null);
      resolve({ ...identity, sid, store, generation: session._socketAuthorityVersion ?? null });
    });
  });
}

function refuseConnection(connection: UserConnection): void {
  removeConnection(connection.userId, connection);
  connection.ws.close(4001, "Session ended");
}

/** Re-read persisted authority, never touch/renew it or trust a client pong. */
async function validateConnection(connection: UserConnection): Promise<boolean> {
  if (!connection.active || connection.ws.readyState !== WebSocket.OPEN) return false;
  try {
    const sess = await runOutsideTransaction(() => new Promise<any>((resolve, reject) => {
      connection.store.get(connection.sid, (error, value) => error ? reject(error) : resolve(value));
    }));
    const identity = sessionSocketIdentity(sess);
    const expiresAt = sess?.passport?.user?.expires_at;
    const cookieExpires = sess?.cookie?.expires;
    if (
      !identity || identity.ownerId !== connection.ownerId || identity.userId !== connection.userId ||
      (sess?._socketAuthorityVersion ?? null) !== connection.generation ||
      (expiresAt != null && (!Number.isFinite(Number(expiresAt)) || Date.now() >= Number(expiresAt) * 1000)) ||
      (cookieExpires != null && (!Number.isFinite(Date.parse(cookieExpires)) || Date.now() >= Date.parse(cookieExpires)))
    ) {
      refuseConnection(connection);
      return false;
    }
    // Each delivery observes live database state, not the HTTP request's cache.
    const authority = await withRequestAccounts(() => currentSessionAccounts(sess));
    if (!authority) {
      refuseConnection(connection);
      return false;
    }
    return connection.active && connection.ws.readyState === WebSocket.OPEN;
  } catch {
    // A failed authority read is not permission to deliver private data.
    refuseConnection(connection);
    return false;
  }
}

function addConnection(userId: string, connection: UserConnection): void {
  if (!connections.has(userId)) {
    connections.set(userId, new Set());
  }
  connections.get(userId)!.add(connection);
}

function removeConnection(userId: string, connection: UserConnection): void {
  connection.active = false;
  connection.unsubscribe();
  const userConnections = connections.get(userId);
  if (userConnections) {
    userConnections.delete(connection);
    if (userConnections.size === 0) {
      connections.delete(userId);
    }
  }
}

/**
 * Send `message` to every OPEN socket the user currently has. Returns true if
 * the message was handed to at least one open socket, false if the user has no
 * open connection right now (nothing was delivered). Callers that need a
 * delivery guarantee (e.g. the flash-summary toast) use the return value to
 * decide whether to retain and replay the message when the user reconnects.
 */
export async function broadcastToUser(userId: string, message: WebSocketMessage): Promise<boolean> {
  const userConnections = connections.get(userId);
  if (!userConnections || userConnections.size === 0) {
    return false;
  }

  const messageStr = JSON.stringify(message);
  let delivered = false;
  await Promise.all([...userConnections].map(async (connection) => {
    if (await validateConnection(connection) && connection.active && connection.ws.readyState === WebSocket.OPEN) {
      try {
        connection.ws.send(messageStr);
        delivered = true;
      } catch (error) {
        logger.error("Failed to send WebSocket message", {
          service: "websocket",
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }));
  return delivered;
}

export function broadcastAlertUpdate(userId: string, unreadCount: number): Promise<boolean> {
  return broadcastToUser(userId, {
    type: "alert_update",
    payload: { unreadCount },
  });
}

/** One-shot feedback only: disconnected browsers silently miss this flash. */
export function broadcastBadgeGrant(userId: string, badgeName: string): Promise<boolean> {
  return broadcastToUser(userId, {
    type: "badge_granted",
    payload: { badgeName },
  });
}

/**
 * Flash a summary of notifications that a user's action just triggered back to
 * that user (e.g. "3 by SMS, 2 by email"). Delivered over the per-user channel
 * as a message type distinct from alert-count updates so the client can render
 * it as a one-off toast without touching the alert badge. Returns whether it
 * reached an open socket so the caller can retain and replay it on reconnect.
 */
export function broadcastNotificationSummary(
  userId: string,
  id: string,
  counts: Partial<Record<"email" | "sms" | "inapp" | "postal", number>>,
): Promise<boolean> {
  return broadcastToUser(userId, {
    type: "notification_summary",
    id,
    payload: { counts },
  });
}

export function getConnectionCount(): number {
  let count = 0;
  connections.forEach((userConnections) => {
    count += userConnections.size;
  });
  return count;
}

export function getUserConnectionCount(userId: string): number {
  return connections.get(userId)?.size ?? 0;
}

export function shutdown(): void {
  removeUpgradeListener?.();
  removeUpgradeListener = null;
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
  
  if (wss) {
    connections.forEach((userConnections) => {
      userConnections.forEach((connection) => {
        removeConnection(connection.userId, connection);
        connection.ws.close(1001, "Server shutting down");
      });
    });
    connections.clear();
    // Includes peers still waiting for their initial session lookup.
    wss.clients.forEach(ws => ws.close(1001, "Server shutting down"));
    wss.close();
    wss = null;
  }
  
  logger.info("WebSocket server shut down", { service: "websocket" });
}
