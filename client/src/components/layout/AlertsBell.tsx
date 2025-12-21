import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Link, useLocation } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

interface CommInapp {
  id: string;
  commId: string;
  userId: string;
  title: string;
  body: string;
  linkUrl: string | null;
  linkLabel: string | null;
  status: string;
  createdAt: string;
}

interface UnreadCountResponse {
  count: number;
}

export function AlertsBell() {
  const [, navigate] = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const { user } = useAuth();

  const { data: unreadData } = useQuery<UnreadCountResponse>({
    queryKey: ["/api/alerts/unread-count"],
    refetchInterval: 30000,
    enabled: !!user,
    retry: false,
  });

  const { data: alerts } = useQuery<CommInapp[]>({
    queryKey: ["/api/alerts", { limit: 5 }],
    enabled: isOpen && !!user,
    retry: false,
  });

  const markAsReadMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("PATCH", `/api/alerts/${id}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts/unread-count"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", "/api/alerts/mark-all-read");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts/unread-count"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
    },
  });

  const handleAlertClick = (alert: CommInapp) => {
    if (alert.status === "pending") {
      markAsReadMutation.mutate(alert.id);
    }
    
    if (alert.linkUrl) {
      if (alert.linkUrl.startsWith("/")) {
        navigate(alert.linkUrl);
      } else {
        window.open(alert.linkUrl, "_blank");
      }
    }
    setIsOpen(false);
  };

  const unreadCount = unreadData?.count || 0;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          data-testid="button-alerts-bell"
          aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`}
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-5 min-w-5 flex items-center justify-center p-0 text-xs"
              data-testid="badge-unread-count"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0" data-testid="popover-alerts">
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b">
          <h3 className="font-semibold text-sm">Notifications</h3>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7"
              onClick={() => markAllReadMutation.mutate()}
              disabled={markAllReadMutation.isPending}
              data-testid="button-mark-all-read"
            >
              Mark all read
            </Button>
          )}
        </div>
        
        <ScrollArea className="max-h-80">
          {!alerts || alerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Bell className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">No notifications</p>
            </div>
          ) : (
            <div className="divide-y">
              {alerts.map((alert) => (
                <div
                  key={alert.id}
                  className={`px-4 py-3 hover-elevate cursor-pointer ${
                    alert.status === "pending" ? "bg-accent/30" : ""
                  }`}
                  onClick={() => handleAlertClick(alert)}
                  data-testid={`alert-item-${alert.id}`}
                >
                  <div className="flex items-start gap-2">
                    {alert.status === "pending" && (
                      <div className="w-2 h-2 mt-1.5 rounded-full bg-primary flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate" data-testid={`alert-title-${alert.id}`}>
                        {alert.title}
                      </p>
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                        {alert.body}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(alert.createdAt), { addSuffix: true })}
                        </span>
                        {alert.linkLabel && (
                          <span className="text-xs text-primary font-medium">
                            {alert.linkLabel}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        <div className="border-t px-4 py-2">
          <Link href="/alerts" onClick={() => setIsOpen(false)}>
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs"
              data-testid="button-view-all-alerts"
            >
              View all notifications
            </Button>
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
