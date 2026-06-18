import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Users, ArrowRight, Clock, User } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { DashboardPluginProps } from "../registry";
import { useDashboardContent } from "../useDashboardContent";
import { formatDistanceToNow } from "date-fns";

interface RecentUser {
  sid: string;
  userId: string | null;
  expire: string;
  displayName: string;
}

interface ActiveSessionsContent {
  activeUserCount: number;
  totalSessionCount: number;
  recentUsers: RecentUser[];
}

export function ActiveSessions(_props: DashboardPluginProps) {
  const { data, isLoading } = useDashboardContent<ActiveSessionsContent>("active-sessions");

  if (isLoading || !data) return null;

  const { activeUserCount, totalSessionCount, recentUsers } = data;

  return (
    <Card data-testid="plugin-active-sessions">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Active Users
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4 mb-4">
          <div className="flex items-center justify-center h-16 w-16 rounded-full bg-primary/10">
            <span
              className="text-2xl font-bold text-primary"
              data-testid="text-active-user-count"
            >
              {activeUserCount}
            </span>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">
              {activeUserCount === 1 ? "User" : "Users"} with active sessions
            </p>
            <p className="text-xs text-muted-foreground">
              {totalSessionCount} total{" "}
              {totalSessionCount === 1 ? "session" : "sessions"}
            </p>
          </div>
        </div>

        {recentUsers.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Recent Active Users
            </p>
            <div className="space-y-1">
              {recentUsers.map((session) => (
                <div
                  key={session.sid}
                  className="flex items-center gap-2 py-1 px-2 rounded-md text-sm hover-elevate"
                  data-testid={`session-user-${session.userId?.substring(0, 8)}`}
                >
                  <User className="h-3 w-3 text-muted-foreground" />
                  <span className="flex-1 truncate">{session.displayName}</span>
                  <span className="text-xs text-muted-foreground">
                    <Clock className="h-3 w-3 inline mr-1" />
                    {formatDistanceToNow(new Date(session.expire), {
                      addSuffix: true,
                    })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
      <CardFooter>
        <Link href="/config/users/sessions" className="w-full">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            data-testid="link-view-all-sessions"
          >
            View All Sessions
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </Link>
      </CardFooter>
    </Card>
  );
}
