import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Trash2, RefreshCw, Droplets, Filter } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format, formatDistanceToNow } from "date-fns";
import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import type { Flood } from "@shared/schema";

export default function FloodEventsPage() {
  const { toast } = useToast();
  const [eventFilter, setEventFilter] = useState<string>("all");

  const { data: eventTypes, isLoading: typesLoading } = useQuery<string[]>({
    queryKey: ["/api/flood-events/types"],
  });

  const { data: events, isLoading, refetch } = useQuery<Flood[]>({
    queryKey: ["/api/flood-events", eventFilter],
    queryFn: async () => {
      const url = eventFilter && eventFilter !== "all" 
        ? `/api/flood-events?event=${encodeURIComponent(eventFilter)}`
        : "/api/flood-events";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch flood events");
      return res.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/flood-events/${encodeURIComponent(id)}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/flood-events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/flood-events/types"] });
      toast({
        title: "Event Deleted",
        description: "The flood event has been removed.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete flood event",
        variant: "destructive",
      });
    },
  });

  const clearMutation = useMutation({
    mutationFn: async (eventType?: string) => {
      const url = eventType && eventType !== "all"
        ? `/api/flood-events?event=${encodeURIComponent(eventType)}`
        : "/api/flood-events";
      await apiRequest("DELETE", url);
    },
    onSuccess: (_, eventType) => {
      queryClient.invalidateQueries({ queryKey: ["/api/flood-events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/flood-events/types"] });
      toast({
        title: "Events Cleared",
        description: eventType && eventType !== "all"
          ? `All "${eventType}" flood events have been cleared.`
          : "All flood events have been cleared.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to clear flood events",
        variant: "destructive",
      });
    },
  });

  const truncateId = (id: string) => {
    if (id.length > 12) {
      return `${id.substring(0, 8)}...${id.substring(id.length - 4)}`;
    }
    return id;
  };

  return (
    <div className="container mx-auto py-6 px-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Droplets className="h-5 w-5" />
              Flood Events
            </CardTitle>
            <CardDescription>
              View and manage rate limiting flood events. These track API usage to prevent abuse.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={eventFilter} onValueChange={setEventFilter}>
                <SelectTrigger className="w-[180px]" data-testid="select-event-filter">
                  <SelectValue placeholder="All Events" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Events</SelectItem>
                  {eventTypes?.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isLoading}
              data-testid="button-refresh-flood-events"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={!events || events.length === 0 || clearMutation.isPending}
                  data-testid="button-clear-flood-events"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Clear {eventFilter !== "all" ? `"${eventFilter}"` : "All"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear Flood Events?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {eventFilter !== "all"
                      ? `This will delete all "${eventFilter}" flood events. Users will be able to perform those actions again immediately.`
                      : "This will delete all flood events. All rate limits will be reset."}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="button-cancel-clear">Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => clearMutation.mutate(eventFilter)}
                    data-testid="button-confirm-clear"
                  >
                    Clear Events
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading || typesLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : events && events.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Event Type</TableHead>
                  <TableHead>Identifier</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="w-[80px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => (
                  <TableRow key={event.id} data-testid={`row-flood-event-${event.id.substring(0, 8)}`}>
                    <TableCell className="font-mono text-sm text-muted-foreground">
                      {truncateId(event.id)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{event.event}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {truncateId(event.identifier)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="text-sm">
                          {format(new Date(event.createdAt), "MMM d, yyyy HH:mm:ss")}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(event.createdAt), { addSuffix: true })}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="text-sm">
                          {format(new Date(event.expiresAt), "MMM d, yyyy HH:mm:ss")}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(event.expiresAt), { addSuffix: true })}
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
                            data-testid={`button-delete-flood-event-${event.id.substring(0, 8)}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Flood Event?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will remove this rate limit entry. The user may be able to perform this action again sooner than expected.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteMutation.mutate(event.id)}
                              data-testid="button-confirm-delete"
                            >
                              Delete
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
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Droplets className="h-12 w-12 mb-4 opacity-50" />
              <p className="text-lg font-medium">No flood events found</p>
              <p className="text-sm">
                {eventFilter !== "all"
                  ? `No "${eventFilter}" events recorded yet.`
                  : "Rate limiting events will appear here when users trigger them."}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
