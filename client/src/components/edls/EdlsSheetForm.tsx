import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, AlertCircle, Lock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { EdlsSheet, EdlsCrew, InsertEdlsCrew } from "@shared/schema";

interface SupervisorOption {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
}

interface SupervisorContext {
  options: SupervisorOption[];
  assigneeOptions: SupervisorOption[];
  canManage: boolean;
  enforcedSupervisorId: string | null;
  currentUserInList: boolean;
}

type CrewInput = Omit<InsertEdlsCrew, "sheetId"> & { id?: string };

interface DepartmentOption {
  id: string;
  name: string;
}

export interface SheetFormData {
  title: string;
  date: string;
  departmentId: string;
  workerCount: number;
  supervisor: string;
  assignee: string;
  crews: CrewInput[];
}

interface EdlsSheetFormProps {
  initialData?: {
    sheet: EdlsSheet;
    crews: EdlsCrew[];
  };
  onSubmit: (data: SheetFormData) => void;
  onCancel?: () => void;
  isSubmitting?: boolean;
  submitLabel?: string;
}

export function EdlsSheetForm({
  initialData,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel = "Save",
}: EdlsSheetFormProps) {
  const sheetId = initialData?.sheet?.id;
  
  const { data: supervisorContext, isLoading: supervisorContextLoading } = useQuery<SupervisorContext>({
    queryKey: ["/api/edls/supervisor-context", sheetId],
    queryFn: async () => {
      const url = sheetId 
        ? `/api/edls/supervisor-context?sheetId=${sheetId}` 
        : "/api/edls/supervisor-context";
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to fetch supervisor context");
      return response.json();
    },
  });
  
  const { data: departments, isLoading: departmentsLoading } = useQuery<DepartmentOption[]>({
    queryKey: ["/api/options/department"],
  });
  
  const [formData, setFormData] = useState<SheetFormData>(() => {
    if (initialData) {
      return {
        title: initialData.sheet.title,
        date: initialData.sheet.date as string,
        departmentId: initialData.sheet.departmentId,
        workerCount: initialData.sheet.workerCount,
        supervisor: initialData.sheet.supervisor || "",
        assignee: initialData.sheet.assignee || "",
        crews: initialData.crews.map((c) => ({
          id: c.id,
          title: c.title,
          workerCount: c.workerCount,
          location: c.location,
          startTime: c.startTime,
          endTime: c.endTime,
          supervisor: c.supervisor || null,
        })),
      };
    }
    return {
      title: "",
      date: new Date().toISOString().split("T")[0],
      departmentId: "",
      workerCount: 0,
      supervisor: "",
      assignee: "",
      crews: [],
    };
  });

  const effectiveSupervisor = supervisorContext?.enforcedSupervisorId || formData.supervisor;
  const canChangeSupervisor = supervisorContext?.canManage ?? true;

  const crewsTotalWorkerCount = formData.crews.reduce(
    (sum, crew) => sum + (crew.workerCount || 0),
    0
  );

  const workerCountMismatch =
    formData.crews.length > 0 && crewsTotalWorkerCount !== formData.workerCount;

  const hasValidationErrors = () => {
    if (supervisorContextLoading || departmentsLoading) return true;
    if (!formData.title || !formData.date || !formData.departmentId) return true;
    if (!effectiveSupervisor) return true;
    if (formData.crews.length === 0) return true;
    if (workerCountMismatch) return true;
    for (const crew of formData.crews) {
      if (!crew.title || !crew.startTime || !crew.endTime || crew.workerCount <= 0) {
        return true;
      }
    }
    return false;
  };

  const handleAddCrew = () => {
    setFormData({
      ...formData,
      crews: [
        ...formData.crews,
        {
          title: "",
          workerCount: 0,
          location: "",
          startTime: "08:00",
          endTime: "17:00",
          supervisor: effectiveSupervisor || null,
        },
      ],
    });
  };

  const handleRemoveCrew = (index: number) => {
    const newCrews = [...formData.crews];
    newCrews.splice(index, 1);
    setFormData({ ...formData, crews: newCrews });
  };

  const handleCrewChange = (
    index: number,
    field: keyof CrewInput,
    value: string | number | null
  ) => {
    const newCrews = [...formData.crews];
    newCrews[index] = { ...newCrews[index], [field]: value };
    setFormData({ ...formData, crews: newCrews });
  };

  const handleAutoCalculateWorkerCount = () => {
    setFormData({ ...formData, workerCount: crewsTotalWorkerCount });
  };

  const handleSubmit = () => {
    if (hasValidationErrors()) return;
    onSubmit({
      ...formData,
      supervisor: effectiveSupervisor,
    });
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="title">Title *</Label>
          <Input
            id="title"
            data-testid="input-title"
            value={formData.title}
            onChange={(e) =>
              setFormData({ ...formData, title: e.target.value })
            }
            placeholder="e.g., Morning Shift - January 15"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="date">Date *</Label>
          <Input
            id="date"
            type="date"
            data-testid="input-date"
            value={formData.date}
            onChange={(e) =>
              setFormData({ ...formData, date: e.target.value })
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="department">Department *</Label>
          {departmentsLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <Select
              value={formData.departmentId}
              onValueChange={(value) =>
                setFormData({ ...formData, departmentId: value })
              }
            >
              <SelectTrigger data-testid="select-department">
                <SelectValue placeholder="Select a department" />
              </SelectTrigger>
              <SelectContent>
                {departments?.map((dept) => (
                  <SelectItem key={dept.id} value={dept.id}>
                    {dept.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {departments?.length === 0 && (
            <p className="text-sm text-destructive mt-1">
              No departments available. Configure departments first.
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="workerCount">Total Worker Count *</Label>
          <div className="flex gap-2">
            <Input
              id="workerCount"
              type="number"
              data-testid="input-worker-count"
              value={formData.workerCount}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  workerCount: parseInt(e.target.value) || 0,
                })
              }
              min={0}
            />
            {formData.crews.length > 0 && workerCountMismatch && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAutoCalculateWorkerCount}
                data-testid="button-auto-calculate"
              >
                Set to {crewsTotalWorkerCount}
              </Button>
            )}
          </div>
          {workerCountMismatch && (
            <p className="text-sm text-destructive flex items-center gap-1">
              <AlertCircle className="h-4 w-4" />
              Crew totals ({crewsTotalWorkerCount}) must match sheet total (
              {formData.workerCount})
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="supervisor">Supervisor *</Label>
          {supervisorContextLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <div className="relative">
              <Select
                value={effectiveSupervisor}
                onValueChange={(value) =>
                  setFormData({ ...formData, supervisor: value })
                }
                disabled={!canChangeSupervisor}
              >
                <SelectTrigger data-testid="select-supervisor">
                  <SelectValue placeholder="Select a supervisor" />
                </SelectTrigger>
                <SelectContent>
                  {supervisorContext?.options.map((supervisor) => (
                    <SelectItem key={supervisor.id} value={supervisor.id}>
                      {supervisor.firstName || supervisor.lastName
                        ? `${supervisor.firstName || ""} ${supervisor.lastName || ""}`.trim()
                        : supervisor.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!canChangeSupervisor && (
                <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                  <Lock className="h-3 w-3" />
                  You are automatically set as the supervisor
                </div>
              )}
              {supervisorContext?.options.length === 0 && (
                <p className="text-sm text-destructive mt-1">
                  No supervisors available. Configure the supervisor role in EDLS settings.
                </p>
              )}
            </div>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="assignee" className="flex items-center gap-1">
            Assignee
            {!canChangeSupervisor && <Lock className="h-3 w-3 text-muted-foreground" />}
          </Label>
          {supervisorContextLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <Select
              value={formData.assignee || ""}
              onValueChange={(value) =>
                setFormData({ ...formData, assignee: value })
              }
              disabled={!canChangeSupervisor}
            >
              <SelectTrigger data-testid="select-assignee">
                <SelectValue placeholder="Default to supervisor" />
              </SelectTrigger>
              <SelectContent>
                {supervisorContext?.assigneeOptions.map((assignee) => (
                  <SelectItem key={assignee.id} value={assignee.id}>
                    {assignee.firstName || assignee.lastName
                      ? `${assignee.firstName || ""} ${assignee.lastName || ""}`.trim()
                      : assignee.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
          <CardTitle className="text-lg">Crews</CardTitle>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAddCrew}
            data-testid="button-add-crew"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Crew
          </Button>
        </CardHeader>
        <CardContent>
          {formData.crews.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">
              No crews added yet. Add at least one crew to save this sheet.
            </p>
          ) : (
            <div className="space-y-4">
              {formData.crews.map((crew, index) => (
                <Card key={index} className="p-4">
                  <div className="flex items-start gap-4">
                    <div className="flex-1 space-y-3">
                      <div className="flex gap-3">
                        <div className="flex-1 space-y-1">
                          <Label className="text-xs">Title *</Label>
                          <Input
                            data-testid={`input-crew-title-${index}`}
                            value={crew.title || ""}
                            onChange={(e) =>
                              handleCrewChange(index, "title", e.target.value)
                            }
                            placeholder="Crew name"
                          />
                        </div>
                        <div className="w-20 space-y-1">
                          <Label className="text-xs">Workers *</Label>
                          <Input
                            type="number"
                            data-testid={`input-crew-workers-${index}`}
                            value={crew.workerCount || 0}
                            onChange={(e) =>
                              handleCrewChange(
                                index,
                                "workerCount",
                                parseInt(e.target.value) || 0
                              )
                            }
                            min={1}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Start Time *</Label>
                          <Input
                            type="time"
                            data-testid={`input-crew-start-${index}`}
                            value={crew.startTime || ""}
                            onChange={(e) =>
                              handleCrewChange(index, "startTime", e.target.value)
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">End Time *</Label>
                          <Input
                            type="time"
                            data-testid={`input-crew-end-${index}`}
                            value={crew.endTime || ""}
                            onChange={(e) =>
                              handleCrewChange(index, "endTime", e.target.value)
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Location</Label>
                          <Input
                            data-testid={`input-crew-location-${index}`}
                            value={crew.location || ""}
                            onChange={(e) =>
                              handleCrewChange(index, "location", e.target.value || null)
                            }
                            placeholder="Optional"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs flex items-center gap-1">
                            Supervisor
                            {!canChangeSupervisor && <Lock className="h-3 w-3 text-muted-foreground" />}
                          </Label>
                          <Select
                            value={crew.supervisor || effectiveSupervisor || ""}
                            onValueChange={(value) =>
                              handleCrewChange(index, "supervisor", value || null)
                            }
                            disabled={!canChangeSupervisor}
                          >
                            <SelectTrigger data-testid={`select-crew-supervisor-${index}`}>
                              <SelectValue placeholder="Inherit from sheet" />
                            </SelectTrigger>
                            <SelectContent>
                              {supervisorContext?.options.map((supervisor) => (
                                <SelectItem key={supervisor.id} value={supervisor.id}>
                                  {supervisor.firstName || supervisor.lastName
                                    ? `${supervisor.firstName || ""} ${supervisor.lastName || ""}`.trim()
                                    : supervisor.email}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-destructive mt-5"
                      onClick={() => handleRemoveCrew(index)}
                      data-testid={`button-remove-crew-${index}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex gap-2 justify-end">
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
        )}
        <Button
          onClick={handleSubmit}
          disabled={isSubmitting || hasValidationErrors()}
          data-testid="button-submit"
        >
          {isSubmitting ? "Saving..." : submitLabel}
        </Button>
      </div>
    </div>
  );
}
