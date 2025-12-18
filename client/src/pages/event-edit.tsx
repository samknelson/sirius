import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useParams, useLocation } from "wouter";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

interface EventCategoryConfigOption {
  key: string;
  label: string;
  type: "number" | "boolean" | "string" | "select";
  options?: { value: string; label: string }[];
  defaultValue?: any;
  description?: string;
  scope: "type" | "event" | "both";
}

interface EventCategory {
  id: string;
  label: string;
  description?: string;
  roles: { id: string; label: string; canManageParticipants?: boolean }[];
  statuses: { id: string; label: string }[];
  configOptions: EventCategoryConfigOption[];
}
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Loader2, ArrowLeft, Plus, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { insertEventSchema } from "@shared/schema";
import type { Event, EventType, EventOccurrence } from "@shared/schema";
import EventLayout, { useEventLayout } from "@/components/layouts/EventLayout";

interface EventWithOccurrences extends Event {
  occurrences: EventOccurrence[];
}

const eventFormSchema = insertEventSchema.extend({
  title: z.string().min(1, "Title is required"),
  eventTypeId: z.string().min(1, "Event type is required"),
});

type EventFormValues = z.infer<typeof eventFormSchema>;

const createEventFormSchema = insertEventSchema.extend({
  title: z.string().min(1, "Title is required"),
  eventTypeId: z.string().min(1, "Event type is required"),
  startDate: z.string().min(1, "Start date is required"),
  startTime: z.string().min(1, "Start time is required"),
  endTime: z.string().optional(),
});

type CreateEventFormValues = z.infer<typeof createEventFormSchema>;

const occurrenceFormSchema = z.object({
  startDate: z.string().min(1, "Start date is required"),
  startTime: z.string().min(1, "Start time is required"),
  endTime: z.string().optional(),
  notes: z.string().optional(),
});

type OccurrenceFormValues = z.infer<typeof occurrenceFormSchema>;

