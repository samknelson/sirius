import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Loader2, Plus, Edit, Trash2, Save, X, ListChecks } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface EdlsTask {
  id: string;
  name: string;
  siriusId: string | null;
  departmentId: string;
  data: Record<string, unknown> | null;
}

interface Department {
  id: string;
  name: string;
}

interface EnrichedEdlsTask extends EdlsTask {
  departmentName: string;
}

interface CsvRow {
  siriusId: string;
  name: string;
  line: number;
}

interface BulkOp {
  kind: "create" | "update" | "delete";
  siriusId: string;
  name: string;
  taskId?: string;
}

interface BulkOpResult extends BulkOp {
  ok: boolean;
  error?: string;
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function parseCsvLine(line: string): string[] | null {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        current += ch;
        i += 1;
      }
    } else if (ch === '"') {
      if (current.trim() !== "") return null;
      current = "";
      inQuotes = true;
      i += 1;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
      i += 1;
    } else {
      current += ch;
      i += 1;
    }
  }
  if (inQuotes) return null;
  fields.push(current);
  return fields;
}

function serializeTasksToCsv(tasks: EdlsTask[]): string {
  return tasks
    .map((t) => `${csvEscape(t.siriusId || "")},${csvEscape(t.name)}`)
    .join("\n");
}

