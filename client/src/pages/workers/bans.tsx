import { useQuery, useMutation } from "@tanstack/react-query";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { Ban, Plus, Trash2, Pencil } from "lucide-react";
import type { WorkerBan } from "@shared/schema";
import { workerBanTypeEnum } from "@shared/schema";
import { format } from "date-fns";

const BAN_TYPE_LABELS: Record<string, string> = {
  dispatch: "Dispatch",
};

function BansContent() {
  const { worker } = useWorkerLayout();
  const { toast } = useToast();
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('staff');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingBan, setEditingBan] = useState<WorkerBan | null>(null);
  const [formType, setFormType] = useState<string>("dispatch");
  const [formStartDate, setFormStartDate] = useState<string>("");
  const [formEndDate, setFormEndDate] = useState<string>("");
  const [formMessage, setFormMessage] = useState<string>("");

  const { data: bans = [], isLoading } = useQuery<WorkerBan[]>({
    queryKey: ["/api/worker-bans/worker", worker.id],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { workerId: string; type: string; startDate: string; endDate?: string | null; message?: string | null }) => {
      return apiRequest("POST", "/api/worker-bans", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-bans/worker", worker.id] });
      toast({
        title: "Ban added",
        description: "The worker ban has been added.",
      });
      closeModal();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add ban.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<{ type: string; startDate: string; endDate: string | null; message: string | null }> }) => {
      return apiRequest("PUT", `/api/worker-bans/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-bans/worker", worker.id] });
      toast({
        title: "Ban updated",
        description: "The worker ban has been updated.",
      });
      closeModal();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update ban.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/worker-bans/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-bans/worker", worker.id] });
      toast({
        title: "Ban removed",
        description: "The worker ban has been removed.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to remove ban.",
        variant: "destructive",
      });
    },
  });

  const openAddModal = () => {
    setEditingBan(null);
    setFormType("dispatch");
    setFormStartDate(format(new Date(), "yyyy-MM-dd"));
    setFormEndDate("");
    setFormMessage("");
    setIsModalOpen(true);
  };

  const openEditModal = (ban: WorkerBan) => {
    setEditingBan(ban);
    setFormType(ban.type || "dispatch");
    setFormStartDate(ban.startDate ? format(new Date(ban.startDate), "yyyy-MM-dd") : "");
    setFormEndDate(ban.endDate ? format(new Date(ban.endDate), "yyyy-MM-dd") : "");
    setFormMessage(ban.message || "");
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingBan(null);
    setFormType("dispatch");
    setFormStartDate("");
    setFormEndDate("");
    setFormMessage("");
  };

  const handleSave = () => {
    if (!formStartDate) {
      toast({
        title: "Validation Error",
        description: "Start date is required.",
        variant: "destructive",
      });
      return;
    }

    if (editingBan) {
      updateMutation.mutate({
        id: editingBan.id,
        data: {
          type: formType,
          startDate: formStartDate,
          endDate: formEndDate || null,
          message: formMessage || null,
        },
      });
    } else {
      createMutation.mutate({
        workerId: worker.id,
        type: formType,
        startDate: formStartDate,
        endDate: formEndDate || null,
        message: formMessage || null,
      });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

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
              <Ban className="h-5 w-5" />
              <CardTitle>Worker Bans</CardTitle>
            </div>
            {canEdit && (
              <Button onClick={openAddModal} data-testid="button-add-ban">
                <Plus className="h-4 w-4 mr-2" />
                Add Ban
              </Button>
            )}
          </div>
          <CardDescription>
            Manage bans that restrict this worker from dispatch activities.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {bans.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground" data-testid="text-no-bans">
              No bans for this worker.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Start Date</TableHead>
                  <TableHead>End Date</TableHead>
                  <TableHead>Reason</TableHead>
                  {canEdit && <TableHead className="w-[120px]">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {bans.map((ban) => (
                  <TableRow key={ban.id} data-testid={`row-ban-${ban.id}`}>
                    <TableCell>
                      <Badge variant={ban.denormActive ? "destructive" : "secondary"}>
                        {ban.denormActive ? "Active" : "Expired"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {ban.type ? BAN_TYPE_LABELS[ban.type] || ban.type : <span className="text-muted-foreground">-</span>}
                    </TableCell>
                    <TableCell>
                      {ban.startDate ? format(new Date(ban.startDate), "MMM d, yyyy") : "-"}
                    </TableCell>
                    <TableCell>
                      {ban.endDate ? format(new Date(ban.endDate), "MMM d, yyyy") : <span className="text-muted-foreground">Indefinite</span>}
                    </TableCell>
                    <TableCell className="max-w-xs truncate">
                      {ban.message || <span className="text-muted-foreground">-</span>}
                    </TableCell>
                    {canEdit && (
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditModal(ban)}
                            data-testid={`button-edit-ban-${ban.id}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" data-testid={`button-delete-ban-${ban.id}`}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Remove Ban</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to remove this ban? This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => deleteMutation.mutate(ban.id)}
                                  data-testid={`button-confirm-delete-ban-${ban.id}`}
                                >
                                  Remove
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={isModalOpen} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingBan ? "Edit Ban" : "Add Ban"}</DialogTitle>
            <DialogDescription>
              {editingBan ? "Update the ban details below." : "Create a new ban for this worker."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="type">Type</Label>
              <Select value={formType} onValueChange={setFormType}>
                <SelectTrigger data-testid="select-ban-type">
                  <SelectValue placeholder="Select ban type" />
                </SelectTrigger>
                <SelectContent>
                  {workerBanTypeEnum.map((type) => (
                    <SelectItem key={type} value={type} data-testid={`select-ban-type-${type}`}>
                      {BAN_TYPE_LABELS[type] || type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="startDate">Start Date</Label>
              <Input
                id="startDate"
                type="date"
                value={formStartDate}
                onChange={(e) => setFormStartDate(e.target.value)}
                data-testid="input-ban-start-date"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endDate">End Date (optional)</Label>
              <Input
                id="endDate"
                type="date"
                value={formEndDate}
                onChange={(e) => setFormEndDate(e.target.value)}
                data-testid="input-ban-end-date"
              />
              <p className="text-xs text-muted-foreground">
                Leave empty for an indefinite ban.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="message">Message (optional)</Label>
              <Textarea
                id="message"
                value={formMessage}
                onChange={(e) => setFormMessage(e.target.value)}
                placeholder="Reason for the ban..."
                data-testid="textarea-ban-message"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeModal} disabled={isPending} data-testid="button-cancel-ban">
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isPending} data-testid="button-save-ban">
              {isPending ? "Saving..." : (editingBan ? "Save Changes" : "Add Ban")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function WorkerBansPage() {
  return (
    <WorkerLayout activeTab="bans">
      <BansContent />
    </WorkerLayout>
  );
}
