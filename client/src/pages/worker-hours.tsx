import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Employer } from "@shared/schema";
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

interface EmploymentStatus {
  id: string;
  name: string;
  code: string;
  employed: boolean;
  description: string | null;
}

interface WorkerHoursEntry {
  id: string;
  month: number;
  year: number;
  day: number;
  workerId: string;
  employerId: string;
  employmentStatusId: string;
  hours: number | null;
  employer: Employer;
  employmentStatus: EmploymentStatus;
}

function WorkerHoursContent() {
  const { worker } = useWorkerLayout();
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedYear, setSelectedYear] = useState<string>("");
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [selectedEmployerId, setSelectedEmployerId] = useState<string>("");
  const [selectedEmploymentStatusId, setSelectedEmploymentStatusId] = useState<string>("");
  const [selectedHours, setSelectedHours] = useState<string>("");
  const [editingEntry, setEditingEntry] = useState<WorkerHoursEntry | null>(null);

  // Fetch worker hours
  const { data: hoursEntries = [], isLoading } = useQuery<WorkerHoursEntry[]>({
    queryKey: ["/api/workers", worker.id, "hours"],
  });

  // Fetch all employers
  const { data: employers = [] } = useQuery<Employer[]>({
    queryKey: ["/api/employers"],
  });

  // Fetch employment statuses
  const { data: employmentStatuses = [] } = useQuery<EmploymentStatus[]>({
    queryKey: ["/api/employment-statuses"],
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (data: { month: number; year: number; employerId: string; employmentStatusId: string; hours: number | null }) => {
      const response = await fetch(`/api/workers/${worker.id}/hours`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create hours entry");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers", worker.id, "hours"] });
      toast({ title: "Success", description: "Hours entry created successfully" });
      setIsAddDialogOpen(false);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create hours entry",
        variant: "destructive",
      });
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { employerId: string; employmentStatusId: string; hours: number | null } }) => {
      const response = await fetch(`/api/worker-hours/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to update hours entry");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers", worker.id, "hours"] });
      toast({ title: "Success", description: "Hours entry updated successfully" });
      setIsEditDialogOpen(false);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update hours entry",
        variant: "destructive",
      });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/worker-hours/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to delete hours entry");
      }
      return response.status === 204 ? null : response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers", worker.id, "hours"] });
      toast({ title: "Success", description: "Hours entry deleted successfully" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete hours entry",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setSelectedYear("");
    setSelectedMonth("");
    setSelectedEmployerId("");
    setSelectedEmploymentStatusId("");
    setSelectedHours("");
    setEditingEntry(null);
  };

  const handleCreate = () => {
    if (!selectedYear || !selectedMonth || !selectedEmployerId || !selectedEmploymentStatusId) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    createMutation.mutate({
      year: parseInt(selectedYear),
      month: parseInt(selectedMonth),
      employerId: selectedEmployerId,
      employmentStatusId: selectedEmploymentStatusId,
      hours: selectedHours ? parseFloat(selectedHours) : null,
    });
  };

  const handleEdit = (entry: WorkerHoursEntry) => {
    setEditingEntry(entry);
    setSelectedEmployerId(entry.employerId);
    setSelectedEmploymentStatusId(entry.employmentStatusId);
    setSelectedHours(entry.hours?.toString() || "");
    setIsEditDialogOpen(true);
  };

  const handleUpdate = () => {
    if (!editingEntry || !selectedEmployerId || !selectedEmploymentStatusId) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    updateMutation.mutate({
      id: editingEntry.id,
      data: {
        employerId: selectedEmployerId,
        employmentStatusId: selectedEmploymentStatusId,
        hours: selectedHours ? parseFloat(selectedHours) : null,
      },
    });
  };

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this hours entry?")) {
      deleteMutation.mutate(id);
    }
  };

  // Generate year options (current year + 5 years back)
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, i) => currentYear - i);

  const months = [
    { value: "1", label: "January" },
    { value: "2", label: "February" },
    { value: "3", label: "March" },
    { value: "4", label: "April" },
    { value: "5", label: "May" },
    { value: "6", label: "June" },
    { value: "7", label: "July" },
    { value: "8", label: "August" },
    { value: "9", label: "September" },
    { value: "10", label: "October" },
    { value: "11", label: "November" },
    { value: "12", label: "December" },
  ];

  const getMonthName = (month: number) => {
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return monthNames[month - 1];
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Hours History</CardTitle>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-add-hours" onClick={resetForm}>
                <Plus size={16} className="mr-2" />
                Add Hours Entry
              </Button>
            </DialogTrigger>
            <DialogContent data-testid="dialog-add-hours">
              <DialogHeader>
                <DialogTitle>Add Hours Entry</DialogTitle>
                <DialogDescription>
                  Record hours worked for this worker
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="year">Year *</Label>
                  <Select value={selectedYear} onValueChange={setSelectedYear}>
                    <SelectTrigger id="year" data-testid="select-year">
                      <SelectValue placeholder="Select year" />
                    </SelectTrigger>
                    <SelectContent>
                      {years.map((year) => (
                        <SelectItem key={year} value={year.toString()}>
                          {year}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="month">Month *</Label>
                  <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                    <SelectTrigger id="month" data-testid="select-month">
                      <SelectValue placeholder="Select month" />
                    </SelectTrigger>
                    <SelectContent>
                      {months.map((month) => (
                        <SelectItem key={month.value} value={month.value}>
                          {month.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="employer">Employer *</Label>
                  <Select value={selectedEmployerId} onValueChange={setSelectedEmployerId}>
                    <SelectTrigger id="employer" data-testid="select-employer">
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
                <div>
                  <Label htmlFor="employment-status">Employment Status *</Label>
                  <Select value={selectedEmploymentStatusId} onValueChange={setSelectedEmploymentStatusId}>
                    <SelectTrigger id="employment-status" data-testid="select-employment-status">
                      <SelectValue placeholder="Select employment status" />
                    </SelectTrigger>
                    <SelectContent>
                      {employmentStatuses.map((status) => (
                        <SelectItem key={status.id} value={status.id}>
                          {status.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="hours">Hours</Label>
                  <Input
                    id="hours"
                    type="number"
                    step="0.01"
                    placeholder="Enter hours"
                    value={selectedHours}
                    onChange={(e) => setSelectedHours(e.target.value)}
                    data-testid="input-hours"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setIsAddDialogOpen(false); resetForm(); }}>
                  Cancel
                </Button>
                <Button onClick={handleCreate} disabled={createMutation.isPending} data-testid="button-save-hours">
                  {createMutation.isPending ? "Saving..." : "Save"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading...</div>
        ) : hoursEntries.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No hours entries recorded yet.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Year</TableHead>
                <TableHead>Month</TableHead>
                <TableHead>Employer</TableHead>
                <TableHead>Employment Status</TableHead>
                <TableHead className="text-right">Hours</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {hoursEntries.map((entry) => (
                <TableRow key={entry.id} data-testid={`row-hours-${entry.id}`}>
                  <TableCell>{entry.year}</TableCell>
                  <TableCell>{getMonthName(entry.month)}</TableCell>
                  <TableCell>{entry.employer?.name || "Unknown"}</TableCell>
                  <TableCell>{entry.employmentStatus?.name || "Unknown"}</TableCell>
                  <TableCell className="text-right">{entry.hours?.toFixed(2) || "-"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEdit(entry)}
                        data-testid={`button-edit-hours-${entry.id}`}
                      >
                        <Pencil size={16} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(entry.id)}
                        data-testid={`button-delete-hours-${entry.id}`}
                      >
                        <Trash2 size={16} className="text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent data-testid="dialog-edit-hours">
          <DialogHeader>
            <DialogTitle>Edit Hours Entry</DialogTitle>
            <DialogDescription>
              Update hours for {editingEntry && `${getMonthName(editingEntry.month)} ${editingEntry.year}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="edit-employer">Employer *</Label>
              <Select value={selectedEmployerId} onValueChange={setSelectedEmployerId}>
                <SelectTrigger id="edit-employer" data-testid="select-edit-employer">
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
            <div>
              <Label htmlFor="edit-employment-status">Employment Status *</Label>
              <Select value={selectedEmploymentStatusId} onValueChange={setSelectedEmploymentStatusId}>
                <SelectTrigger id="edit-employment-status" data-testid="select-edit-employment-status">
                  <SelectValue placeholder="Select employment status" />
                </SelectTrigger>
                <SelectContent>
                  {employmentStatuses.map((status) => (
                    <SelectItem key={status.id} value={status.id}>
                      {status.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="edit-hours">Hours</Label>
              <Input
                id="edit-hours"
                type="number"
                step="0.01"
                placeholder="Enter hours"
                value={selectedHours}
                onChange={(e) => setSelectedHours(e.target.value)}
                data-testid="input-edit-hours"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsEditDialogOpen(false); resetForm(); }}>
              Cancel
            </Button>
            <Button onClick={handleUpdate} disabled={updateMutation.isPending} data-testid="button-update-hours">
              {updateMutation.isPending ? "Updating..." : "Update"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default function WorkerHoursPage() {
  return (
    <WorkerLayout activeTab="hours">
      <WorkerHoursContent />
    </WorkerLayout>
  );
}
