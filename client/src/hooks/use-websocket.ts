import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";

interface AlertUpdatePayload {
  unreadCount: number;
}

type NotificationMedium = "email" | "sms" | "inapp" | "postal";

interface NotificationSummaryPayload {
  counts: Partial<Record<NotificationMedium, number>>;
}

interface WebSocketMessage {
  type: "connected" | "ping" | "alert_update" | "notification_summary";
  payload?: AlertUpdatePayload | NotificationSummaryPayload;
}

const MEDIUM_LABELS: Record<NotificationMedium, string> = {
  sms: "SMS",
  email: "email",
  inapp: "in-app",
  postal: "postal",
};

const MEDIUM_ORDER: NotificationMedium[] = ["sms", "email", "inapp", "postal"];

/**
 * Build a human-readable summary of the notifications a user's action triggered
 * (e.g. "3 by SMS, 2 by email"). Returns null when nothing was sent so no toast
 * is shown.
 */
function formatNotificationSummary(
  counts: Partial<Record<NotificationMedium, number>>,
): string | null {
  const parts = MEDIUM_ORDER.filter((m) => (counts[m] ?? 0) > 0).map(
    (m) => `${counts[m]} by ${MEDIUM_LABELS[m]}`,
  );
  if (parts.length === 0) return null;
  return parts.join(", ");
}

interface UseWebSocketReturn {
  isConnected: boolean;
  alertCount: number | null;
}

const RECONNECT_DELAY = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;

function playNotificationChime() {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
    oscillator.frequency.setValueAtTime(1100, audioContext.currentTime + 0.1);
    oscillator.frequency.setValueAtTime(880, audioContext.currentTime + 0.2);
    
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.4);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.4);
    
    setTimeout(() => {
      audioContext.close();
    }, 500);
  } catch {
    // Audio playback not supported or blocked
  }
}

export function useWebSocket(): UseWebSocketReturn {
  const { user } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const [alertCount, setAlertCount] = useState<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const previousAlertCountRef = useRef<number | null>(null);

  const connect = useCallback(() => {
    if (!user || wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          
          switch (message.type) {
            case "connected":
              break;
            case "ping":
              ws.send(JSON.stringify({ type: "pong" }));
              break;
            case "alert_update":
              if (message.payload) {
                const newCount = (message.payload as AlertUpdatePayload).unreadCount;
                const prevCount = previousAlertCountRef.current;
                
                if (prevCount !== null && newCount > prevCount) {
                  playNotificationChime();
                }
                
                previousAlertCountRef.current = newCount;
                setAlertCount(newCount);
              }
              break;
            case "notification_summary":
              if (message.payload) {
                const summary = formatNotificationSummary(
                  (message.payload as NotificationSummaryPayload).counts,
                );
                if (summary) {
                  toast({
                    title: "Notifications sent",
                    description: summary,
                  });
                }
              }
              break;
          }
        } catch {
          // Ignore invalid messages
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        wsRef.current = null;

        if (user && reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttemptsRef.current++;
          reconnectTimeoutRef.current = setTimeout(connect, RECONNECT_DELAY);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      // Connection failed
    }
  }, [user]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    setIsConnected(false);
    reconnectAttemptsRef.current = 0;
  }, []);

  useEffect(() => {
    if (user) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [user, connect, disconnect]);

  return {
    isConnected,
    alertCount,
  };
}
