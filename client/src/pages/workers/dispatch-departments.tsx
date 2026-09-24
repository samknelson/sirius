import { useQuery, useMutation } from "@tanstack/react-query";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import { useState } from "react";
import { Building, Plus, Trash2 } from "lucide-react";
import type { WorkerDispatchDepartment } from "@shared/schema";
import { useAuth } from "@/contexts/AuthContext";

interface AvailableDepartment {
  id: string;
  name: string;
}

function DispatchDepartmentsContent() {
  const { worker } = useWorkerLayout();
  const { toast } = useToast();
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("staff");
  const [isAdding, setIsAdding] = useState(false);
  const [newDepartmentId, setNewDepartmentId] = useState<string>("");
  const [newPreference, setNewPreference] = useState<string>("");

  const { data: entries = [], isLoading } = useQuery<WorkerDispatchDepartment[]>({
    queryKey: ["/api/worker-dispatch-departments/worker", worker.id],
  });

  const { data: departments = [] } = useQuery<AvailableDepartment[]>({
    queryKey: ["/api/dispatch-departments/available"],
  });

  const departmentName = (id: string) =>
    departments.find((d) => d.id === id)?.name || "Unknown Department";

  const currentMode = entries.length > 0 ? entries[0].preference : null;
  const usedDepartmentIds = new Set(entries.map((e) => e.departmentId));
  const selectableDepartments = departments.filter((d) => !usedDepartmentIds.has(d.id));

  const createMutation = useMutation({
    mutationFn: async (data: { workerId: string; departmentId: string; preference: string }) => {
      return apiRequest("POST", "/api/worker-dispatch-departments", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-dispatch-departments/worker", worker.id] });
      toast({ title: "Department added", description: "The department preference has been added." });
      setIsAdding(false);
      setNewDepartmentId("");
      setNewPreference("");
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: getApiErrorMessage(error, "Failed to add department preference."),
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/worker-dispatch-departments/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-dispatch-departments/worker", worker.id] });
      toast({ title: "Department removed", description: "The department preference has been removed." });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: getApiErrorMessage(error, "Failed to remove department preference."),
        variant: "destructive",
      });
    },
  });

  const handleAdd = () => {
    const preference = currentMode ?? newPreference;
    if (!newDepartmentId || !preference) {
      toast({
        title: "Validation Error",
        description: !newDepartmentId ? "Please select a department." : "Please choose include or exclude.",
        variant: "destructive",
      });
      return;
    }
    createMutation.mutate({
      workerId: worker.id,
      departmentId: newDepartmentId,
      preference,
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
              <Building className="h-5 w-5" />
              <CardTitle>Department Preferences</CardTitle>
            </div>
            {canEdit && !isAdding && (
              <Button onClick={() => setIsAdding(true)} data-testid="button-add-department">
                <Plus className="h-4 w-4 mr-2" />
                Add Department
              </Button>
            )}
          </div>
          <CardDescription>
            {currentMode === "include"
              ? "This worker will only be dispatched to jobs in the departments listed below."
              : currentMode === "exclude"
                ? "This worker will not be dispatched to jobs in the departments listed below."
                : "Choose departments to include (only these) or exclude (all but these) for dispatch. A worker uses one mode at a time."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isAdding && (
            <div className="border rounded-md p-4 mb-6 space-y-4 bg-muted/30">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="department">Department</Label>
                  <Select value={newDepartmentId} onValueChange={setNewDepartmentId}>
                    <SelectTrigger id="department" data-testid="select-department">
                      <SelectValue placeholder="Select department" />
                    </SelectTrigger>
                    <SelectContent>
                      {selectableDepartments.map((department) => (
                        <SelectItem key={department.id} value={department.id}>
                          {department.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="preference">Preference</Label>
                  {currentMode ? (
                    <div className="flex items-center h-9 px-3 border rounded-md bg-muted text-muted-foreground" data-testid="text-locked-preference">
                      {currentMode === "include" ? "Include" : "Exclude"}
                    </div>
                  ) : (
                    <Select value={newPreference} onValueChange={setNewPreference}>
                      <SelectTrigger id="preference" data-testid="select-preference">
                        <SelectValue placeholder="Include or exclude" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="include">Include (only these departments)</SelectItem>
                        <SelectItem value="exclude">Exclude (all but these departments)</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleAdd} disabled={createMutation.isPending} data-testid="button-save-department">
                  {createMutation.isPending ? "Adding..." : "Add Department"}
                </Button>
                <Button variant="outline" onClick={() => setIsAdding(false)} disabled={createMutation.isPending} data-testid="button-cancel-department">
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {entries.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground" data-testid="text-no-department-entries">
              No department preferences for this worker. All departments are allowed.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Department</TableHead>
                  <TableHead>Preference</TableHead>
                  {canEdit && <TableHead className="w-[100px]">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id} data-testid={`row-department-${entry.id}`}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Building className="h-4 w-4 text-muted-foreground" />
                        <span data-testid={`text-department-name-${entry.id}`}>{departmentName(entry.departmentId)}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={entry.preference === "include" ? "default" : "secondary"}>
                        {entry.preference === "include" ? "Include" : "Exclude"}
                      </Badge>
                    </TableCell>
                    {canEdit && (
                      <TableCell>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" data-testid={`button-delete-department-${entry.id}`}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove Department</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to remove {departmentName(entry.departmentId)} from this worker's department preferences?
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteMutation.mutate(entry.id)}
                                data-testid={`button-confirm-delete-department-${entry.id}`}
                              >
                                Remove
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    )}
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

export default function WorkerDispatchDepartmentsPage() {
  return (
    <WorkerLayout activeTab="dispatch-departments">
      <DispatchDepartmentsContent />
    </WorkerLayout>
  );
}
