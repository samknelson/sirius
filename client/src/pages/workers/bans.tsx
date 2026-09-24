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
import { queryClient, apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import { useMemo, useState } from "react";
import { Ban, Plus, Trash2, Pencil } from "lucide-react";
import type { WorkerBan } from "@shared/schema";
import { addDays, parseISO, isValid } from "date-fns";
import { format, formatLocalFields } from "@/lib/date-format";

interface BanTypeOption {
  id: string;
  name: string;
  description: string | null;
  data: { pluginIds?: string[]; defaultDurationDays?: number } | null;
}

/**
 * End date implied by a ban type's default duration: start date + N days,
 * or "" when the type has no default duration (indefinite).
 */
function defaultEndDateFor(
  type: BanTypeOption | undefined,
  startDate: string,
): string {
  const days = type?.data?.defaultDurationDays;
  if (!days || !Number.isInteger(days) || days < 1 || !startDate) return "";
  const start = parseISO(startDate);
  if (!isValid(start)) return "";
  return formatLocalFields(addDays(start, days), "yyyy-MM-dd");
}

interface BanPluginManifestEntry {
  id: string;
  name: string;
  description?: string;
  componentEnabled: boolean;
  actionNames: string[];
  argumentSchema?: {
    properties?: Record<string, { title?: string; ["x-options-resource"]?: string }>;
    required?: string[];
  };
  unconditional: boolean;
}

interface ArgumentField {
  name: string;
  title: string;
  optionsResource?: string;
  required: boolean;
  pluginName: string;
}

/** Union of argument fields declared by the given plugins (deduped by name). */
function argumentFieldsFor(plugins: BanPluginManifestEntry[]): ArgumentField[] {
  const fields = new Map<string, ArgumentField>();
  for (const plugin of plugins) {
    const props = plugin.argumentSchema?.properties ?? {};
    const required = plugin.argumentSchema?.required ?? [];
    for (const [name, prop] of Object.entries(props)) {
      if (!fields.has(name)) {
        fields.set(name, {
          name,
          title: prop.title ?? name,
          optionsResource: prop["x-options-resource"],
          required: required.includes(name),
          pluginName: plugin.name,
        });
      }
    }
  }
  return Array.from(fields.values());
}

function ArgumentFieldInput({
  field,
  value,
  onChange,
}: {
  field: ArgumentField;
  value: string;
  onChange: (value: string) => void;
}) {
  const { data: options = [], isLoading } = useQuery<{ id: string; name: string }[]>({
    queryKey: [`/api/options/${field.optionsResource}`],
    enabled: !!field.optionsResource,
  });

  if (field.optionsResource) {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger data-testid={`select-ban-arg-${field.name}`}>
          <SelectValue placeholder={isLoading ? "Loading..." : `Select ${field.title.toLowerCase()}`} />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.id} value={opt.id} data-testid={`select-ban-arg-${field.name}-${opt.id}`}>
              {opt.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      data-testid={`input-ban-arg-${field.name}`}
    />
  );
}

function BansContent() {
  const { worker } = useWorkerLayout();
  const { toast } = useToast();
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('staff');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingBan, setEditingBan] = useState<WorkerBan | null>(null);
  const [formType, setFormType] = useState<string>("");
  const [formStartDate, setFormStartDate] = useState<string>("");
  const [formEndDate, setFormEndDate] = useState<string>("");
  // Once the user manually edits the end date, type/start-date changes
  // must never overwrite it with the type's default duration.
  const [endDateTouched, setEndDateTouched] = useState(false);
  const [formMessage, setFormMessage] = useState<string>("");
  const [formData, setFormData] = useState<Record<string, string>>({});

  const { data: bans = [], isLoading } = useQuery<WorkerBan[]>({
    queryKey: ["/api/worker-bans/worker", worker.id],
  });

  const { data: banTypes = [] } = useQuery<BanTypeOption[]>({
    queryKey: ["/api/options/worker-ban-type"],
  });

  const { data: banPlugins = [] } = useQuery<BanPluginManifestEntry[]>({
    queryKey: ["/api/plugins/worker-ban/manifest"],
  });

  const typeById = useMemo(
    () => new Map(banTypes.map((t) => [t.id, t])),
    [banTypes],
  );
  const pluginById = useMemo(
    () => new Map(banPlugins.map((p) => [p.id, p])),
    [banPlugins],
  );

  const pluginsForType = (typeId: string): BanPluginManifestEntry[] => {
    const pluginIds = typeById.get(typeId)?.data?.pluginIds ?? [];
    return pluginIds
      .map((id) => pluginById.get(id))
      .filter((p): p is BanPluginManifestEntry => !!p);
  };

  const selectedTypePlugins = formType ? pluginsForType(formType) : [];
  const argumentFields = argumentFieldsFor(selectedTypePlugins);

  const banTypeName = (ban: WorkerBan): string | null => {
    if (!ban.type) return null;
    // Legacy literal from before configurable ban types (should be
    // rewritten at boot, but render it sensibly regardless).
    if (ban.type === "dispatch") return "Dispatch";
    return typeById.get(ban.type)?.name ?? ban.type;
  };

  const banCoverage = (ban: WorkerBan): string | null => {
    if (!ban.type || ban.type === "dispatch") return null;
    const actions = new Set<string>();
    for (const plugin of pluginsForType(ban.type)) {
      for (const action of plugin.actionNames) actions.add(action);
    }
    return actions.size > 0 ? Array.from(actions).join(", ") : null;
  };

  const createMutation = useMutation({
    mutationFn: async (data: { workerId: string; type: string; startDate: string; endDate?: string | null; message?: string | null; data?: Record<string, string> | null }) => {
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
        description: getApiErrorMessage(error, "Failed to add ban."),
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<{ type: string; startDate: string; endDate: string | null; message: string | null; data: Record<string, string> | null }> }) => {
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
        description: getApiErrorMessage(error, "Failed to update ban."),
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
    onError: (error) => {
      toast({
        title: "Error",
        description: getApiErrorMessage(error, "Failed to remove ban."),
        variant: "destructive",
      });
    },
  });

  const openAddModal = () => {
    setEditingBan(null);
    const initialType = banTypes[0]?.id ?? "";
    const initialStart = formatLocalFields(new Date(), "yyyy-MM-dd");
    setFormType(initialType);
    setFormStartDate(initialStart);
    setFormEndDate(defaultEndDateFor(typeById.get(initialType), initialStart));
    setEndDateTouched(false);
    setFormMessage("");
    setFormData({});
    setIsModalOpen(true);
  };

  const openEditModal = (ban: WorkerBan) => {
    setEditingBan(ban);
    setFormType(ban.type && typeById.has(ban.type) ? ban.type : "");
    setFormStartDate(ban.startDate ? formatLocalFields(new Date(ban.startDate), "yyyy-MM-dd") : "");
    setFormEndDate(ban.endDate ? formatLocalFields(new Date(ban.endDate), "yyyy-MM-dd") : "");
    setEndDateTouched(true); // never auto-change an existing ban's end date
    setFormMessage(ban.message || "");
    const existingData: Record<string, string> = {};
    if (ban.data && typeof ban.data === "object") {
      for (const [key, value] of Object.entries(ban.data as Record<string, unknown>)) {
        if (typeof value === "string") existingData[key] = value;
      }
    }
    setFormData(existingData);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingBan(null);
    setFormType("");
    setFormStartDate("");
    setFormEndDate("");
    setEndDateTouched(false);
    setFormMessage("");
    setFormData({});
  };

  const handleTypeChange = (typeId: string) => {
    setFormType(typeId);
    if (!editingBan && !endDateTouched) {
      setFormEndDate(defaultEndDateFor(typeById.get(typeId), formStartDate));
    }
    // Drop argument values that the new type's plugins don't declare.
    const keep = new Set(argumentFieldsFor(pluginsForType(typeId)).map((f) => f.name));
    setFormData((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([k]) => keep.has(k))),
    );
  };

  const handleStartDateChange = (value: string) => {
    setFormStartDate(value);
    if (!editingBan && !endDateTouched) {
      setFormEndDate(defaultEndDateFor(typeById.get(formType), value));
    }
  };

  const handleSave = () => {
    if (!formType) {
      toast({
        title: "Validation Error",
        description: "Ban type is required.",
        variant: "destructive",
      });
      return;
    }
    if (!formStartDate) {
      toast({
        title: "Validation Error",
        description: "Start date is required.",
        variant: "destructive",
      });
      return;
    }
    for (const field of argumentFields) {
      if (field.required && !formData[field.name]) {
        toast({
          title: "Validation Error",
          description: `${field.title} is required for this ban type.`,
          variant: "destructive",
        });
        return;
      }
    }

    const payloadData = Object.fromEntries(
      Object.entries(formData).filter(([, v]) => v !== ""),
    );

    if (editingBan) {
      updateMutation.mutate({
        id: editingBan.id,
        data: {
          type: formType,
          startDate: formStartDate,
          endDate: formEndDate || null,
          message: formMessage || null,
          data: Object.keys(payloadData).length > 0 ? payloadData : null,
        },
      });
    } else {
      createMutation.mutate({
        workerId: worker.id,
        type: formType,
        startDate: formStartDate,
        endDate: formEndDate || null,
        message: formMessage || null,
        data: Object.keys(payloadData).length > 0 ? payloadData : null,
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
            Manage bans that restrict what this worker can do.
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
                  <TableHead>Prohibits</TableHead>
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
                      {banTypeName(ban) ?? <span className="text-muted-foreground">-</span>}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground">
                      {banCoverage(ban) ?? "-"}
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
              <Select value={formType} onValueChange={handleTypeChange}>
                <SelectTrigger data-testid="select-ban-type">
                  <SelectValue placeholder="Select ban type" />
                </SelectTrigger>
                <SelectContent>
                  {banTypes.map((type) => (
                    <SelectItem key={type.id} value={type.id} data-testid={`select-ban-type-${type.id}`}>
                      {type.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedTypePlugins.length > 0 && (
                <p className="text-xs text-muted-foreground" data-testid="text-ban-type-coverage">
                  Prohibits: {Array.from(new Set(selectedTypePlugins.flatMap((p) => p.actionNames))).join(", ")}
                </p>
              )}
            </div>
            {argumentFields.map((field) => (
              <div key={field.name} className="space-y-2">
                <Label htmlFor={`ban-arg-${field.name}`}>
                  {field.title}
                  {field.required ? "" : " (optional)"}
                </Label>
                <ArgumentFieldInput
                  field={field}
                  value={formData[field.name] ?? ""}
                  onChange={(value) => setFormData((prev) => ({ ...prev, [field.name]: value }))}
                />
              </div>
            ))}
            <div className="space-y-2">
              <Label htmlFor="startDate">Start Date</Label>
              <Input
                id="startDate"
                type="date"
                value={formStartDate}
                onChange={(e) => handleStartDateChange(e.target.value)}
                data-testid="input-ban-start-date"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endDate">End Date (optional)</Label>
              <Input
                id="endDate"
                type="date"
                value={formEndDate}
                onChange={(e) => {
                  setEndDateTouched(true);
                  setFormEndDate(e.target.value);
                }}
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
