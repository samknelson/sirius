import { useQuery, useMutation } from "@tanstack/react-query";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { PhoneOff, Plus, Trash2, Building2 } from "lucide-react";
import type { WorkerDispatchDnc } from "@shared/schema";

interface Employer {
  id: string;
  name: string;
}

interface DncWithEmployer extends WorkerDispatchDnc {
  employer?: Employer | null;
}

function DispatchDoNotCallContent() {
  const { worker } = useWorkerLayout();
  const { toast } = useToast();
  const [isAdding, setIsAdding] = useState(false);
  const [newEmployerId, setNewEmployerId] = useState<string>("");
  const [newType, setNewType] = useState<string>("employer");
  const [newMessage, setNewMessage] = useState<string>("");

  const { data: dncEntries = [], isLoading } = useQuery<DncWithEmployer[]>({
    queryKey: ["/api/worker-dispatch-dnc/worker", worker.id],
  });

  const { data: employers = [] } = useQuery<Employer[]>({
    queryKey: ["/api/employers/lookup"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { workerId: string; employerId: string; type: string; message: string | null }) => {
      return apiRequest("POST", "/api/worker-dispatch-dnc", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-dispatch-dnc/worker", worker.id] });
      toast({
        title: "Entry added",
        description: "The Do Not Call entry has been added.",
      });
      setIsAdding(false);
      setNewEmployerId("");
      setNewType("employer");
      setNewMessage("");
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add entry. The combination may already exist.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/worker-dispatch-dnc/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-dispatch-dnc/worker", worker.id] });
      toast({
        title: "Entry removed",
        description: "The Do Not Call entry has been removed.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to remove entry.",
        variant: "destructive",
      });
    },
  });

  const handleAdd = () => {
    if (!newEmployerId) {
      toast({
        title: "Validation Error",
        description: "Please select an employer.",
        variant: "destructive",
      });
      return;
    }
    createMutation.mutate({
      workerId: worker.id,
      employerId: newEmployerId,
      type: newType,
      message: newMessage || null,
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64 mt-2" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <PhoneOff className="h-5 w-5" />
              <CardTitle>Do Not Call List</CardTitle>
            </div>
            {!isAdding && (
              <Button onClick={() => setIsAdding(true)} data-testid="button-add-dnc">
                <Plus className="h-4 w-4 mr-2" />
                Add Entry
              </Button>
            )}
          </div>
          <CardDescription>
            Manage employers that should not contact this worker for dispatch.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isAdding && (
            <div className="border rounded-md p-4 mb-6 space-y-4 bg-muted/30">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="employer">Employer</Label>
                  <Select value={newEmployerId} onValueChange={setNewEmployerId}>
                    <SelectTrigger id="employer" data-testid="select-dnc-employer">
                      <SelectValue placeholder="Select employer" />
                    </SelectTrigger>
                    <SelectContent>
                      {employers.map((employer) => (
                        <SelectItem key={employer.id} value={employer.id}>
                          {employer.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="type">Type</Label>
                  <Select value={newType} onValueChange={setNewType}>
                    <SelectTrigger id="type" data-testid="select-dnc-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="employer">Employer</SelectItem>
                      <SelectItem value="worker">Worker</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="message">Message (optional)</Label>
                <Textarea
                  id="message"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Reason or notes for this entry..."
                  data-testid="textarea-dnc-message"
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={handleAdd} disabled={createMutation.isPending} data-testid="button-save-dnc">
                  {createMutation.isPending ? "Adding..." : "Add Entry"}
                </Button>
                <Button variant="outline" onClick={() => setIsAdding(false)} disabled={createMutation.isPending} data-testid="button-cancel-dnc">
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {dncEntries.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground" data-testid="text-no-dnc-entries">
              No Do Not Call entries for this worker.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employer</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dncEntries.map((entry) => (
                  <TableRow key={entry.id} data-testid={`row-dnc-${entry.id}`}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        {entry.employer?.name || "Unknown Employer"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={entry.type === "employer" ? "default" : "secondary"}>
                        {entry.type === "employer" ? "Employer" : "Worker"}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-xs truncate">
                      {entry.message || <span className="text-muted-foreground">-</span>}
                    </TableCell>
                    <TableCell>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" data-testid={`button-delete-dnc-${entry.id}`}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remove Entry</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to remove this Do Not Call entry for {entry.employer?.name}?
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteMutation.mutate(entry.id)}
                              data-testid={`button-confirm-delete-dnc-${entry.id}`}
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

export default function WorkerDispatchDoNotCallPage() {
  return (
    <WorkerLayout activeTab="dispatch-dnc">
      <DispatchDoNotCallContent />
    </WorkerLayout>
  );
}
