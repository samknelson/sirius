import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Users, ArrowRight, Clock, User } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { DashboardPluginProps } from "../types";
import { formatDistanceToNow } from "date-fns";

interface SessionWithUser {
  sid: string;
  expire: string;
  userId: string | null;
  userEmail: string | null;
  userFirstName: string | null;
  userLastName: string | null;
}

export function ActiveSessionsPlugin({ userPermissions }: DashboardPluginProps) {
  const hasAdminPermission = userPermissions.includes('admin');

  const { data: sessions = [], isLoading } = useQuery<SessionWithUser[]>({
    queryKey: ["/api/sessions"],
    enabled: hasAdminPermission,
  });

  if (!hasAdminPermission || isLoading) {
    return null;
  }

  const activeSessions = sessions.filter(s => new Date(s.expire) > new Date());
  const uniqueUsers = new Map<string, SessionWithUser>();
  
  activeSessions.forEach(session => {
    if (session.userId && !uniqueUsers.has(session.userId)) {
      uniqueUsers.set(session.userId, session);
    }
  });

  const activeUserCount = uniqueUsers.size;
  const recentSessions = Array.from(uniqueUsers.values())
    .sort((a, b) => new Date(b.expire).getTime() - new Date(a.expire).getTime())
    .slice(0, 5);

  const getUserName = (session: SessionWithUser) => {
    if (session.userFirstName || session.userLastName) {
      return `${session.userFirstName || ''} ${session.userLastName || ''}`.trim();
    }
    return session.userEmail || "Unknown User";
  };

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
            <span className="text-2xl font-bold text-primary" data-testid="text-active-user-count">
              {activeUserCount}
            </span>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">
              {activeUserCount === 1 ? 'User' : 'Users'} with active sessions
            </p>
            <p className="text-xs text-muted-foreground">
              {activeSessions.length} total {activeSessions.length === 1 ? 'session' : 'sessions'}
            </p>
          </div>
        </div>

        {recentSessions.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Recent Active Users
            </p>
            <div className="space-y-1">
              {recentSessions.map((session) => (
                <div
                  key={session.sid}
                  className="flex items-center gap-2 py-1 px-2 rounded-md text-sm hover-elevate"
                  data-testid={`session-user-${session.userId?.substring(0, 8)}`}
                >
                  <User className="h-3 w-3 text-muted-foreground" />
                  <span className="flex-1 truncate">{getUserName(session)}</span>
                  <span className="text-xs text-muted-foreground">
                    <Clock className="h-3 w-3 inline mr-1" />
                    {formatDistanceToNow(new Date(session.expire), { addSuffix: true })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
      <CardFooter>
        <Link href="/admin/users/sessions" className="w-full">
          <Button variant="outline" size="sm" className="w-full" data-testid="link-view-all-sessions">
            View All Sessions
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </Link>
      </CardFooter>
    </Card>
  );
}
