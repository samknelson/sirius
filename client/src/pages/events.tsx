import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  Loader2, Plus, Eye, Calendar, X,
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
import { format, parseISO, isAfter, isBefore, startOfDay, endOfDay } from "date-fns";
import type { Event, EventType, EventOccurrence } from "@shared/schema";

const iconMap: Record<string, LucideIcon> = {
  Calendar, Users, MapPin, Video, Presentation, Mic, Ticket, Star, Heart, Clock,
};

type EventWithOccurrences = Event & { occurrences?: EventOccurrence[] };

export default function EventsListPage() {
  const [titleFilter, setTitleFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState("");

  const { data: events = [], isLoading } = useQuery<EventWithOccurrences[]>({
    queryKey: ["/api/events"],
  });

  const { data: eventTypes = [] } = useQuery<EventType[]>({
    queryKey: ["/api/event-types"],
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

  const formatOccurrenceDates = (occurrences?: EventOccurrence[]) => {
    if (!occurrences || occurrences.length === 0) {
      return <span className="text-muted-foreground">No dates</span>;
    }
    
    const sorted = [...occurrences].sort((a, b) => 
      new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
    );
    
    if (sorted.length === 1) {
      return format(new Date(sorted[0].startAt), "MMM d, yyyy h:mm a");
    }
    
    return (
      <div className="space-y-1">
        {sorted.slice(0, 3).map((occ, idx) => (
          <div key={occ.id || idx} className="text-sm">
            {format(new Date(occ.startAt), "MMM d, yyyy h:mm a")}
          </div>
        ))}
        {sorted.length > 3 && (
          <div className="text-sm text-muted-foreground">
            +{sorted.length - 3} more
          </div>
        )}
      </div>
    );
  };

  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      if (titleFilter && !event.title.toLowerCase().includes(titleFilter.toLowerCase())) {
        return false;
      }
      
      if (typeFilter && typeFilter !== "all" && event.eventTypeId !== typeFilter) {
        return false;
      }
      
      if (dateFilter) {
        const filterDate = parseISO(dateFilter);
        const dayStart = startOfDay(filterDate);
        const dayEnd = endOfDay(filterDate);
        
        const hasMatchingOccurrence = event.occurrences?.some((occ) => {
          const occDate = new Date(occ.startAt);
          return !isBefore(occDate, dayStart) && !isAfter(occDate, dayEnd);
        });
        
        if (!hasMatchingOccurrence) {
          return false;
        }
      }
      
      return true;
    });
  }, [events, titleFilter, typeFilter, dateFilter]);

  const clearFilters = () => {
    setTitleFilter("");
    setTypeFilter("all");
    setDateFilter("");
  };

  const hasActiveFilters = titleFilter || (typeFilter && typeFilter !== "all") || dateFilter;

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
          <div className="mb-6 grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <Label htmlFor="title-filter">Title</Label>
              <Input
                id="title-filter"
                placeholder="Search by title..."
                value={titleFilter}
                onChange={(e) => setTitleFilter(e.target.value)}
                data-testid="input-filter-title"
              />
            </div>
            <div>
              <Label htmlFor="type-filter">Event Type</Label>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger id="type-filter" data-testid="select-filter-type">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {eventTypes.map((type) => (
                    <SelectItem key={type.id} value={type.id}>
                      {type.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="date-filter">Date</Label>
              <Input
                id="date-filter"
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                data-testid="input-filter-date"
              />
            </div>
            <div className="flex items-end">
              {hasActiveFilters && (
                <Button
                  variant="outline"
                  onClick={clearFilters}
                  data-testid="button-clear-filters"
                >
                  <X className="h-4 w-4 mr-2" />
                  Clear Filters
                </Button>
              )}
            </div>
          </div>

          {filteredEvents.length === 0 ? (
            <div className="text-center text-muted-foreground py-8" data-testid="text-empty-state">
              {events.length === 0 
                ? 'No events yet. Click "Add Event" to create one.'
                : "No events match your filters."}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Type</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Event Dates</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEvents.map((event) => {
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
                      <TableCell data-testid={`text-dates-${event.id}`}>
                        {formatOccurrenceDates(event.occurrences)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link href={`/events/${event.id}`}>
                          <Button
                            data-testid={`button-view-${event.id}`}
                            size="sm"
                            variant="outline"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
