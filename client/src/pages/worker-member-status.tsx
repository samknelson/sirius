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

interface MemberStatus {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  industryId: string;
}

interface Industry {
  id: string;
  name: string;
}

interface WorkerMshEntry {
  id: string;
  date: string;
  workerId: string;
  msId: string;
  industryId: string;
  data: any;
  ms: MemberStatus | null;
  industry: Industry | null;
}

function WorkerMemberStatusContent() {
  const { worker } = useWorkerLayout();
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedIndustryId, setSelectedIndustryId] = useState<string>("");
  const [selectedMsId, setSelectedMsId] = useState<string>("");
  const [editingEntry, setEditingEntry] = useState<WorkerMshEntry | null>(null);

  const { data: mshEntries = [], isLoading } = useQuery<WorkerMshEntry[]>({
    queryKey: ["/api/workers", worker.id, "msh"],
    queryFn: async () => {
      const response = await fetch(`/api/workers/${worker.id}/msh`);
      if (!response.ok) throw new Error("Failed to fetch member status history");
      return response.json();
    },
  });

  const { data: industries = [] } = useQuery<Industry[]>({
    queryKey: ["/api/options/industry"],
  });

  const { data: memberStatuses = [] } = useQuery<MemberStatus[]>({
    queryKey: ["/api/options/worker-ms"],
  });

  const filteredMemberStatuses = selectedIndustryId
    ? memberStatuses.filter((ms) => ms.industryId === selectedIndustryId)
    : [];

  const createMutation = useMutation({
    mutationFn: async (data: { date: string; msId: string; industryId: string; data?: any }) => {
      const response = await fetch(`/api/workers/${worker.id}/msh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create member status entry");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers", worker.id, "msh"] });
      toast({ title: "Success", description: "Member status entry created successfully" });
      setIsAddDialogOpen(false);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create member status entry",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { date: string; msId: string; industryId: string; data?: any } }) => {
      const response = await fetch(`/api/worker-msh/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to update member status entry");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers", worker.id, "msh"] });
      toast({ title: "Success", description: "Member status entry updated successfully" });
      setIsEditDialogOpen(false);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update member status entry",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/worker-msh/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to delete member status entry");
      }
      return response.status === 204 ? null : response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers", worker.id, "msh"] });
      toast({ title: "Success", description: "Member status entry deleted successfully" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete member status entry",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setSelectedDate("");
    setSelectedIndustryId("");
    setSelectedMsId("");
    setEditingEntry(null);
  };

  const handleCreate = () => {
    if (!selectedDate || !selectedIndustryId || !selectedMsId) {
      toast({
        title: "Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    createMutation.mutate({
      date: selectedDate,
      msId: selectedMsId,
      industryId: selectedIndustryId,
    });
  };

  const handleEdit = (entry: WorkerMshEntry) => {
    setEditingEntry(entry);
    setSelectedDate(entry.date);
    setSelectedIndustryId(entry.industryId);
    setSelectedMsId(entry.msId);
    setIsEditDialogOpen(true);
  };

  const handleUpdate = () => {
    if (!editingEntry || !selectedDate || !selectedIndustryId || !selectedMsId) {
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
        msId: selectedMsId,
        industryId: selectedIndustryId,
      },
    });
  };

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this member status entry?")) {
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

  const handleIndustryChange = (industryId: string) => {
    setSelectedIndustryId(industryId);
    setSelectedMsId("");
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Member Status History</CardTitle>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-add-member-status">
              <Plus size={16} className="mr-2" />
              Add Entry
            </Button>
          </DialogTrigger>
          <DialogContent data-testid="dialog-add-member-status">
            <DialogHeader>
              <DialogTitle>Add Member Status Entry</DialogTitle>
              <DialogDescription>
                Add a new member status entry for this worker. Select an industry first, then choose a member status.
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
                <Label htmlFor="industryId">Industry</Label>
                <Select value={selectedIndustryId} onValueChange={handleIndustryChange}>
                  <SelectTrigger data-testid="select-industry">
                    <SelectValue placeholder="Select an industry" />
                  </SelectTrigger>
                  <SelectContent>
                    {industries.map((industry) => (
                      <SelectItem key={industry.id} value={industry.id} data-testid={`option-industry-${industry.id}`}>
                        {industry.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="msId">Member Status</Label>
                <Select 
                  value={selectedMsId} 
                  onValueChange={setSelectedMsId}
                  disabled={!selectedIndustryId}
                >
                  <SelectTrigger data-testid="select-member-status">
                    <SelectValue placeholder={selectedIndustryId ? "Select a member status" : "Select an industry first"} />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredMemberStatuses.map((ms) => (
                      <SelectItem key={ms.id} value={ms.id} data-testid={`option-member-status-${ms.id}`}>
                        {ms.name} {ms.code ? `(${ms.code})` : ""}
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
        ) : mshEntries.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No member status entries found. Click "Add Entry" to create one.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Industry</TableHead>
                <TableHead>Member Status</TableHead>
                <TableHead>Code</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mshEntries.map((entry) => (
                <TableRow key={entry.id} data-testid={`row-member-status-${entry.id}`}>
                  <TableCell data-testid={`text-date-${entry.id}`}>{formatDate(entry.date)}</TableCell>
                  <TableCell data-testid={`text-industry-${entry.id}`}>{entry.industry?.name || "Unknown"}</TableCell>
                  <TableCell data-testid={`text-name-${entry.id}`}>{entry.ms?.name || "Unknown"}</TableCell>
                  <TableCell data-testid={`text-code-${entry.id}`}>{entry.ms?.code || "N/A"}</TableCell>
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

        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent data-testid="dialog-edit-member-status">
            <DialogHeader>
              <DialogTitle>Edit Member Status Entry</DialogTitle>
              <DialogDescription>
                Update the member status entry for this worker.
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
                <Label htmlFor="edit-industryId">Industry</Label>
                <Select value={selectedIndustryId} onValueChange={handleIndustryChange}>
                  <SelectTrigger data-testid="select-edit-industry">
                    <SelectValue placeholder="Select an industry" />
                  </SelectTrigger>
                  <SelectContent>
                    {industries.map((industry) => (
                      <SelectItem key={industry.id} value={industry.id} data-testid={`option-edit-industry-${industry.id}`}>
                        {industry.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-msId">Member Status</Label>
                <Select 
                  value={selectedMsId} 
                  onValueChange={setSelectedMsId}
                  disabled={!selectedIndustryId}
                >
                  <SelectTrigger data-testid="select-edit-member-status">
                    <SelectValue placeholder={selectedIndustryId ? "Select a member status" : "Select an industry first"} />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredMemberStatuses.map((ms) => (
                      <SelectItem key={ms.id} value={ms.id} data-testid={`option-edit-member-status-${ms.id}`}>
                        {ms.name} {ms.code ? `(${ms.code})` : ""}
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

export default function WorkerMemberStatus() {
  return (
    <WorkerLayout activeTab="member-status">
      <WorkerMemberStatusContent />
    </WorkerLayout>
  );
}
