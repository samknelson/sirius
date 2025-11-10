import { useState } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { WorkerLayout } from "@/components/layouts/WorkerLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Plus, Edit2, Trash2, Check, X, Briefcase } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertWorkerEmphistSchema, type WorkerEmphist, type Employer, type EmploymentStatus } from "@shared/schema";
import { z } from "zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";

const formSchema = insertWorkerEmphistSchema.omit({ workerId: true });
type FormData = z.infer<typeof formSchema>;

export default function WorkerEmploymentHistory() {
  const { id: workerId } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      employerId: "" as any,
      employmentStatus: null,
      position: null,
      date: null,
      home: false,
      note: null,
    },
  });

  const { data: emphist = [], isLoading: isLoadingEmphist } = useQuery<WorkerEmphist[]>({
    queryKey: ["/api/workers", workerId, "emphist"],
    enabled: !!workerId,
  });

  const { data: employers = [] } = useQuery<Employer[]>({
    queryKey: ["/api/employers"],
  });

  const { data: employmentStatuses = [] } = useQuery<EmploymentStatus[]>({
    queryKey: ["/api/employment-statuses"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      return apiRequest("POST", `/api/workers/${workerId}/emphist`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers", workerId, "emphist"] });
      setIsAddDialogOpen(false);
      form.reset();
      toast({
        title: "Success",
        description: "Employment history record created successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create employment history record.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<FormData> }) => {
      return apiRequest("PUT", `/api/worker-emphist/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers", workerId, "emphist"] });
      setEditingId(null);
      toast({
        title: "Success",
        description: "Employment history record updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update employment history record.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/worker-emphist/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers", workerId, "emphist"] });
      setDeleteId(null);
      toast({
        title: "Success",
        description: "Employment history record deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete employment history record.",
        variant: "destructive",
      });
    },
  });

  const handleAdd = (data: FormData) => {
    createMutation.mutate(data);
  };

  const handleUpdate = (id: string, data: Partial<FormData>) => {
    updateMutation.mutate({ id, data });
  };

  const handleDelete = (id: string) => {
    deleteMutation.mutate(id);
  };

  const getEmployerName = (employerId: string | null) => {
    if (!employerId) return "—";
    const employer = employers.find((e) => e.id === employerId);
    return employer?.name || "Unknown";
  };

  const getStatusName = (statusId: string | null) => {
    if (!statusId) return "—";
    const status = employmentStatuses.find((s) => s.id === statusId);
    return status?.name || "Unknown";
  };

  return (
    <WorkerLayout activeTab="employment-history">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Briefcase className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Employment History</CardTitle>
            </div>
            <Button onClick={() => setIsAddDialogOpen(true)} size="sm" data-testid="button-add-employment-history">
              <Plus className="h-4 w-4 mr-2" />
              Add Record
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingEmphist ? (
            <div className="text-center py-8 text-muted-foreground">Loading employment history...</div>
          ) : emphist.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No employment history records found. Add one to get started.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Employer</TableHead>
                  <TableHead>Position</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Home</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {emphist.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell>{record.date ? format(new Date(record.date), "MMM dd, yyyy") : "—"}</TableCell>
                    <TableCell>{getEmployerName(record.employerId)}</TableCell>
                    <TableCell>{record.position || "—"}</TableCell>
                    <TableCell>{getStatusName(record.employmentStatus)}</TableCell>
                    <TableCell>{record.home ? "Yes" : "No"}</TableCell>
                    <TableCell className="max-w-xs truncate">{record.note || "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end space-x-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingId(record.id)}
                          data-testid={`button-edit-emphist-${record.id}`}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteId(record.id)}
                          data-testid={`button-delete-emphist-${record.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Employment History Record</DialogTitle>
            <DialogDescription>Add a new employment history entry for this worker.</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleAdd)} className="space-y-4">
              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} value={field.value || ""} data-testid="input-date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="employerId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Employer</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || ""}>
                      <FormControl>
                        <SelectTrigger data-testid="select-employer">
                          <SelectValue placeholder="Select employer" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {employers.map((employer) => (
                          <SelectItem key={employer.id} value={employer.id}>
                            {employer.name}
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
                name="position"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Position</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value || ""} data-testid="input-position" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="employmentStatus"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Employment Status</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || ""}>
                      <FormControl>
                        <SelectTrigger data-testid="select-employment-status">
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {employmentStatuses.map((status) => (
                          <SelectItem key={status.id} value={status.id}>
                            {status.name}
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
                name="home"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="checkbox-home"
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel>Home Employment</FormLabel>
                    </div>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="note"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Note</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value || ""} data-testid="input-note" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-add">
                  {createMutation.isPending ? "Adding..." : "Add"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      {editingId && (() => {
        const record = emphist.find((e) => e.id === editingId);
        if (!record) return null;

        const editForm = useForm<FormData>({
          resolver: zodResolver(formSchema),
          defaultValues: {
            employerId: record.employerId,
            employmentStatus: record.employmentStatus,
            position: record.position || "",
            date: record.date || "",
            home: record.home,
            note: record.note || "",
          },
        });

        return (
          <Dialog open={true} onOpenChange={() => setEditingId(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit Employment History Record</DialogTitle>
                <DialogDescription>Update the employment history entry.</DialogDescription>
              </DialogHeader>
              <Form {...editForm}>
                <form onSubmit={editForm.handleSubmit((data) => handleUpdate(editingId, data))} className="space-y-4">
                  <FormField
                    control={editForm.control}
                    name="date"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Date</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} value={field.value || ""} data-testid="input-edit-date" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={editForm.control}
                    name="employerId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Employer</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || ""}>
                          <FormControl>
                            <SelectTrigger data-testid="select-edit-employer">
                              <SelectValue placeholder="Select employer" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {employers.map((employer) => (
                              <SelectItem key={employer.id} value={employer.id}>
                                {employer.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={editForm.control}
                    name="position"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Position</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} data-testid="input-edit-position" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={editForm.control}
                    name="employmentStatus"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Employment Status</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || ""}>
                          <FormControl>
                            <SelectTrigger data-testid="select-edit-employment-status">
                              <SelectValue placeholder="Select status" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {employmentStatuses.map((status) => (
                              <SelectItem key={status.id} value={status.id}>
                                {status.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={editForm.control}
                    name="home"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            data-testid="checkbox-edit-home"
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>Home Employment</FormLabel>
                        </div>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={editForm.control}
                    name="note"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Note</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} data-testid="input-edit-note" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={updateMutation.isPending} data-testid="button-submit-edit">
                      {updateMutation.isPending ? "Saving..." : "Save"}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        );
      })()}

      {/* Delete Confirmation Dialog */}
      {deleteId && (() => {
        const record = emphist.find((e) => e.id === deleteId);
        if (!record) return null;

        return (
          <Dialog open={true} onOpenChange={() => setDeleteId(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete Employment History Record</DialogTitle>
                <DialogDescription>
                  Are you sure you want to delete this employment history record? This action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <div className="py-4">
                <p className="text-sm">
                  <strong>Date:</strong> {record.date ? format(new Date(record.date), "MMM dd, yyyy") : "—"}
                </p>
                <p className="text-sm">
                  <strong>Employer:</strong> {getEmployerName(record.employerId)}
                </p>
                <p className="text-sm">
                  <strong>Position:</strong> {record.position || "—"}
                </p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDeleteId(null)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => handleDelete(deleteId)}
                  disabled={deleteMutation.isPending}
                  data-testid="button-confirm-delete"
                >
                  {deleteMutation.isPending ? "Deleting..." : "Delete"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}
    </WorkerLayout>
  );
}
