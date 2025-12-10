import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Trash2, User, Clock, RefreshCw } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format, formatDistanceToNow } from "date-fns";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface SessionWithUser {
  sid: string;
  expire: string;
  userId: string | null;
  userEmail: string | null;
  userFirstName: string | null;
  userLastName: string | null;
}

export default function SessionsPage() {
  const { toast } = useToast();

  const { data: sessions, isLoading, refetch } = useQuery<SessionWithUser[]>({
    queryKey: ["/api/sessions"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (sid: string) => {
      await apiRequest("DELETE", `/api/sessions/${encodeURIComponent(sid)}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
      toast({
        title: "Session Deleted",
        description: "The user has been logged out.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete session",
        variant: "destructive",
      });
    },
  });

  const getUserName = (session: SessionWithUser) => {
    if (session.userFirstName || session.userLastName) {
      return `${session.userFirstName || ''} ${session.userLastName || ''}`.trim();
    }
    return session.userEmail || "Unknown User";
  };

  const truncateSid = (sid: string) => {
    if (sid.length > 12) {
      return `${sid.substring(0, 8)}...${sid.substring(sid.length - 4)}`;
    }
    return sid;
  };

  return (
    <div className="container mx-auto py-6 px-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Active Sessions
            </CardTitle>
            <CardDescription>
              View and manage user sessions. Delete a session to force a user to log out.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isLoading}
            data-testid="button-refresh-sessions"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : sessions && sessions.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Session ID</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((session) => (
                  <TableRow key={session.sid} data-testid={`row-session-${session.sid.substring(0, 8)}`}>
                    <TableCell className="font-mono text-sm text-muted-foreground">
                      {truncateSid(session.sid)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        {session.userId ? (
                          <Link href={`/users/${session.userId}`}>
                            <span className="text-primary hover:underline cursor-pointer" data-testid={`link-user-${session.userId}`}>
                              {getUserName(session)}
                            </span>
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">No user data</span>
                        )}
                        {session.userEmail && session.userId && (
                          <Badge variant="secondary" className="text-xs">
                            {session.userEmail}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="text-sm">
                          {format(new Date(session.expire), "MMM d, yyyy h:mm a")}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(session.expire), { addSuffix: true })}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={deleteMutation.isPending}
                            data-testid={`button-delete-session-${session.sid.substring(0, 8)}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Session</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to delete this session? This will force{" "}
                              <strong>{getUserName(session)}</strong> to log out immediately.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteMutation.mutate(session.sid)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              data-testid="button-confirm-delete-session"
                            >
                              Delete Session
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No active sessions found.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
