import { useQuery, useMutation } from "@tanstack/react-query";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { Building2, Plus, Trash2, Clock } from "lucide-react";
import type { WorkerDispatchHfe } from "@shared/schema";
import { format } from "date-fns";

interface Employer {
  id: string;
  name: string;
}

interface HfeWithEmployer extends WorkerDispatchHfe {
  employer?: Employer | null;
}

function DispatchHoldForEmployerContent() {
  const { worker } = useWorkerLayout();
  const { toast } = useToast();
  const [isAdding, setIsAdding] = useState(false);
  const [newEmployerId, setNewEmployerId] = useState<string>("");
  const [newHoldUntil, setNewHoldUntil] = useState<string>("");

  const { data: hfeEntries = [], isLoading } = useQuery<HfeWithEmployer[]>({
    queryKey: ["/api/worker-dispatch-hfe/worker", worker.id],
  });

  const { data: employers = [] } = useQuery<Employer[]>({
    queryKey: ["/api/employers"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { workerId: string; employerId: string; holdUntil: string }) => {
      return apiRequest("POST", "/api/worker-dispatch-hfe", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-dispatch-hfe/worker", worker.id] });
      toast({
        title: "Entry added",
        description: "The Hold for Employer entry has been added.",
      });
      setIsAdding(false);
      setNewEmployerId("");
      setNewHoldUntil("");
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add entry.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/worker-dispatch-hfe/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-dispatch-hfe/worker", worker.id] });
      toast({
        title: "Entry removed",
        description: "The Hold for Employer entry has been removed.",
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

  const getTomorrowDate = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  };

  const handleAdd = () => {
    if (!newEmployerId) {
      toast({
        title: "Validation Error",
        description: "Please select an employer.",
        variant: "destructive",
      });
      return;
    }
    if (!newHoldUntil) {
      toast({
        title: "Validation Error",
        description: "Hold until date is required.",
        variant: "destructive",
      });
      return;
    }
    const selectedDate = new Date(newHoldUntil);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (selectedDate <= today) {
      toast({
        title: "Validation Error",
        description: "Hold until date must be in the future.",
        variant: "destructive",
      });
      return;
    }
    createMutation.mutate({
      workerId: worker.id,
      employerId: newEmployerId,
      holdUntil: newHoldUntil,
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
              <Clock className="h-5 w-5" />
              <CardTitle>Hold for Employer</CardTitle>
            </div>
            {!isAdding && (
              <Button onClick={() => setIsAdding(true)} data-testid="button-add-hfe">
                <Plus className="h-4 w-4 mr-2" />
                Add Entry
              </Button>
            )}
          </div>
          <CardDescription>
            Manage employers that have a hold on this worker for dispatch until a specified date.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isAdding && (
            <div className="border rounded-md p-4 mb-6 space-y-4 bg-muted/30">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="employer">Employer</Label>
                  <Select value={newEmployerId} onValueChange={setNewEmployerId}>
                    <SelectTrigger id="employer" data-testid="select-hfe-employer">
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
                  <Label htmlFor="holdUntil">Hold Until <span className="text-destructive">*</span></Label>
                  <input
                    type="date"
                    id="holdUntil"
                    value={newHoldUntil}
                    min={getTomorrowDate()}
                    onChange={(e) => setNewHoldUntil(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    data-testid="input-hfe-hold-until"
                    required
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleAdd} disabled={createMutation.isPending} data-testid="button-save-hfe">
                  {createMutation.isPending ? "Adding..." : "Add Entry"}
                </Button>
                <Button variant="outline" onClick={() => setIsAdding(false)} disabled={createMutation.isPending} data-testid="button-cancel-hfe">
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {hfeEntries.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground" data-testid="text-no-hfe-entries">
              No Hold for Employer entries for this worker.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employer</TableHead>
                  <TableHead>Hold Until</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {hfeEntries.map((entry) => (
                  <TableRow key={entry.id} data-testid={`row-hfe-${entry.id}`}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        {entry.employer?.name || "Unknown Employer"}
                      </div>
                    </TableCell>
                    <TableCell>
                      {entry.holdUntil ? format(new Date(entry.holdUntil), "MMM d, yyyy") : "-"}
                    </TableCell>
                    <TableCell>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" data-testid={`button-delete-hfe-${entry.id}`}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remove Entry</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to remove this Hold for Employer entry for {entry.employer?.name}?
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteMutation.mutate(entry.id)}
                              data-testid={`button-confirm-delete-hfe-${entry.id}`}
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

export default function WorkerDispatchHoldForEmployerPage() {
  return (
    <WorkerLayout activeTab="dispatch-hfe">
      <DispatchHoldForEmployerContent />
    </WorkerLayout>
  );
}
