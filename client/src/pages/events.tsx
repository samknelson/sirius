import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { 
  Loader2, Plus, Eye, Edit, Trash2, Calendar,
  Users, MapPin, Video, Presentation, Mic, Ticket, Star, Heart, Clock,
  type LucideIcon
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import type { Event, EventType, EventOccurrence } from "@shared/schema";

const iconMap: Record<string, LucideIcon> = {
  Calendar, Users, MapPin, Video, Presentation, Mic, Ticket, Star, Heart, Clock,
};

interface EventWithOccurrences extends Event {
  occurrences?: EventOccurrence[];
}

export default function EventsListPage() {
  const { toast } = useToast();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: events = [], isLoading } = useQuery<Event[]>({
    queryKey: ["/api/events"],
  });

  const { data: eventTypes = [] } = useQuery<EventType[]>({
    queryKey: ["/api/event-types"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/events/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      setDeleteId(null);
      toast({
        title: "Success",
        description: "Event deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete event.",
        variant: "destructive",
      });
    },
  });

  const getEventTypeName = (eventTypeId: string | null) => {
    if (!eventTypeId) return "-";
    const type = eventTypes.find((t) => t.id === eventTypeId);
    return type?.name || "-";
  };

  const getEventTypeIcon = (eventTypeId: string | null) => {
    if (!eventTypeId) return Calendar;
    const type = eventTypes.find((t) => t.id === eventTypeId);
    const data = type?.data as { icon?: string } | null;
    const iconName = data?.icon || "Calendar";
    return iconMap[iconName] || Calendar;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" data-testid="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle data-testid="title-page">Events</CardTitle>
              <CardDescription>
                Manage events and their occurrences
              </CardDescription>
            </div>
            <Link href="/events/new">
              <Button data-testid="button-add-event">
                <Plus className="h-4 w-4 mr-2" />
                Add Event
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <div className="text-center text-muted-foreground py-8" data-testid="text-empty-state">
              No events yet. Click "Add Event" to create one.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Type</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => {
                  const IconComponent = getEventTypeIcon(event.eventTypeId);
                  return (
                    <TableRow key={event.id} data-testid={`row-event-${event.id}`}>
                      <TableCell data-testid={`icon-event-${event.id}`}>
                        <div className="flex items-center gap-2">
                          <IconComponent size={18} className="text-muted-foreground" />
                        </div>
                      </TableCell>
                      <TableCell data-testid={`text-title-${event.id}`}>
                        <div className="font-medium">{event.title}</div>
                        <div className="text-sm text-muted-foreground">
                          {getEventTypeName(event.eventTypeId)}
                        </div>
                      </TableCell>
                      <TableCell data-testid={`text-description-${event.id}`}>
                        {event.description ? (
                          <span className="line-clamp-2">{event.description}</span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell data-testid={`text-created-${event.id}`}>
                        {format(new Date(event.createdAt), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        <Link href={`/events/${event.id}`}>
                          <Button
                            data-testid={`button-view-${event.id}`}
                            size="sm"
                            variant="outline"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </Link>
                        <Link href={`/events/${event.id}/edit`}>
                          <Button
                            data-testid={`button-edit-${event.id}`}
                            size="sm"
                            variant="outline"
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                        </Link>
                        <Button
                          data-testid={`button-delete-${event.id}`}
                          size="sm"
                          variant="destructive"
                          onClick={() => setDeleteId(event.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <DialogContent data-testid="dialog-delete">
          <DialogHeader>
            <DialogTitle>Delete Event</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this event? This will also delete all occurrences. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              data-testid="button-confirm-delete"
              variant="destructive"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </Button>
            <Button
              data-testid="button-cancel-delete"
              variant="outline"
              onClick={() => setDeleteId(null)}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
