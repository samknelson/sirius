import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Loader2, ArrowLeft, Edit, Calendar,
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
import { format } from "date-fns";
import type { Event, EventType, EventOccurrence } from "@shared/schema";

const iconMap: Record<string, LucideIcon> = {
  Calendar, Users, MapPin, Video, Presentation, Mic, Ticket, Star, Heart, Clock,
};

interface EventWithOccurrences extends Event {
  occurrences: EventOccurrence[];
}

export default function EventViewPage() {
  const params = useParams<{ id: string }>();
  const eventId = params.id;

  const { data: event, isLoading } = useQuery<EventWithOccurrences>({
    queryKey: ["/api/events", eventId],
    enabled: !!eventId,
  });

  const { data: eventTypes = [] } = useQuery<EventType[]>({
    queryKey: ["/api/event-types"],
  });

  const getEventType = (eventTypeId: string | null) => {
    if (!eventTypeId) return null;
    return eventTypes.find((t) => t.id === eventTypeId);
  };

  const getEventTypeIcon = (eventTypeId: string | null) => {
    const type = getEventType(eventTypeId);
    const data = type?.data as { icon?: string } | null;
    const iconName = data?.icon || "Calendar";
    return iconMap[iconName] || Calendar;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge variant="default">Active</Badge>;
      case "cancelled":
        return <Badge variant="destructive">Cancelled</Badge>;
      case "completed":
        return <Badge variant="secondary">Completed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" data-testid="loading-spinner" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="container mx-auto py-8">
        <Card>
          <CardContent className="py-8">
            <div className="text-center text-muted-foreground">
              Event not found.
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const IconComponent = getEventTypeIcon(event.eventTypeId);
  const eventType = getEventType(event.eventTypeId);

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div className="flex items-center gap-4 flex-wrap">
        <Link href="/events">
          <Button variant="ghost" size="sm" data-testid="button-back">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Events
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <IconComponent size={24} className="text-muted-foreground" />
              <div>
                <CardTitle data-testid="text-event-title">{event.title}</CardTitle>
                {eventType && (
                  <CardDescription data-testid="text-event-type">
                    {eventType.name}
                  </CardDescription>
                )}
              </div>
            </div>
            <Link href={`/events/${eventId}/edit`}>
              <Button data-testid="button-edit-event">
                <Edit className="h-4 w-4 mr-2" />
                Edit Event
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {event.description && (
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-1">Description</h3>
              <p data-testid="text-event-description">{event.description}</p>
            </div>
          )}
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-1">Created</h3>
            <p data-testid="text-event-created">{format(new Date(event.createdAt), "MMMM d, yyyy 'at' h:mm a")}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle>Occurrences</CardTitle>
              <CardDescription>
                {event.occurrences?.length || 0} occurrence{event.occurrences?.length !== 1 ? "s" : ""} scheduled
              </CardDescription>
            </div>
            <Link href={`/events/${eventId}/edit`}>
              <Button variant="outline" size="sm" data-testid="button-manage-occurrences">
                Manage Occurrences
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {!event.occurrences || event.occurrences.length === 0 ? (
            <div className="text-center text-muted-foreground py-8" data-testid="text-no-occurrences">
              No occurrences scheduled yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {event.occurrences.map((occ) => (
                  <TableRow key={occ.id} data-testid={`row-occurrence-${occ.id}`}>
                    <TableCell data-testid={`text-occ-date-${occ.id}`}>
                      {format(new Date(occ.startAt), "EEEE, MMMM d, yyyy")}
                    </TableCell>
                    <TableCell data-testid={`text-occ-time-${occ.id}`}>
                      {format(new Date(occ.startAt), "h:mm a")}
                      {occ.endAt && (
                        <> - {format(new Date(occ.endAt), "h:mm a")}</>
                      )}
                    </TableCell>
                    <TableCell data-testid={`badge-occ-status-${occ.id}`}>
                      {getStatusBadge(occ.status)}
                    </TableCell>
                    <TableCell data-testid={`text-occ-notes-${occ.id}`}>
                      {occ.notes || <span className="text-muted-foreground">-</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
