import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import EventLayout, { useEventLayout } from "@/components/layouts/EventLayout";
import { UserCheck, Clock, CheckCircle, XCircle } from "lucide-react";
import { format } from "date-fns";

interface SelfRegistration {
  id: string;
  eventId: string;
  contactId: string;
  role: string;
  status: string | null;
  registeredAt: string | null;
}

function EventSelfRegisterContent() {
  const { event } = useEventLayout();
  const { toast } = useToast();

  const { data: registration, isLoading } = useQuery<SelfRegistration | null>({
    queryKey: ["/api/events", event.id, "self-registration"],
  });

  const registerMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/events/${event.id}/self-register`);
    },
    onSuccess: () => {
      toast({
        title: "Registration successful",
        description: "You have been registered for this event.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/events", event.id, "self-registration"] });
      queryClient.invalidateQueries({ queryKey: ["/api/events", event.id, "participants"] });
    },
    onError: (error: any) => {
      toast({
        title: "Registration failed",
        description: error.message || "Failed to register for this event",
        variant: "destructive",
      });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async (newStatus: string) => {
      return apiRequest("PATCH", `/api/events/${event.id}/self-register`, { status: newStatus });
    },
    onSuccess: () => {
      toast({
        title: "Status updated",
        description: "Your registration status has been updated.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/events", event.id, "self-registration"] });
      queryClient.invalidateQueries({ queryKey: ["/api/events", event.id, "participants"] });
    },
    onError: (error: any) => {
      toast({
        title: "Update failed",
        description: error.message || "Failed to update status",
        variant: "destructive",
      });
    },
  });

  const handleRegister = () => {
    registerMutation.mutate();
  };

  const handleToggleStatus = () => {
    if (!registration) return;
    const newStatus = registration.status === "attended" ? "canceled" : "attended";
    updateStatusMutation.mutate(newStatus);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="py-12">
            <div className="flex items-center justify-center">
              <div className="animate-pulse text-muted-foreground">Loading...</div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserCheck className="h-5 w-5" />
            Self Registration
          </CardTitle>
          <CardDescription>
            Register yourself for this membership event.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {!registration ? (
            <div className="text-center py-8 space-y-4">
              <p className="text-muted-foreground">
                You are not currently registered for this event.
              </p>
              <Button
                onClick={handleRegister}
                disabled={registerMutation.isPending}
                data-testid="button-self-register"
              >
                {registerMutation.isPending ? "Registering..." : "Register for Event"}
              </Button>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Registration Status</span>
                    {registration.status === "attended" ? (
                      <Badge variant="default" className="flex items-center gap-1">
                        <CheckCircle className="h-3 w-3" />
                        Attended
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="flex items-center gap-1">
                        <XCircle className="h-3 w-3" />
                        Canceled
                      </Badge>
                    )}
                  </div>
                  {registration.registeredAt && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Clock className="h-4 w-4" />
                      <span>
                        Registered on {format(new Date(registration.registeredAt), "MMM d, yyyy 'at' h:mm a")}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-4">
                <Button
                  variant={registration.status === "attended" ? "destructive" : "default"}
                  onClick={handleToggleStatus}
                  disabled={updateStatusMutation.isPending}
                  data-testid="button-toggle-status"
                >
                  {updateStatusMutation.isPending
                    ? "Updating..."
                    : registration.status === "attended"
                    ? "Cancel Registration"
                    : "Mark as Attended"}
                </Button>
              </div>

              <div className="text-sm text-muted-foreground">
                <p>
                  <strong>Role:</strong> {registration.role}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function EventSelfRegisterPage() {
  return (
    <EventLayout activeTab="self-register">
      <EventSelfRegisterContent />
    </EventLayout>
  );
}
