import { Bell, CheckCheck, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Link, useLocation } from "wouter";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";

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

export default function AlertsPage() {
  const [, navigate] = useLocation();

  const { data: alerts, isLoading } = useQuery<CommInapp[]>({
    queryKey: ["/api/alerts"],
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
  };

  const pendingAlerts = alerts?.filter(a => a.status === "pending") || [];
  const readAlerts = alerts?.filter(a => a.status === "read") || [];

  const renderAlertList = (alertList: CommInapp[], emptyMessage: string) => {
    if (isLoading) {
      return (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-5 w-3/4 mb-2" />
                <Skeleton className="h-4 w-full mb-1" />
                <Skeleton className="h-4 w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      );
    }

    if (alertList.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Bell className="h-12 w-12 mb-4 opacity-50" />
          <p className="text-lg font-medium">{emptyMessage}</p>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {alertList.map((alert) => (
          <Card
            key={alert.id}
            className={`hover-elevate cursor-pointer transition-colors ${
              alert.status === "pending" ? "border-l-4 border-l-primary" : ""
            }`}
            onClick={() => handleAlertClick(alert)}
            data-testid={`alert-card-${alert.id}`}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {alert.status === "pending" && (
                      <div className="w-2.5 h-2.5 rounded-full bg-primary flex-shrink-0" />
                    )}
                    <h3 className="font-semibold text-base truncate" data-testid={`alert-title-${alert.id}`}>
                      {alert.title}
                    </h3>
                    <Badge variant={alert.status === "pending" ? "default" : "secondary"} className="text-xs">
                      {alert.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                    {alert.body}
                  </p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                    <span>{format(new Date(alert.createdAt), "MMM d, yyyy 'at' h:mm a")}</span>
                    {alert.linkUrl && (
                      <span className="flex items-center gap-1 text-primary font-medium">
                        {alert.linkLabel || "View details"}
                        {!alert.linkUrl.startsWith("/") && <ExternalLink className="h-3 w-3" />}
                      </span>
                    )}
                  </div>
                </div>
                {alert.status === "pending" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      markAsReadMutation.mutate(alert.id);
                    }}
                    disabled={markAsReadMutation.isPending}
                    data-testid={`button-mark-read-${alert.id}`}
                  >
                    <CheckCheck className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  };

  return (
    <div className="container max-w-4xl py-6 px-4">
      <div className="flex items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <Bell className="h-6 w-6" />
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Notifications</h1>
        </div>
        {pendingAlerts.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => markAllReadMutation.mutate()}
            disabled={markAllReadMutation.isPending}
            data-testid="button-mark-all-read"
          >
            <CheckCheck className="h-4 w-4 mr-2" />
            Mark all as read
          </Button>
        )}
      </div>

      <Tabs defaultValue="unread" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="unread" data-testid="tab-unread">
            Unread
            {pendingAlerts.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {pendingAlerts.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="read" data-testid="tab-read">
            Read
            {readAlerts.length > 0 && (
              <Badge variant="outline" className="ml-2">
                {readAlerts.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="all" data-testid="tab-all">
            All
          </TabsTrigger>
        </TabsList>

        <TabsContent value="unread">
          {renderAlertList(pendingAlerts, "No unread notifications")}
        </TabsContent>

        <TabsContent value="read">
          {renderAlertList(readAlerts, "No read notifications")}
        </TabsContent>

        <TabsContent value="all">
          {renderAlertList(alerts || [], "No notifications")}
        </TabsContent>
      </Tabs>
    </div>
  );
}
