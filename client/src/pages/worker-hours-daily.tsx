import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Employer } from "@shared/schema";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Pencil, Eye } from "lucide-react";
import { LedgerTransactionsView } from "@/components/ledger/LedgerTransactionsView";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
import { Badge } from "@/components/ui/badge";

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
  home: boolean;
  employer: Employer;
  employmentStatus: EmploymentStatus;
}

function WorkerHoursContent() {
  const { worker } = useWorkerLayout();
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [viewingEntry, setViewingEntry] = useState<WorkerHoursEntry | null>(null);
  const [selectedYear, setSelectedYear] = useState<string>("");
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [selectedDay, setSelectedDay] = useState<string>("");
  const [selectedEmployerId, setSelectedEmployerId] = useState<string>("");
  const [selectedEmploymentStatusId, setSelectedEmploymentStatusId] = useState<string>("");
  const [selectedHours, setSelectedHours] = useState<string>("");
  const [selectedHome, setSelectedHome] = useState<boolean>(false);
  const [editingEntry, setEditingEntry] = useState<WorkerHoursEntry | null>(null);

  // Fetch worker hours
  const { data: hoursEntries = [], isLoading } = useQuery<WorkerHoursEntry[]>({
    queryKey: ["/api/workers", worker.id, "hours", "daily"],
    queryFn: async () => {
      const response = await fetch(`/api/workers/${worker.id}/hours?view=daily`);
      if (!response.ok) throw new Error("Failed to fetch worker hours");
      return response.json();
    },
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
    mutationFn: async (data: { month: number; year: number; day: number; employerId: string; employmentStatusId: string; hours: number | null; home: boolean }) => {
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
    mutationFn: async ({ id, data }: { id: string; data: { year: number; month: number; day: number; employerId: string; employmentStatusId: string; hours: number | null; home: boolean } }) => {
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
    setSelectedDay("");
    setSelectedEmployerId("");
    setSelectedEmploymentStatusId("");
    setSelectedHours("");
    setSelectedHome(false);
    setEditingEntry(null);
  };

  const handleCreate = () => {
    if (!selectedYear || !selectedMonth || !selectedDay || !selectedEmployerId || !selectedEmploymentStatusId) {
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
      day: parseInt(selectedDay),
      employerId: selectedEmployerId,
      employmentStatusId: selectedEmploymentStatusId,
      hours: selectedHours ? parseFloat(selectedHours) : null,
      home: selectedHome,
    });
  };

  const handleView = (entry: WorkerHoursEntry) => {
    setViewingEntry(entry);
    setIsViewDialogOpen(true);
  };

  const handleEdit = (entry: WorkerHoursEntry) => {
    setEditingEntry(entry);
    setSelectedYear(entry.year.toString());
    setSelectedMonth(entry.month.toString());
    setSelectedDay(entry.day.toString());
    setSelectedEmployerId(entry.employerId);
    setSelectedEmploymentStatusId(entry.employmentStatusId);
    setSelectedHours(entry.hours?.toString() || "");
    setSelectedHome(entry.home);
    setIsEditDialogOpen(true);
  };

  const handleUpdate = () => {
    if (!editingEntry || !selectedYear || !selectedMonth || !selectedDay || !selectedEmployerId || !selectedEmploymentStatusId) {
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
        year: parseInt(selectedYear),
        month: parseInt(selectedMonth),
        day: parseInt(selectedDay),
        employerId: selectedEmployerId,
        employmentStatusId: selectedEmploymentStatusId,
        hours: selectedHours ? parseFloat(selectedHours) : null,
        home: selectedHome,
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

  // Get valid days for selected month/year
  const getDaysInMonth = () => {
    if (!selectedYear || !selectedMonth) return [];
    const year = parseInt(selectedYear);
    const month = parseInt(selectedMonth);
    const daysInMonth = new Date(year, month, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, i) => i + 1);
  };

  const validDays = getDaysInMonth();

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
                  <Label htmlFor="day">Day *</Label>
                  <Select value={selectedDay} onValueChange={setSelectedDay} disabled={!selectedYear || !selectedMonth}>
                    <SelectTrigger id="day" data-testid="select-day">
                      <SelectValue placeholder={validDays.length > 0 ? "Select day" : "Select year and month first"} />
                    </SelectTrigger>
                    <SelectContent>
                      {validDays.map((day) => (
                        <SelectItem key={day} value={day.toString()}>
                          {day}
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
                <div className="flex items-center justify-between">
                  <Label htmlFor="home">Home</Label>
                  <Switch
                    id="home"
                    checked={selectedHome}
                    onCheckedChange={setSelectedHome}
                    data-testid="switch-home"
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
                <TableHead>Day</TableHead>
                <TableHead>Employer</TableHead>
                <TableHead>Employment Status</TableHead>
                <TableHead>Home</TableHead>
                <TableHead className="text-right">Hours</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {hoursEntries.map((entry) => (
                <TableRow key={entry.id} data-testid={`row-hours-${entry.id}`}>
                  <TableCell>{entry.year}</TableCell>
                  <TableCell>{getMonthName(entry.month)}</TableCell>
                  <TableCell>{entry.day}</TableCell>
                  <TableCell>{entry.employer?.name || "Unknown"}</TableCell>
                  <TableCell>{entry.employmentStatus?.name || "Unknown"}</TableCell>
                  <TableCell>
                    {entry.home && (
                      <Badge variant="default" data-testid={`badge-home-${entry.id}`}>
                        Home
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">{entry.hours?.toFixed(2) || "-"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleView(entry)}
                        data-testid={`button-view-hours-${entry.id}`}
                      >
                        <Eye size={16} />
                      </Button>
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
              Update hours entry details
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="edit-year">Year *</Label>
              <Select value={selectedYear} onValueChange={setSelectedYear}>
                <SelectTrigger id="edit-year" data-testid="select-edit-year">
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
              <Label htmlFor="edit-month">Month *</Label>
              <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                <SelectTrigger id="edit-month" data-testid="select-edit-month">
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
              <Label htmlFor="edit-day">Day *</Label>
              <Select value={selectedDay} onValueChange={setSelectedDay} disabled={!selectedYear || !selectedMonth}>
                <SelectTrigger id="edit-day" data-testid="select-edit-day">
                  <SelectValue placeholder={validDays.length > 0 ? "Select day" : "Select year and month first"} />
                </SelectTrigger>
                <SelectContent>
                  {validDays.map((day) => (
                    <SelectItem key={day} value={day.toString()}>
                      {day}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
            <div className="flex items-center justify-between">
              <Label htmlFor="edit-home">Home</Label>
              <Switch
                id="edit-home"
                checked={selectedHome}
                onCheckedChange={setSelectedHome}
                data-testid="switch-edit-home"
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

      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto" data-testid="dialog-view-hours">
          <DialogHeader>
            <DialogTitle>Hours Entry Details</DialogTitle>
            <DialogDescription>
              View details and associated transactions for this hours entry
            </DialogDescription>
          </DialogHeader>
          {viewingEntry && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-muted-foreground text-sm">Date</Label>
                  <p className="font-medium" data-testid="text-view-date">
                    {getMonthName(viewingEntry.month)} {viewingEntry.day}, {viewingEntry.year}
                  </p>
                </div>
                <div className="space-y-1">
                  <Label className="text-muted-foreground text-sm">Employer</Label>
                  <p className="font-medium" data-testid="text-view-employer">
                    {viewingEntry.employer?.name || "Unknown"}
                  </p>
                </div>
                <div className="space-y-1">
                  <Label className="text-muted-foreground text-sm">Employment Status</Label>
                  <p className="font-medium" data-testid="text-view-status">
                    {viewingEntry.employmentStatus?.name || "Unknown"}
                    {viewingEntry.employmentStatus?.code && (
                      <span className="text-muted-foreground ml-2">({viewingEntry.employmentStatus.code})</span>
                    )}
                  </p>
                </div>
                <div className="space-y-1">
                  <Label className="text-muted-foreground text-sm">Hours</Label>
                  <p className="font-medium" data-testid="text-view-hours">
                    {viewingEntry.hours !== null ? viewingEntry.hours.toFixed(2) : "-"}
                  </p>
                </div>
                <div className="space-y-1">
                  <Label className="text-muted-foreground text-sm">Home</Label>
                  <p data-testid="text-view-home">
                    {viewingEntry.home ? (
                      <Badge variant="default">Yes</Badge>
                    ) : (
                      <span className="text-muted-foreground">No</span>
                    )}
                  </p>
                </div>
              </div>

              <div className="border-t pt-4">
                <LedgerTransactionsView
                  queryKey={[`/api/worker-hours/${viewingEntry.id}/transactions`]}
                  title="Associated Transactions"
                  csvFilename={`hours-${viewingEntry.id}-transactions`}
                  showEntityType={false}
                  showEntityName={false}
                  showEaAccount={true}
                  showEaLink={true}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsViewDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default function WorkerHoursDaily() {
  return (
    <WorkerLayout activeTab="daily">
      <WorkerHoursContent />
    </WorkerLayout>
  );
}
