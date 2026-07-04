import { WebSocket, WebSocketServer } from "ws";
import type { Server } from "http";
import type { IncomingMessage } from "http";
import { parse as parseCookie } from "cookie";
import { logger } from "../logger";

interface UserConnection {
  userId: string;
  ws: WebSocket;
  lastPing: number;
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

type WebSocketMessage = AlertUpdateMessage | NotificationSummaryMessage;

const connections: Map<string, Set<UserConnection>> = new Map();
let wss: WebSocketServer | null = null;
let pingInterval: NodeJS.Timeout | null = null;

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
  wss = new WebSocketServer({ 
    server,
    path: "/ws"
  });

  wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
    try {
      const userId = await authenticateConnection(req, sessionMiddleware);
      
      if (!userId) {
        ws.close(4001, "Unauthorized");
        return;
      }

      const connection: UserConnection = {
        userId,
        ws,
        lastPing: Date.now(),
      };

      addConnection(userId, connection);
      logger.debug("WebSocket connection established", { 
        service: "websocket",
        userId 
      });

      ws.on("message", (data) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === "pong") {
            connection.lastPing = Date.now();
          } else if (
            message.type === "notification_summary_ack" &&
            typeof message.id === "string"
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
        removeConnection(userId, connection);
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
        removeConnection(userId, connection);
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
          connection.ws.send(JSON.stringify({ type: "ping" }));
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
): Promise<string | null> {
  return new Promise((resolve) => {
    const mockRes = {
      setHeader: () => {},
      end: () => {},
    };

    sessionMiddleware(req, mockRes, () => {
      const session = (req as any).session;
      
      // Check for masquerade first
      if (session?.masqueradeUserId) {
        resolve(session.masqueradeUserId);
        return;
      }
      
      // Get user ID from Passport session (session.passport.user.dbUser.id)
      const passportUser = session?.passport?.user;
      if (passportUser?.dbUser?.id) {
        resolve(passportUser.dbUser.id);
        return;
      }
      
      resolve(null);
    });
  });
}

function addConnection(userId: string, connection: UserConnection): void {
  if (!connections.has(userId)) {
    connections.set(userId, new Set());
  }
  connections.get(userId)!.add(connection);
}

function removeConnection(userId: string, connection: UserConnection): void {
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
export function broadcastToUser(userId: string, message: WebSocketMessage): boolean {
  const userConnections = connections.get(userId);
  if (!userConnections || userConnections.size === 0) {
    return false;
  }

  const messageStr = JSON.stringify(message);
  let delivered = false;
  userConnections.forEach((connection) => {
    if (connection.ws.readyState === WebSocket.OPEN) {
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
  });
  return delivered;
}

export function broadcastAlertUpdate(userId: string, unreadCount: number): void {
  broadcastToUser(userId, {
    type: "alert_update",
    payload: { unreadCount },
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
): boolean {
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
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
  
  if (wss) {
    connections.forEach((userConnections) => {
      userConnections.forEach((connection) => {
        connection.ws.close(1001, "Server shutting down");
      });
    });
    connections.clear();
    wss.close();
    wss = null;
  }
  
  logger.info("WebSocket server shut down", { service: "websocket" });
}
