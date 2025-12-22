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

type WebSocketMessage = AlertUpdateMessage;

const connections: Map<string, Set<UserConnection>> = new Map();
let wss: WebSocketServer | null = null;
let pingInterval: NodeJS.Timeout | null = null;

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
          connection.ws.close(4002, "Connection timeout");
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
      if (session?.userId) {
        resolve(session.userId);
      } else {
        resolve(null);
      }
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

export function broadcastToUser(userId: string, message: WebSocketMessage): void {
  const userConnections = connections.get(userId);
  if (!userConnections || userConnections.size === 0) {
    return;
  }

  const messageStr = JSON.stringify(message);
  userConnections.forEach((connection) => {
    if (connection.ws.readyState === WebSocket.OPEN) {
      try {
        connection.ws.send(messageStr);
      } catch (error) {
        logger.error("Failed to send WebSocket message", {
          service: "websocket",
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });
}

export function broadcastAlertUpdate(userId: string, unreadCount: number): void {
  broadcastToUser(userId, {
    type: "alert_update",
    payload: { unreadCount },
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
