import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface WorkStatus {
  id: string;
  name: string;
  code: string;
  description: string | null;
}

interface WorkerWshEntry {
  id: string;
  date: string;
  workerId: string;
  wsId: string;
  data: any;
  ws: WorkStatus | null;
}

function WorkerWorkStatusContent() {
  const { worker } = useWorkerLayout();
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedWsId, setSelectedWsId] = useState<string>("");
  const [editingEntry, setEditingEntry] = useState<WorkerWshEntry | null>(null);

  // Fetch worker work status history
  const { data: wshEntries = [], isLoading } = useQuery<WorkerWshEntry[]>({
    queryKey: ["/api/workers", worker.id, "wsh"],
    queryFn: async () => {
      const response = await fetch(`/api/workers/${worker.id}/wsh`);
      if (!response.ok) throw new Error("Failed to fetch work status history");
      return response.json();
    },
  });

  // Fetch work status options
  const { data: workStatuses = [] } = useQuery<WorkStatus[]>({
    queryKey: ["/api/options/worker-ws"],
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (data: { date: string; wsId: string; data?: any }) => {
      const response = await fetch(`/api/workers/${worker.id}/wsh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create work status entry");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers", worker.id, "wsh"] });
      toast({ title: "Success", description: "Work status entry created successfully" });
      setIsAddDialogOpen(false);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create work status entry",
        variant: "destructive",
      });
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { date: string; wsId: string; data?: any } }) => {
      const response = await fetch(`/api/worker-wsh/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to update work status entry");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers", worker.id, "wsh"] });
      toast({ title: "Success", description: "Work status entry updated successfully" });
      setIsEditDialogOpen(false);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update work status entry",
        variant: "destructive",
      });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/worker-wsh/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to delete work status entry");
      }
      return response.status === 204 ? null : response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers", worker.id, "wsh"] });
      toast({ title: "Success", description: "Work status entry deleted successfully" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete work status entry",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setSelectedDate("");
    setSelectedWsId("");
    setEditingEntry(null);
  };

  const handleCreate = () => {
    if (!selectedDate || !selectedWsId) {
      toast({
        title: "Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    createMutation.mutate({
      date: selectedDate,
      wsId: selectedWsId,
    });
  };

  const handleEdit = (entry: WorkerWshEntry) => {
    setEditingEntry(entry);
    setSelectedDate(entry.date);
    setSelectedWsId(entry.wsId);
    setIsEditDialogOpen(true);
  };

  const handleUpdate = () => {
    if (!editingEntry || !selectedDate || !selectedWsId) {
      toast({
        title: "Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    updateMutation.mutate({
      id: editingEntry.id,
      data: {
        date: selectedDate,
        wsId: selectedWsId,
      },
    });
  };

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this work status entry?")) {
      deleteMutation.mutate(id);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Work Status History</CardTitle>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-add-work-status">
              <Plus size={16} className="mr-2" />
              Add Entry
            </Button>
          </DialogTrigger>
          <DialogContent data-testid="dialog-add-work-status">
            <DialogHeader>
              <DialogTitle>Add Work Status Entry</DialogTitle>
              <DialogDescription>
                Add a new work status entry for this worker.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="date">Date</Label>
                <Input
                  id="date"
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  data-testid="input-date"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wsId">Work Status</Label>
                <Select value={selectedWsId} onValueChange={setSelectedWsId}>
                  <SelectTrigger data-testid="select-work-status">
                    <SelectValue placeholder="Select a work status" />
                  </SelectTrigger>
                  <SelectContent>
                    {workStatuses.map((ws) => (
                      <SelectItem key={ws.id} value={ws.id} data-testid={`option-work-status-${ws.id}`}>
                        {ws.name} ({ws.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setIsAddDialogOpen(false);
                  resetForm();
                }}
                data-testid="button-cancel-add"
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={createMutation.isPending}
                data-testid="button-confirm-add"
              >
                {createMutation.isPending ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading...</div>
        ) : wshEntries.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No work status entries found. Click "Add Entry" to create one.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Work Status</TableHead>
                <TableHead>Code</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {wshEntries.map((entry) => (
                <TableRow key={entry.id} data-testid={`row-work-status-${entry.id}`}>
                  <TableCell data-testid={`text-date-${entry.id}`}>{formatDate(entry.date)}</TableCell>
                  <TableCell data-testid={`text-name-${entry.id}`}>{entry.ws?.name || "Unknown"}</TableCell>
                  <TableCell data-testid={`text-code-${entry.id}`}>{entry.ws?.code || "N/A"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEdit(entry)}
                        data-testid={`button-edit-${entry.id}`}
                      >
                        <Pencil size={16} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(entry.id)}
                        disabled={deleteMutation.isPending}
                        data-testid={`button-delete-${entry.id}`}
                      >
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* Edit Dialog */}
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent data-testid="dialog-edit-work-status">
            <DialogHeader>
              <DialogTitle>Edit Work Status Entry</DialogTitle>
              <DialogDescription>
                Update the work status entry for this worker.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-date">Date</Label>
                <Input
                  id="edit-date"
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  data-testid="input-edit-date"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-wsId">Work Status</Label>
                <Select value={selectedWsId} onValueChange={setSelectedWsId}>
                  <SelectTrigger data-testid="select-edit-work-status">
                    <SelectValue placeholder="Select a work status" />
                  </SelectTrigger>
                  <SelectContent>
                    {workStatuses.map((ws) => (
                      <SelectItem key={ws.id} value={ws.id} data-testid={`option-edit-work-status-${ws.id}`}>
                        {ws.name} ({ws.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setIsEditDialogOpen(false);
                  resetForm();
                }}
                data-testid="button-cancel-edit"
              >
                Cancel
              </Button>
              <Button
                onClick={handleUpdate}
                disabled={updateMutation.isPending}
                data-testid="button-confirm-edit"
              >
                {updateMutation.isPending ? "Updating..." : "Update"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

export default function WorkerWorkStatus() {
  return (
    <WorkerLayout activeTab="work-status">
      <WorkerWorkStatusContent />
    </WorkerLayout>
  );
}
