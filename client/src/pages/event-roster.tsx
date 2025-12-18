import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import EventLayout, { useEventLayout } from "@/components/layouts/EventLayout";
import { Users, Trash2 } from "lucide-react";
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

interface Participant {
  id: string;
  eventId: string;
  contactId: string;
  role: string;
  status: string | null;
  contact: {
    id: string;
    given: string | null;
    family: string | null;
    displayName: string;
  } | null;
}

function EventRosterContent() {
  const { event, category } = useEventLayout();
  const { toast } = useToast();

  const { data: participants = [], isLoading } = useQuery<Participant[]>({
    queryKey: ["/api/events", event.id, "participants"],
  });

  const { data: categoryData } = useQuery({
    queryKey: ["/api/event-categories", category],
    enabled: !!category,
  });

  const updateMutation = useMutation({
    mutationFn: async ({ participantId, data }: { participantId: string; data: { role?: string; status?: string } }) => {
      return apiRequest("PATCH", `/api/events/${event.id}/participants/${participantId}`, data);
    },
    onSuccess: () => {
      toast({
        title: "Updated",
        description: "Participant updated successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/events", event.id, "participants"] });
    },
    onError: (error: any) => {
      toast({
        title: "Update failed",
        description: error.message || "Failed to update participant",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (participantId: string) => {
      return apiRequest("DELETE", `/api/events/${event.id}/participants/${participantId}`);
    },
    onSuccess: () => {
      toast({
        title: "Removed",
        description: "Participant removed from event.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/events", event.id, "participants"] });
    },
    onError: (error: any) => {
      toast({
        title: "Removal failed",
        description: error.message || "Failed to remove participant",
        variant: "destructive",
      });
    },
  });

  const roles = (categoryData as any)?.roles || [];
  const statuses = (categoryData as any)?.statuses || [];

  const getRoleBadgeVariant = (role: string) => {
    if (role === "organizer" || role === "instructor") return "default";
    return "secondary";
  };

  const getStatusBadgeVariant = (status: string | null) => {
    if (!status) return "outline";
    if (status === "attended" || status === "completed") return "default";
    if (status === "absent" || status === "dropout" || status === "no_show") return "destructive";
    return "secondary";
  };

  const handleStatusChange = (participantId: string, newStatus: string) => {
    updateMutation.mutate({ participantId, data: { status: newStatus } });
  };

  const handleRoleChange = (participantId: string, newRole: string) => {
    updateMutation.mutate({ participantId, data: { role: newRole } });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Event Roster
          </CardTitle>
          <CardDescription>
            {participants.length} participant{participants.length !== 1 ? "s" : ""} registered for this event
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground" data-testid="text-loading">
              Loading participants...
            </div>
          ) : participants.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground" data-testid="text-no-participants">
              No participants registered yet. Use the Register tab to add workers.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {participants.map((participant) => (
                  <TableRow key={participant.id} data-testid={`row-participant-${participant.id}`}>
                    <TableCell data-testid={`text-participant-name-${participant.id}`}>
                      {participant.contact?.displayName || "Unknown"}
                    </TableCell>
                    <TableCell>
                      {roles.length > 1 ? (
                        <Select
                          value={participant.role}
                          onValueChange={(value) => handleRoleChange(participant.id, value)}
                        >
                          <SelectTrigger 
                            className="w-[140px]" 
                            data-testid={`select-role-${participant.id}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {roles.map((role: any) => (
                              <SelectItem key={role.id} value={role.id}>
                                {role.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge 
                          variant={getRoleBadgeVariant(participant.role)}
                          data-testid={`badge-role-${participant.id}`}
                        >
                          {roles.find((r: any) => r.id === participant.role)?.label || participant.role}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {statuses.length > 0 ? (
                        <Select
                          value={participant.status || ""}
                          onValueChange={(value) => handleStatusChange(participant.id, value)}
                        >
                          <SelectTrigger 
                            className="w-[140px]" 
                            data-testid={`select-status-${participant.id}`}
                          >
                            <SelectValue placeholder="Set status" />
                          </SelectTrigger>
                          <SelectContent>
                            {statuses.map((status: any) => (
                              <SelectItem key={status.id} value={status.id}>
                                {status.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge 
                          variant={getStatusBadgeVariant(participant.status)}
                          data-testid={`badge-status-${participant.id}`}
                        >
                          {participant.status || "N/A"}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            data-testid={`button-remove-${participant.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remove Participant</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to remove {participant.contact?.displayName || "this participant"} from the event? This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel data-testid="button-cancel-remove">Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteMutation.mutate(participant.id)}
                              data-testid="button-confirm-remove"
                            >
                              Remove
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
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

export default function EventRosterPage() {
  return (
    <EventLayout activeTab="roster">
      <EventRosterContent />
    </EventLayout>
  );
}
