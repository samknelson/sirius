import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronUp, ChevronDown, X, Plus, Check } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface LineOption {
  id: string;
  name: string;
  description?: string | null;
}

export interface GrievanceLine {
  id: string;
  optionId: string | null;
  description: string;
  sequence: number;
  optionName: string | null;
}

interface GrievanceLineSectionProps {
  grievanceId: string;
  /** Singular noun used in labels, e.g. "Complaint" / "Remedy". */
  noun: string;
  /** URL path segment for the nested API, e.g. "complaints" / "remedies". */
  resource: "complaints" | "remedies";
  /** Options endpoint key, e.g. "grievance-complaint" / "grievance-remedy". */
  optionsType: "grievance-complaint" | "grievance-remedy";
  /** test-id prefix, e.g. "complaint" / "remedy". */
  testIdPrefix: string;
  lines: GrievanceLine[];
}

// SelectItem cannot use an empty-string value, so the "custom text" choice
// gets a sentinel that maps back to a null option id.
const CUSTOM_OPTION = "__custom__";

/**
 * Live edit manager for an ordered list of grievance complaint/remedy lines.
 *
 * Each line is either anchored to an admin-defined option (whose description,
 * falling back to its name, seeds the editable text) or free text. Adding,
 * editing, removing, and reordering issue immediate API calls against the
 * persisted grievance; reordering moves a line by PATCHing its target
 * sequence, which the storage layer swaps atomically with the neighbour.
 */