export default function EdlsTasksPage() {
  usePageTitle("EDLS Tasks");
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [formName, setFormName] = useState("");
  const [formSiriusId, setFormSiriusId] = useState("");
  const [formDepartmentId, setFormDepartmentId] = useState("");
  const [filterDepartmentId, setFilterDepartmentId] = useState("all");

  const [isBulkDialogOpen, setIsBulkDialogOpen] = useState(false);
  const [bulkStage, setBulkStage] = useState<"edit" | "confirm" | "result">("edit");
  const [bulkDepartmentId, setBulkDepartmentId] = useState("");
  const [bulkCsv, setBulkCsv] = useState("");
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkPlan, setBulkPlan] = useState<BulkOp[]>([]);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkResults, setBulkResults] = useState<BulkOpResult[]>([]);

  const { data: rawTasks = [], isLoading: tasksLoading } = useQuery<EdlsTask[]>({
    queryKey: ["/api/edls/tasks"],
  });

  const { data: departments = [], isLoading: departmentsLoading } = useQuery<Department[]>({
    queryKey: ["/api/options/department"],
  });

  const isLoading = tasksLoading || departmentsLoading;

  const departmentMap = new Map(departments.map(d => [d.id, d.name]));
  const allTasks: EnrichedEdlsTask[] = rawTasks.map(task => ({
    ...task,
    departmentName: departmentMap.get(task.departmentId) || "Unknown",
  }));
  const tasks = filterDepartmentId === "all"
    ? allTasks
    : allTasks.filter(task => task.departmentId === filterDepartmentId);

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; siriusId: string | null; departmentId: string }) => {
      return apiRequest("POST", "/api/edls/tasks", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/edls/tasks"] });
      setIsAddDialogOpen(false);
      resetForm();
      toast({
        title: "Success",
        description: "Task created successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create task.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { id: string; name: string; siriusId: string | null; departmentId: string }) => {
      return apiRequest("PUT", `/api/edls/tasks/${data.id}`, {
        name: data.name,
        siriusId: data.siriusId,
        departmentId: data.departmentId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/edls/tasks"] });
      setEditingId(null);
      resetForm();
      toast({
        title: "Success",
        description: "Task updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update task.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/edls/tasks/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/edls/tasks"] });
      setDeleteId(null);
      toast({
        title: "Success",
        description: "Task deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete task.",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setFormName("");
    setFormSiriusId("");
    setFormDepartmentId("");
  };

  const handleEdit = (task: EdlsTask) => {
    setEditingId(task.id);
    setFormName(task.name);
    setFormSiriusId(task.siriusId || "");
    setFormDepartmentId(task.departmentId);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    resetForm();
  };

  const handleSaveEdit = () => {
    if (!formName.trim()) {
      toast({
        title: "Validation Error",
        description: "Name is required.",
        variant: "destructive",
      });
      return;
    }
    if (!formDepartmentId) {
      toast({
        title: "Validation Error",
        description: "Department is required.",
        variant: "destructive",
      });
      return;
    }
    if (editingId) {
      updateMutation.mutate({
        id: editingId,
        name: formName.trim(),
        siriusId: formSiriusId.trim() || null,
        departmentId: formDepartmentId,
      });
    }
  };

  const handleCreate = () => {
    if (!formName.trim()) {
      toast({
        title: "Validation Error",
        description: "Name is required.",
        variant: "destructive",
      });
      return;
    }
    if (!formDepartmentId) {
      toast({
        title: "Validation Error",
        description: "Department is required.",
        variant: "destructive",
      });
      return;
    }
    createMutation.mutate({
      name: formName.trim(),
      siriusId: formSiriusId.trim() || null,
      departmentId: formDepartmentId,
    });
  };

  const handleDelete = () => {
    if (deleteId) {
      deleteMutation.mutate(deleteId);
    }
  };

  const departmentTasks = (deptId: string) =>
    allTasks.filter((t) => t.departmentId === deptId);

  const openBulkDialog = () => {
    const initialDept =
      filterDepartmentId !== "all" ? filterDepartmentId : "";
    setBulkDepartmentId(initialDept);
    setBulkCsv(initialDept ? serializeTasksToCsv(departmentTasks(initialDept)) : "");
    setBulkError(null);
    setBulkPlan([]);
    setBulkResults([]);
    setBulkStage("edit");
    setIsBulkDialogOpen(true);
  };

  const handleBulkDepartmentChange = (deptId: string) => {
    setBulkDepartmentId(deptId);
    setBulkCsv(serializeTasksToCsv(departmentTasks(deptId)));
    setBulkError(null);
  };

  const handleBulkReview = () => {
    setBulkError(null);
    if (!bulkDepartmentId) {
      setBulkError("Please select a department first.");
      return;
    }

    const existing = departmentTasks(bulkDepartmentId);

    const blankExisting = existing.filter((t) => !(t.siriusId || "").trim());
    if (blankExisting.length > 0) {
      setBulkError(
        `Bulk edit is blocked for this department: ${blankExisting.length} existing task(s) have a blank Sirius ID (e.g. "${blankExisting[0].name}"). Fix those tasks first so rows can be matched safely.`
      );
      return;
    }
    const seenExisting = new Map<string, string>();
    for (const t of existing) {
      const sid = (t.siriusId || "").trim();
      if (seenExisting.has(sid)) {
        setBulkError(
          `Bulk edit is blocked for this department: Sirius ID "${sid}" is used by multiple existing tasks ("${seenExisting.get(sid)}" and "${t.name}"). Fix those tasks first so rows can be matched safely.`
        );
        return;
      }
      seenExisting.set(sid, t.name);
    }

    const rows: CsvRow[] = [];
    const lines = bulkCsv.split(/\r\n|\r|\n/);
    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      if (line.trim() === "") continue;
      const fields = parseCsvLine(line);
      if (!fields) {
        setBulkError(`Line ${idx + 1}: invalid CSV quoting.`);
        return;
      }
      if (fields.length !== 2) {
        setBulkError(
          `Line ${idx + 1}: expected exactly 2 fields (sirius_id,name), got ${fields.length}. Quote names containing commas, e.g. 123,"Setup, teardown".`
        );
        return;
      }
      const siriusId = fields[0].trim();
      const name = fields[1].trim();
      if (!siriusId) {
        setBulkError(`Line ${idx + 1}: sirius_id is blank.`);
        return;
      }
      if (!name) {
        setBulkError(`Line ${idx + 1}: name is blank.`);
        return;
      }
      rows.push({ siriusId, name, line: idx + 1 });
    }

    const seenCsv = new Map<string, number>();
    for (const row of rows) {
      if (seenCsv.has(row.siriusId)) {
        setBulkError(
          `Duplicate sirius_id "${row.siriusId}" on lines ${seenCsv.get(row.siriusId)} and ${row.line}.`
        );
        return;
      }
      seenCsv.set(row.siriusId, row.line);
    }

    const existingBySid = new Map(
      existing.map((t) => [(t.siriusId || "").trim(), t])
    );
    const csvSids = new Set(rows.map((r) => r.siriusId));

    const plan: BulkOp[] = [];
    for (const row of rows) {
      const match = existingBySid.get(row.siriusId);
      if (!match) {
        plan.push({ kind: "create", siriusId: row.siriusId, name: row.name });
      } else if (match.name !== row.name) {
        plan.push({
          kind: "update",
          siriusId: row.siriusId,
          name: row.name,
          taskId: match.id,
        });
      }
    }
    for (const t of existing) {
      const sid = (t.siriusId || "").trim();
      if (!csvSids.has(sid)) {
        plan.push({ kind: "delete", siriusId: sid, name: t.name, taskId: t.id });
      }
    }

    if (plan.length === 0) {
      setBulkError("No changes detected — the CSV matches the department's current tasks.");
      return;
    }

    setBulkPlan(plan);
    setBulkStage("confirm");
  };

  const handleBulkExecute = async () => {
    setBulkRunning(true);
    const results: BulkOpResult[] = [];
    for (const op of bulkPlan) {
      try {
        if (op.kind === "create") {
          await apiRequest("POST", "/api/edls/tasks", {
            name: op.name,
            siriusId: op.siriusId,
            departmentId: bulkDepartmentId,
          });
        } else if (op.kind === "update") {
          await apiRequest("PUT", `/api/edls/tasks/${op.taskId}`, {
            name: op.name,
          });
        } else {
          await apiRequest("DELETE", `/api/edls/tasks/${op.taskId}`);
        }
        results.push({ ...op, ok: true });
      } catch (error: any) {
        results.push({ ...op, ok: false, error: error?.message || "Request failed" });
      }
    }
    setBulkRunning(false);
    setBulkResults(results);
    setBulkStage("result");
    queryClient.invalidateQueries({ queryKey: ["/api/edls/tasks"] });

    const failed = results.filter((r) => !r.ok);
    if (failed.length === 0) {
      toast({
        title: "Bulk edit complete",
        description: `${results.length} change(s) applied successfully.`,
      });
    } else {
      toast({
        title: "Bulk edit finished with errors",
        description: `${results.length - failed.length} succeeded, ${failed.length} failed.`,
        variant: "destructive",
      });
    }
  };

  const closeBulkDialog = () => {
    if (bulkRunning) return;
    setIsBulkDialogOpen(false);
  };

  const planCounts = {
    add: bulkPlan.filter((p) => p.kind === "create").length,
    update: bulkPlan.filter((p) => p.kind === "update").length,
    delete: bulkPlan.filter((p) => p.kind === "delete").length,
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64" data-testid="loading-spinner">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle>EDLS Tasks</CardTitle>
            <CardDescription>
              Manage task types available for EDLS crew assignments
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={openBulkDialog}
              data-testid="button-bulk-edit"
            >
              <ListChecks className="h-4 w-4 mr-2" />
              Bulk Edit
            </Button>
            <Button
              onClick={() => {
                resetForm();
                setIsAddDialogOpen(true);
              }}
              data-testid="button-add-task"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Task
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 max-w-xs space-y-2">
            <Label htmlFor="filter-department">Filter by department</Label>
            <Select value={filterDepartmentId} onValueChange={setFilterDepartmentId}>
              <SelectTrigger id="filter-department" data-testid="select-filter-department">
                <SelectValue placeholder="All departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" data-testid="select-filter-department-all">
                  All departments
                </SelectItem>
                {departments.map((dept) => (
                  <SelectItem key={dept.id} value={dept.id} data-testid={`select-filter-department-${dept.id}`}>
                    {dept.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {tasks.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground" data-testid="text-no-tasks">
              {allTasks.length === 0
                ? "No tasks configured yet. Add your first task to get started."
                : "No tasks in this department. Choose another department or \"All departments\"."}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Sirius ID</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((task) => (
                  <TableRow key={task.id} data-testid={`row-task-${task.id}`}>
                    {editingId === task.id ? (
                      <>
                        <TableCell>
                          <Input
                            value={formName}
                            onChange={(e) => setFormName(e.target.value)}
                            placeholder="Task name"
                            data-testid="input-edit-name"
                          />
                        </TableCell>
                        <TableCell>
                          <Select value={formDepartmentId} onValueChange={setFormDepartmentId}>
                            <SelectTrigger data-testid="select-edit-department">
                              <SelectValue placeholder="Select department" />
                            </SelectTrigger>
                            <SelectContent>
                              {departments.map((dept) => (
                                <SelectItem key={dept.id} value={dept.id}>
                                  {dept.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            value={formSiriusId}
                            onChange={(e) => setFormSiriusId(e.target.value)}
                            placeholder="External ID (optional)"
                            data-testid="input-edit-sirius-id"
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={handleSaveEdit}
                              disabled={updateMutation.isPending}
                              data-testid="button-save-edit"
                            >
                              {updateMutation.isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Save className="h-4 w-4" />
                              )}
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={handleCancelEdit}
                              data-testid="button-cancel-edit"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell data-testid={`text-name-${task.id}`}>{task.name}</TableCell>
                        <TableCell data-testid={`text-department-${task.id}`}>
                          {task.departmentName || "-"}
                        </TableCell>
                        <TableCell data-testid={`text-sirius-id-${task.id}`}>
                          {task.siriusId || "-"}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleEdit(task)}
                              data-testid={`button-edit-${task.id}`}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => setDeleteId(task.id)}
                              data-testid={`button-delete-${task.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Task</DialogTitle>
            <DialogDescription>
              Create a new task type for EDLS crew assignments.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="add-name">Name *</Label>
              <Input
                id="add-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Enter task name"
                data-testid="input-add-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-department">Department *</Label>
              <Select value={formDepartmentId} onValueChange={setFormDepartmentId}>
                <SelectTrigger id="add-department" data-testid="select-add-department">
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((dept) => (
                    <SelectItem key={dept.id} value={dept.id}>
                      {dept.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-sirius-id">Sirius ID (optional)</Label>
              <Input
                id="add-sirius-id"
                value={formSiriusId}
                onChange={(e) => setFormSiriusId(e.target.value)}
                placeholder="External system ID"
                data-testid="input-add-sirius-id"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsAddDialogOpen(false)}
              data-testid="button-cancel-add"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={createMutation.isPending}
              data-testid="button-confirm-add"
            >
              {createMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Create Task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isBulkDialogOpen} onOpenChange={(open) => !open && closeBulkDialog()}>
        <DialogContent className="max-w-2xl">
          {bulkStage === "edit" && (
            <>
              <DialogHeader>
                <DialogTitle>Bulk Edit Tasks</DialogTitle>
                <DialogDescription>
                  Edit all of a department's tasks at once as CSV lines in the form{" "}
                  <code>sirius_id,name</code> (one task per line). Rows are matched by
                  Sirius ID: new IDs are added, changed names are updated, and IDs
                  removed from the list are deleted. Quote names containing commas,
                  e.g. <code>123,"Setup, teardown"</code>.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2 max-w-xs">
                  <Label htmlFor="bulk-department">Department *</Label>
                  <Select value={bulkDepartmentId} onValueChange={handleBulkDepartmentChange}>
                    <SelectTrigger id="bulk-department" data-testid="select-bulk-department">
                      <SelectValue placeholder="Select department" />
                    </SelectTrigger>
                    <SelectContent>
                      {departments.map((dept) => (
                        <SelectItem key={dept.id} value={dept.id}>
                          {dept.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bulk-csv">Tasks (sirius_id,name)</Label>
                  <Textarea
                    id="bulk-csv"
                    value={bulkCsv}
                    onChange={(e) => setBulkCsv(e.target.value)}
                    placeholder={bulkDepartmentId ? "sirius_id,name" : "Select a department first"}
                    disabled={!bulkDepartmentId}
                    rows={12}
                    className="font-mono text-sm"
                    data-testid="textarea-bulk-csv"
                  />
                </div>
                {bulkError && (
                  <div
                    className="text-sm text-destructive whitespace-pre-wrap"
                    data-testid="text-bulk-error"
                  >
                    {bulkError}
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeBulkDialog} data-testid="button-bulk-cancel">
                  Cancel
                </Button>
                <Button
                  onClick={handleBulkReview}
                  disabled={!bulkDepartmentId}
                  data-testid="button-bulk-review"
                >
                  Review Changes
                </Button>
              </DialogFooter>
            </>
          )}
          {bulkStage === "confirm" && (
            <>
              <DialogHeader>
                <DialogTitle>Confirm Bulk Edit</DialogTitle>
                <DialogDescription data-testid="text-bulk-summary">
                  {planCounts.add} to add, {planCounts.update} to update,{" "}
                  {planCounts.delete} to delete — proceed?
                </DialogDescription>
              </DialogHeader>
              <div className="max-h-64 overflow-y-auto space-y-1 py-2 text-sm">
                {bulkPlan.map((op, i) => (
                  <div key={i} className="flex gap-2" data-testid={`row-bulk-plan-${i}`}>
                    <span
                      className={
                        op.kind === "create"
                          ? "text-green-600 dark:text-green-400 font-medium w-14 shrink-0"
                          : op.kind === "update"
                          ? "text-blue-600 dark:text-blue-400 font-medium w-14 shrink-0"
                          : "text-destructive font-medium w-14 shrink-0"
                      }
                    >
                      {op.kind === "create" ? "Add" : op.kind === "update" ? "Update" : "Delete"}
                    </span>
                    <span className="font-mono">{op.siriusId}</span>
                    <span className="truncate">{op.name}</span>
                  </div>
                ))}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setBulkStage("edit")}
                  disabled={bulkRunning}
                  data-testid="button-bulk-back"
                >
                  Back
                </Button>
                <Button
                  onClick={handleBulkExecute}
                  disabled={bulkRunning}
                  data-testid="button-bulk-confirm"
                >
                  {bulkRunning ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Apply Changes
                </Button>
              </DialogFooter>
            </>
          )}
          {bulkStage === "result" && (
            <>
              <DialogHeader>
                <DialogTitle>Bulk Edit Results</DialogTitle>
                <DialogDescription data-testid="text-bulk-result-summary">
                  {bulkResults.filter((r) => r.ok).length} succeeded,{" "}
                  {bulkResults.filter((r) => !r.ok).length} failed.
                </DialogDescription>
              </DialogHeader>
              <div className="max-h-64 overflow-y-auto space-y-1 py-2 text-sm">
                {bulkResults.map((r, i) => (
                  <div key={i} className="flex gap-2" data-testid={`row-bulk-result-${i}`}>
                    <span
                      className={
                        r.ok
                          ? "text-green-600 dark:text-green-400 font-medium w-14 shrink-0"
                          : "text-destructive font-medium w-14 shrink-0"
                      }
                    >
                      {r.ok ? "OK" : "Failed"}
                    </span>
                    <span className="font-medium w-14 shrink-0">
                      {r.kind === "create" ? "Add" : r.kind === "update" ? "Update" : "Delete"}
                    </span>
                    <span className="font-mono">{r.siriusId}</span>
                    <span className="truncate">
                      {r.name}
                      {r.error ? ` — ${r.error}` : ""}
                    </span>
                  </div>
                ))}
              </div>
              <DialogFooter>
                <Button onClick={closeBulkDialog} data-testid="button-bulk-close">
                  Close
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Task</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this task? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteId(null)}
              data-testid="button-cancel-delete"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
