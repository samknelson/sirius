import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import EventLayout, { useEventLayout } from "@/components/layouts/EventLayout";
import { UserPlus, Search } from "lucide-react";

interface WorkerWithDetails {
  id: string;
  sirius_id: number | null;
  contact_id: string;
  contact_name: string | null;
  given: string | null;
  family: string | null;
}

function EventRegisterContent() {
  const { event, category } = useEventLayout();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);

  const { data: workers = [], isLoading: workersLoading } = useQuery<WorkerWithDetails[]>({
    queryKey: ["/api/workers/with-details"],
  });

  const { data: categoryData } = useQuery({
    queryKey: ["/api/event-categories", category],
    enabled: !!category,
  });

  const registerMutation = useMutation({
    mutationFn: async (data: { contactId: string; role: string; status: string }) => {
      return apiRequest("POST", `/api/events/${event.id}/register`, data);
    },
    onSuccess: () => {
      toast({
        title: "Registration successful",
        description: "The worker has been registered for this event.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/events", event.id, "participants"] });
      setSelectedContactId(null);
      setSearchTerm("");
    },
    onError: (error: any) => {
      toast({
        title: "Registration failed",
        description: error.message || "Failed to register worker",
        variant: "destructive",
      });
    },
  });

  const filteredWorkers = workers.filter((worker) => {
    if (!searchTerm) return true;
    const displayName = worker.contact_name?.toLowerCase() || "";
    const siriusId = worker.sirius_id?.toString() || "";
    return displayName.includes(searchTerm.toLowerCase()) || siriusId.includes(searchTerm);
  });

  const handleRegister = () => {
    if (!selectedContactId) {
      toast({
        title: "No worker selected",
        description: "Please select a worker to register.",
        variant: "destructive",
      });
      return;
    }

    registerMutation.mutate({
      contactId: selectedContactId,
      role: "member",
      status: "attended",
    });
  };

  const roles = (categoryData as any)?.roles || [];
  const statuses = (categoryData as any)?.statuses || [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Register Worker
          </CardTitle>
          <CardDescription>
            Register a worker for this membership event. They will be added with role "member" and status "attended".
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="worker-search">Search Workers</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="worker-search"
                  placeholder="Search by name or Sirius ID..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                  data-testid="input-worker-search"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="worker-select">Select Worker</Label>
              <Select
                value={selectedContactId || ""}
                onValueChange={(value) => setSelectedContactId(value)}
              >
                <SelectTrigger data-testid="select-worker">
                  <SelectValue placeholder="Choose a worker..." />
                </SelectTrigger>
                <SelectContent>
                  {workersLoading ? (
                    <SelectItem value="loading" disabled>Loading workers...</SelectItem>
                  ) : filteredWorkers.length === 0 ? (
                    <SelectItem value="none" disabled>No workers found</SelectItem>
                  ) : (
                    filteredWorkers.slice(0, 50).map((worker) => (
                      <SelectItem
                        key={worker.id}
                        value={worker.contact_id}
                        data-testid={`select-worker-option-${worker.id}`}
                      >
                        {worker.contact_name || "Unknown"} (#{worker.sirius_id})
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {filteredWorkers.length > 50 && (
                <p className="text-sm text-muted-foreground">
                  Showing first 50 results. Use search to narrow down.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Role</Label>
                <div className="p-2 bg-muted rounded-md text-sm" data-testid="text-role">
                  Member
                </div>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <div className="p-2 bg-muted rounded-md text-sm" data-testid="text-status">
                  Attended
                </div>
              </div>
            </div>
          </div>

          <Button
            onClick={handleRegister}
            disabled={!selectedContactId || registerMutation.isPending}
            className="w-full"
            data-testid="button-register"
          >
            {registerMutation.isPending ? "Registering..." : "Register Worker"}
          </Button>
        </CardContent>
      </Card>

      {roles.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Available Roles</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {roles.map((role: any) => (
                <div
                  key={role.id}
                  className="px-3 py-1 bg-muted rounded-md text-sm"
                  data-testid={`text-role-${role.id}`}
                >
                  {role.label}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {statuses.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Available Statuses</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {statuses.map((status: any) => (
                <div
                  key={status.id}
                  className="px-3 py-1 bg-muted rounded-md text-sm"
                  data-testid={`text-status-${status.id}`}
                >
                  {status.label}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function EventRegisterPage() {
  return (
    <EventLayout activeTab="register">
      <EventRegisterContent />
    </EventLayout>
  );
}
