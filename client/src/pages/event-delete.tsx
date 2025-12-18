import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Loader2, AlertTriangle } from "lucide-react";
import EventLayout, { useEventLayout } from "@/components/layouts/EventLayout";

function EventDeleteContent() {
  const { event } = useEventLayout();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const deleteMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("DELETE", `/api/events/${event.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      toast({
        title: "Success",
        description: "Event deleted successfully.",
      });
      setLocation("/events");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete event.",
        variant: "destructive",
      });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <AlertTriangle size={20} />
          Delete Event
        </CardTitle>
        <CardDescription>
          This action cannot be undone
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="bg-destructive/10 border border-destructive/20 rounded-md p-4">
          <p className="text-sm text-foreground">
            You are about to permanently delete the event <strong>"{event.title}"</strong>.
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            This will also delete all {event.occurrences?.length || 0} scheduled occurrence{(event.occurrences?.length || 0) !== 1 ? "s" : ""}.
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <Button
            variant="destructive"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
            data-testid="button-confirm-delete"
          >
            {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Delete Event
          </Button>
          <Button
            variant="outline"
            onClick={() => setLocation(`/events/${event.id}`)}
            disabled={deleteMutation.isPending}
            data-testid="button-cancel-delete"
          >
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function EventDeletePage() {
  return (
    <EventLayout activeTab="delete">
      <EventDeleteContent />
    </EventLayout>
  );
}