function EventEditContent() {
  const { event } = useEventLayout();
  const { toast } = useToast();

  const [deleteOccId, setDeleteOccId] = useState<string | null>(null);
  const [showAddOccurrence, setShowAddOccurrence] = useState(false);
  const [eventConfig, setEventConfig] = useState<Record<string, any>>(
    (event.config as Record<string, any>) || {}
  );

  const { data: eventTypes = [] } = useQuery<EventType[]>({
    queryKey: ["/api/event-types"],
  });

  const { data: categories = [] } = useQuery<EventCategory[]>({
    queryKey: ["/api/event-categories"],
  });

  const form = useForm<EventFormValues>({
    resolver: zodResolver(eventFormSchema),
    defaultValues: {
      title: event.title,
      eventTypeId: event.eventTypeId || undefined,
      description: event.description || "",
      data: (event.data as Record<string, unknown>) || undefined,
    },
  });

  const watchedEventTypeId = form.watch("eventTypeId");

  const selectedEventType = useMemo(() => 
    eventTypes.find(t => t.id === watchedEventTypeId),
    [eventTypes, watchedEventTypeId]
  );

  const selectedCategory = useMemo(() => 
    categories.find(c => c.id === selectedEventType?.category),
    [categories, selectedEventType]
  );

  const eventConfigOptions = useMemo(() => 
    selectedCategory?.configOptions.filter(
      opt => opt.scope === "event" || opt.scope === "both"
    ) || [],
    [selectedCategory]
  );

  // Track the event's original type and config to detect user-initiated type changes
  const [originalEventTypeId] = useState<string | undefined>(event.eventTypeId || undefined);
  const [originalConfig] = useState<Record<string, any>>((event.config as Record<string, any>) || {});
  const prevEventTypeIdRef = useRef<string | undefined>(event.eventTypeId || undefined);
  
  // Reset eventConfig only when user actually changes event type (not on React Query refetches)
  useEffect(() => {
    const prevTypeId = prevEventTypeIdRef.current;
    
    // Only act when type actually changes
    if (watchedEventTypeId === prevTypeId) return;
    
    // Update ref to current value
    prevEventTypeIdRef.current = watchedEventTypeId;
    
    if (watchedEventTypeId === originalEventTypeId) {
      // Restore original config when returning to original type
      setEventConfig(originalConfig);
    } else {
      // Use defaults for new type
      const newConfig: Record<string, any> = {};
      for (const opt of eventConfigOptions) {
        if (opt.defaultValue !== undefined) {
          newConfig[opt.key] = opt.defaultValue;
        }
      }
      setEventConfig(newConfig);
    }
  }, [watchedEventTypeId, originalEventTypeId, originalConfig, eventConfigOptions]);

  const occurrenceForm = useForm<OccurrenceFormValues>({
    resolver: zodResolver(occurrenceFormSchema),
    defaultValues: {
      startDate: "",
      startTime: "",
      endTime: "",
      notes: "",
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: EventFormValues) => {
      // Filter config to only include valid keys for current category
      const validConfigKeys = new Set(eventConfigOptions.map(o => o.key));
      const filteredConfig: Record<string, any> = {};
      for (const key of Object.keys(eventConfig)) {
        if (validConfigKeys.has(key) && eventConfig[key] !== undefined && eventConfig[key] !== "") {
          filteredConfig[key] = eventConfig[key];
        }
      }
      const payload = {
        title: data.title,
        eventTypeId: data.eventTypeId || undefined,
        description: data.description || undefined,
        config: Object.keys(filteredConfig).length > 0 ? filteredConfig : null,
        data: data.data || undefined,
      };
      return apiRequest("PUT", `/api/events/${event.id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/events", event.id] });
      toast({
        title: "Success",
        description: "Event updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update event.",
        variant: "destructive",
      });
    },
  });

  const addOccurrenceMutation = useMutation({
    mutationFn: async (data: OccurrenceFormValues) => {
      const startAt = new Date(`${data.startDate}T${data.startTime}`);
      let endAt = null;
      if (data.endTime) {
        endAt = new Date(`${data.startDate}T${data.endTime}`);
      }
      return apiRequest("POST", `/api/events/${event.id}/occurrences`, {
        startAt: startAt.toISOString(),
        endAt: endAt ? endAt.toISOString() : null,
        notes: data.notes || null,
        status: "active",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/events", event.id] });
      occurrenceForm.reset();
      setShowAddOccurrence(false);
      toast({
        title: "Success",
        description: "Occurrence added successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add occurrence.",
        variant: "destructive",
      });
    },
  });

  const deleteOccurrenceMutation = useMutation({
    mutationFn: async (occId: string) => {
      return apiRequest("DELETE", `/api/events/${event.id}/occurrences/${occId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/events", event.id] });
      setDeleteOccId(null);
      toast({
        title: "Success",
        description: "Occurrence deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete occurrence.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: EventFormValues) => {
    updateMutation.mutate(data);
  };

  const onAddOccurrence = (data: OccurrenceFormValues) => {
    addOccurrenceMutation.mutate(data);
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

  const renderEventConfigOptions = () => {
    if (eventConfigOptions.length === 0) return null;
    
    return (
      <div className="space-y-3 border-t pt-4 mt-4">
        <Label className="text-sm font-medium">Event Configuration</Label>
        <p className="text-xs text-muted-foreground">
          Category: {selectedCategory?.label || "Unknown"}
        </p>
        {eventConfigOptions.map((opt) => (
          <div key={opt.key} className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <Label className="text-sm">{opt.label}</Label>
              {opt.description && (
                <p className="text-xs text-muted-foreground">{opt.description}</p>
              )}
            </div>
            {opt.type === "boolean" ? (
              <Switch
                checked={eventConfig[opt.key] ?? opt.defaultValue ?? false}
                onCheckedChange={(checked) => 
                  setEventConfig(prev => ({ ...prev, [opt.key]: checked }))
                }
                data-testid={`switch-event-config-${opt.key}`}
              />
            ) : opt.type === "number" ? (
              <Input
                type="number"
                className="w-24"
                value={eventConfig[opt.key] ?? opt.defaultValue ?? ""}
                onChange={(e) => 
                  setEventConfig(prev => ({ 
                    ...prev, 
                    [opt.key]: e.target.value ? Number(e.target.value) : undefined 
                  }))
                }
                data-testid={`input-event-config-${opt.key}`}
              />
            ) : (
              <Input
                className="w-48"
                value={eventConfig[opt.key] ?? opt.defaultValue ?? ""}
                onChange={(e) => 
                  setEventConfig(prev => ({ ...prev, [opt.key]: e.target.value }))
                }
                data-testid={`input-event-config-${opt.key}`}
              />
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle data-testid="title-page">Edit Event</CardTitle>
          <CardDescription>Edit event details and manage occurrences</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Title</FormLabel>
                    <FormControl>
                      <Input
                        data-testid="input-title"
                        placeholder="Event title"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="eventTypeId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Event Type</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value || ""}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-event-type">
                          <SelectValue placeholder="Select an event type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {eventTypes.map((type) => (
                          <SelectItem key={type.id} value={type.id}>
                            {type.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        data-testid="input-description"
                        placeholder="Event description (optional)"
                        {...field}
                        value={field.value || ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {renderEventConfigOptions()}

              <Button
                type="submit"
                disabled={updateMutation.isPending}
                data-testid="button-save"
              >
                {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save Changes
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle>Occurrences</CardTitle>
              <CardDescription>
                {event.occurrences?.length || 0} occurrence{(event.occurrences?.length || 0) !== 1 ? "s" : ""} scheduled
              </CardDescription>
            </div>
            <Button
              onClick={() => setShowAddOccurrence(true)}
              data-testid="button-add-occurrence"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Occurrence
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!event.occurrences || event.occurrences.length === 0 ? (
            <div className="text-center text-muted-foreground py-8" data-testid="text-no-occurrences">
              No occurrences scheduled yet. Click "Add Occurrence" to schedule one.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
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
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setDeleteOccId(occ.id)}
                        data-testid={`button-delete-occurrence-${occ.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={showAddOccurrence} onOpenChange={setShowAddOccurrence}>
        <DialogContent data-testid="dialog-add-occurrence">
          <DialogHeader>
            <DialogTitle>Add Occurrence</DialogTitle>
            <DialogDescription>
              Schedule a new occurrence for this event
            </DialogDescription>
          </DialogHeader>
          <Form {...occurrenceForm}>
            <form onSubmit={occurrenceForm.handleSubmit(onAddOccurrence)} className="space-y-4">
              <FormField
                control={occurrenceForm.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        data-testid="input-occurrence-date"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={occurrenceForm.control}
                  name="startTime"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Start Time</FormLabel>
                      <FormControl>
                        <Input
                          type="time"
                          data-testid="input-occurrence-start-time"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={occurrenceForm.control}
                  name="endTime"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>End Time (optional)</FormLabel>
                      <FormControl>
                        <Input
                          type="time"
                          data-testid="input-occurrence-end-time"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={occurrenceForm.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes (optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        data-testid="input-occurrence-notes"
                        placeholder="Additional notes about this occurrence"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowAddOccurrence(false)}
                  data-testid="button-cancel-add-occurrence"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={addOccurrenceMutation.isPending}
                  data-testid="button-confirm-add-occurrence"
                >
                  {addOccurrenceMutation.isPending && (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  )}
                  Add Occurrence
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOccId !== null} onOpenChange={() => setDeleteOccId(null)}>
        <DialogContent data-testid="dialog-delete-occurrence">
          <DialogHeader>
            <DialogTitle>Delete Occurrence</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this occurrence? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteOccId(null)}
              data-testid="button-cancel-delete-occurrence"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteOccId && deleteOccurrenceMutation.mutate(deleteOccId)}
              disabled={deleteOccurrenceMutation.isPending}
              data-testid="button-confirm-delete-occurrence"
            >
              {deleteOccurrenceMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Create new event page (without layout - no ID yet)
function EventCreatePage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [eventConfig, setEventConfig] = useState<Record<string, any>>({});

  const { data: eventTypes = [] } = useQuery<EventType[]>({
    queryKey: ["/api/event-types"],
  });

  const { data: categories = [] } = useQuery<EventCategory[]>({
    queryKey: ["/api/event-categories"],
  });

  const form = useForm<CreateEventFormValues>({
    resolver: zodResolver(createEventFormSchema),
    defaultValues: {
      title: "",
      eventTypeId: undefined,
      description: "",
      data: undefined,
      startDate: "",
      startTime: "",
      endTime: "",
    },
  });

  const selectedEventTypeId = form.watch("eventTypeId");
  
  const selectedEventType = useMemo(() => 
    eventTypes.find(t => t.id === selectedEventTypeId),
    [eventTypes, selectedEventTypeId]
  );

  const selectedCategory = useMemo(() => 
    categories.find(c => c.id === selectedEventType?.category),
    [categories, selectedEventType]
  );

  const eventConfigOptions = useMemo(() => 
    selectedCategory?.configOptions.filter(
      opt => opt.scope === "event" || opt.scope === "both"
    ) || [],
    [selectedCategory]
  );

  // Reset eventConfig when event type/category changes
  useEffect(() => {
    const newConfig: Record<string, any> = {};
    for (const opt of eventConfigOptions) {
      if (opt.defaultValue !== undefined) {
        newConfig[opt.key] = opt.defaultValue;
      }
    }
    setEventConfig(newConfig);
  }, [selectedCategory?.id]);

  const renderCreateEventConfigOptions = () => {
    if (eventConfigOptions.length === 0) return null;
    
    return (
      <div className="space-y-3 border-t pt-4 mt-4">
        <Label className="text-sm font-medium">Event Configuration</Label>
        <p className="text-xs text-muted-foreground">
          Category: {selectedCategory?.label || "Unknown"}
        </p>
        {eventConfigOptions.map((opt) => (
          <div key={opt.key} className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <Label className="text-sm">{opt.label}</Label>
              {opt.description && (
                <p className="text-xs text-muted-foreground">{opt.description}</p>
              )}
            </div>
            {opt.type === "boolean" ? (
              <Switch
                checked={eventConfig[opt.key] ?? opt.defaultValue ?? false}
                onCheckedChange={(checked) => 
                  setEventConfig(prev => ({ ...prev, [opt.key]: checked }))
                }
                data-testid={`switch-create-config-${opt.key}`}
              />
            ) : opt.type === "number" ? (
              <Input
                type="number"
                className="w-24"
                value={eventConfig[opt.key] ?? opt.defaultValue ?? ""}
                onChange={(e) => 
                  setEventConfig(prev => ({ 
                    ...prev, 
                    [opt.key]: e.target.value ? Number(e.target.value) : undefined 
                  }))
                }
                data-testid={`input-create-config-${opt.key}`}
              />
            ) : (
              <Input
                className="w-48"
                value={eventConfig[opt.key] ?? opt.defaultValue ?? ""}
                onChange={(e) => 
                  setEventConfig(prev => ({ ...prev, [opt.key]: e.target.value }))
                }
                data-testid={`input-create-config-${opt.key}`}
              />
            )}
          </div>
        ))}
      </div>
    );
  };

  const createMutation = useMutation({
    mutationFn: async (data: CreateEventFormValues) => {
      const startAt = new Date(`${data.startDate}T${data.startTime}`);
      let endAt = null;
      if (data.endTime) {
        endAt = new Date(`${data.startDate}T${data.endTime}`);
      }
      // Filter config to only include valid keys for current category
      const validConfigKeys = new Set(eventConfigOptions.map(o => o.key));
      const filteredConfig: Record<string, any> = {};
      for (const key of Object.keys(eventConfig)) {
        if (validConfigKeys.has(key) && eventConfig[key] !== undefined && eventConfig[key] !== "") {
          filteredConfig[key] = eventConfig[key];
        }
      }
      const payload = {
        title: data.title,
        eventTypeId: data.eventTypeId || undefined,
        description: data.description || undefined,
        config: Object.keys(filteredConfig).length > 0 ? filteredConfig : null,
        data: data.data || undefined,
        occurrence: {
          startAt: startAt.toISOString(),
          endAt: endAt ? endAt.toISOString() : null,
          status: "active",
        },
      };
      return apiRequest("POST", "/api/events", payload);
    },
    onSuccess: (newEvent: Event) => {
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      toast({
        title: "Success",
        description: "Event created successfully.",
      });
      setLocation(`/events/${newEvent.id}`);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create event.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: CreateEventFormValues) => {
    createMutation.mutate(data);
  };

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
          <CardTitle data-testid="title-page">Create Event</CardTitle>
          <CardDescription>Create a new event</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Title</FormLabel>
                    <FormControl>
                      <Input
                        data-testid="input-title"
                        placeholder="Event title"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="eventTypeId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Event Type</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value || ""}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-event-type">
                          <SelectValue placeholder="Select an event type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {eventTypes.map((type) => (
                          <SelectItem key={type.id} value={type.id}>
                            {type.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        data-testid="input-description"
                        placeholder="Event description (optional)"
                        {...field}
                        value={field.value || ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {renderCreateEventConfigOptions()}

              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start Date</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        data-testid="input-start-date"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="startTime"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Start Time</FormLabel>
                      <FormControl>
                        <Input
                          type="time"
                          data-testid="input-start-time"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="endTime"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>End Time (optional)</FormLabel>
                      <FormControl>
                        <Input
                          type="time"
                          data-testid="input-end-time"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <Button
                type="submit"
                disabled={createMutation.isPending}
                data-testid="button-save"
              >
                {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create Event
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function EventEditPage() {
  const params = useParams<{ id: string }>();
  const isNew = !params.id;

  if (isNew) {
    return <EventCreatePage />;
  }

  return (
    <EventLayout activeTab="edit">
      <EventEditContent />
    </EventLayout>
  );
}
