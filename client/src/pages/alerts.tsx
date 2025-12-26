import { Bell, CheckCheck, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Link, useLocation, Redirect } from "wouter";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
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

interface AlertsPageProps {
  activeTab?: "unread" | "read" | "all";
}

export default function AlertsPage({ activeTab = "unread" }: AlertsPageProps) {
  const [, navigate] = useLocation();
  const { user } = useAuth();

  const { data: alerts, isLoading } = useQuery<CommInapp[]>({
    queryKey: ["/api/alerts"],
    enabled: !!user,
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
  };

  const pendingAlerts = alerts?.filter(a => a.status === "pending") || [];
  const readAlerts = alerts?.filter(a => a.status === "read") || [];

  // Determine which alerts to show based on activeTab
  const displayedAlerts = activeTab === "unread" 
    ? pendingAlerts 
    : activeTab === "read" 
      ? readAlerts 
      : alerts || [];

  const emptyMessage = activeTab === "unread" 
    ? "No unread notifications" 
    : activeTab === "read" 
      ? "No read notifications" 
      : "No notifications";

  const tabs = [
    { id: "unread", label: "Unread", count: pendingAlerts.length, path: "/alerts/unread" },
    { id: "read", label: "Read", count: readAlerts.length, path: "/alerts/read" },
    { id: "all", label: "All", count: alerts?.length || 0, path: "/alerts/all" },
  ];

  const renderAlertList = () => {
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

    if (displayedAlerts.length === 0) {
      return (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
              <Bell className="text-muted-foreground" size={32} />
            </div>
            <h3 className="text-lg font-medium text-foreground mb-2">{emptyMessage}</h3>
            <p className="text-muted-foreground text-center">
              {activeTab === "unread" 
                ? "You're all caught up!" 
                : activeTab === "read"
                  ? "No notifications have been read yet."
                  : "You don't have any notifications yet."}
            </p>
          </CardContent>
        </Card>
      );
    }

    return (
      <div className="space-y-3">
        {displayedAlerts.map((alert) => (
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
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
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
                  <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
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
    <div className="bg-background text-foreground min-h-screen">
      {/* Header */}
      <header className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <Bell className="text-primary-foreground" size={16} />
              </div>
              <h1 className="text-xl font-semibold text-foreground" data-testid="text-page-title">
                Notifications
              </h1>
            </div>
            <div className="flex items-center space-x-4">
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
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center space-x-2 py-3">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTab;
              return isActive ? (
                <Button
                  key={tab.id}
                  variant="default"
                  size="sm"
                  data-testid={`tab-${tab.id}`}
                >
                  {tab.label}
                  {tab.count > 0 && (
                    <Badge variant="secondary" className="ml-2">
                      {tab.count}
                    </Badge>
                  )}
                </Button>
              ) : (
                <Link key={tab.id} href={tab.path}>
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid={`tab-${tab.id}`}
                  >
                    {tab.label}
                    {tab.count > 0 && (
                      <Badge variant="outline" className="ml-2">
                        {tab.count}
                      </Badge>
                    )}
                  </Button>
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {renderAlertList()}
      </main>
    </div>
  );
}

// Redirect component for /alerts to /alerts/unread
export function AlertsRedirect() {
  return <Redirect to="/alerts/unread" />;
}