export function GrievanceLineSection({
  grievanceId,
  noun,
  resource,
  optionsType,
  testIdPrefix,
  lines,
}: GrievanceLineSectionProps) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  // Add form state.
  const [adding, setAdding] = useState(false);
  const [newOptionId, setNewOptionId] = useState<string>(CUSTOM_OPTION);
  const [newDescription, setNewDescription] = useState("");

  // Inline edit state.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editOptionId, setEditOptionId] = useState<string>(CUSTOM_OPTION);
  const [editDescription, setEditDescription] = useState("");

  const { data: options = [] } = useQuery<LineOption[]>({
    queryKey: [`/api/options/${optionsType}`],
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["/api/grievances", grievanceId] });
    await queryClient.invalidateQueries({ queryKey: ["/api/grievances"] });
  };

  // Selecting an option seeds the editable description from its description,
  // falling back to its name when the description is empty.
  const optionSeedText = (optionId: string): string => {
    const option = options.find((o) => o.id === optionId);
    if (!option) return "";
    const desc = option.description?.trim();
    return desc && desc.length > 0 ? desc : option.name;
  };

  const handleNewOptionChange = (value: string) => {
    setNewOptionId(value);
    if (value !== CUSTOM_OPTION) {
      setNewDescription(optionSeedText(value));
    }
  };

  const handleEditOptionChange = (value: string) => {
    setEditOptionId(value);
    if (value !== CUSTOM_OPTION) {
      setEditDescription(optionSeedText(value));
    }
  };

  // Manually editing the description detaches the line from its option, so the
  // saved row no longer claims to come from an option it no longer matches.
  const handleNewDescriptionChange = (value: string) => {
    setNewDescription(value);
    if (newOptionId !== CUSTOM_OPTION) {
      setNewOptionId(CUSTOM_OPTION);
    }
  };

  const handleEditDescriptionChange = (value: string) => {
    setEditDescription(value);
    if (editOptionId !== CUSTOM_OPTION) {
      setEditOptionId(CUSTOM_OPTION);
    }
  };

  const resetAdd = () => {
    setAdding(false);
    setNewOptionId(CUSTOM_OPTION);
    setNewDescription("");
  };

  const onAdd = async () => {
    if (!newDescription.trim()) {
      toast({
        title: "A description is required",
        variant: "destructive",
      });
      return;
    }
    setBusy(true);
    try {
      await apiRequest("POST", `/api/grievances/${grievanceId}/${resource}`, {
        optionId: newOptionId === CUSTOM_OPTION ? null : newOptionId,
        description: newDescription.trim(),
      });
      await refresh();
      resetAdd();
      toast({ title: `${noun} added` });
    } catch (error: any) {
      toast({
        title: `Failed to add ${noun.toLowerCase()}`,
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (line: GrievanceLine) => {
    setEditingId(line.id);
    setEditOptionId(line.optionId ?? CUSTOM_OPTION);
    setEditDescription(line.description);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditOptionId(CUSTOM_OPTION);
    setEditDescription("");
  };

  const onSaveEdit = async (lineId: string) => {
    if (!editDescription.trim()) {
      toast({
        title: "A description is required",
        variant: "destructive",
      });
      return;
    }
    setBusy(true);
    try {
      await apiRequest("PATCH", `/api/grievances/${grievanceId}/${resource}/${lineId}`, {
        optionId: editOptionId === CUSTOM_OPTION ? null : editOptionId,
        description: editDescription.trim(),
      });
      await refresh();
      cancelEdit();
      toast({ title: `${noun} updated` });
    } catch (error: any) {
      toast({
        title: `Failed to update ${noun.toLowerCase()}`,
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (lineId: string) => {
    setBusy(true);
    try {
      await apiRequest("DELETE", `/api/grievances/${grievanceId}/${resource}/${lineId}`);
      await refresh();
      toast({ title: `${noun} removed` });
    } catch (error: any) {
      toast({
        title: `Failed to remove ${noun.toLowerCase()}`,
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  // Reorder by PATCHing the moved line to the neighbour's sequence; the
  // storage layer swaps the two rows so they never share a sequence.
  const onMove = async (index: number, direction: -1 | 1) => {
    const target = lines[index + direction];
    const current = lines[index];
    if (!target || !current) return;
    setBusy(true);
    try {
      await apiRequest("PATCH", `/api/grievances/${grievanceId}/${resource}/${current.id}`, {
        sequence: target.sequence,
      });
      await refresh();
    } catch (error: any) {
      toast({
        title: `Failed to reorder ${noun.toLowerCase()}`,
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{noun === "Complaint" ? "Complaints" : `${noun}s`}</CardTitle>
        {!adding && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => setAdding(true)}
            data-testid={`button-add-${testIdPrefix}`}
          >
            <Plus size={14} className="mr-1" />
            Add {noun}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {lines.length === 0 && !adding ? (
          <p
            className="text-muted-foreground text-sm"
            data-testid={`text-no-${testIdPrefix}`}
          >
            No {noun.toLowerCase()}s added.
          </p>
        ) : (
          <div className="space-y-2">
            {lines.map((line, index) => (
              <div
                key={line.id}
                className="border rounded-lg px-3 py-2"
                data-testid={`row-${testIdPrefix}-${line.id}`}
              >
                {editingId === line.id ? (
                  <div className="space-y-3">
                    <Select value={editOptionId} onValueChange={handleEditOptionChange} disabled={busy}>
                      <SelectTrigger data-testid={`select-${testIdPrefix}-option-${line.id}`}>
                        <SelectValue placeholder={`Select a ${noun.toLowerCase()} option`} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={CUSTOM_OPTION} data-testid={`option-${testIdPrefix}-custom`}>
                          Custom text
                        </SelectItem>
                        {options.map((o) => (
                          <SelectItem key={o.id} value={o.id} data-testid={`option-${testIdPrefix}-${o.id}`}>
                            {o.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Textarea
                      rows={3}
                      value={editDescription}
                      onChange={(e) => handleEditDescriptionChange(e.target.value)}
                      placeholder={`Describe the ${noun.toLowerCase()}`}
                      data-testid={`input-${testIdPrefix}-description-${line.id}`}
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy}
                        onClick={() => onSaveEdit(line.id)}
                        data-testid={`button-save-${testIdPrefix}-${line.id}`}
                      >
                        <Check size={14} className="mr-1" />
                        Save
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={cancelEdit}
                        data-testid={`button-cancel-${testIdPrefix}-${line.id}`}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      {line.optionName && (
                        <p
                          className="text-sm font-medium text-foreground"
                          data-testid={`text-${testIdPrefix}-option-${line.id}`}
                        >
                          {line.optionName}
                        </p>
                      )}
                      <p
                        className="text-foreground whitespace-pre-wrap break-words"
                        data-testid={`text-${testIdPrefix}-description-${line.id}`}
                      >
                        {line.description}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={busy || index === 0}
                        onClick={() => onMove(index, -1)}
                        data-testid={`button-move-up-${testIdPrefix}-${line.id}`}
                      >
                        <ChevronUp size={14} />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={busy || index === lines.length - 1}
                        onClick={() => onMove(index, 1)}
                        data-testid={`button-move-down-${testIdPrefix}-${line.id}`}
                      >
                        <ChevronDown size={14} />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => startEdit(line)}
                        data-testid={`button-edit-${testIdPrefix}-${line.id}`}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={busy}
                        onClick={() => onRemove(line.id)}
                        data-testid={`button-remove-${testIdPrefix}-${line.id}`}
                      >
                        <X size={14} />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {adding && (
          <div className="border rounded-lg px-3 py-3 space-y-3" data-testid={`form-add-${testIdPrefix}`}>
            <Select value={newOptionId} onValueChange={handleNewOptionChange} disabled={busy}>
              <SelectTrigger data-testid={`select-new-${testIdPrefix}-option`}>
                <SelectValue placeholder={`Select a ${noun.toLowerCase()} option`} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CUSTOM_OPTION} data-testid={`option-new-${testIdPrefix}-custom`}>
                  Custom text
                </SelectItem>
                {options.map((o) => (
                  <SelectItem key={o.id} value={o.id} data-testid={`option-new-${testIdPrefix}-${o.id}`}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea
              rows={3}
              value={newDescription}
              onChange={(e) => handleNewDescriptionChange(e.target.value)}
              placeholder={`Describe the ${noun.toLowerCase()}`}
              data-testid={`input-new-${testIdPrefix}-description`}
            />
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={onAdd}
                data-testid={`button-save-new-${testIdPrefix}`}
              >
                <Check size={14} className="mr-1" />
                Add
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={resetAdd}
                data-testid={`button-cancel-new-${testIdPrefix}`}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
