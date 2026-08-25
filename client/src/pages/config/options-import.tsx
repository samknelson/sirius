import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, Play, Upload } from "lucide-react";
import {
  DEFAULT_OPTIONS_IMPORT_OPTIONS,
  optionsImportHasWrites,
  type OptionsImportOptions,
  type OptionsImportPlanItem,
  type OptionsImportResult,
} from "@shared/optionsTransfer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { OptionsLayout, useOptionsLayout } from "@/components/layouts/OptionsLayout";
import { apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value === "" ? '""' : value;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

const ACTION_STYLES: Record<string, string> = {
  create: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  update: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  delete: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  unchanged: "bg-muted text-muted-foreground",
  skipped: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
};

function PlanRow({ item }: { item: OptionsImportPlanItem }) {
  return (
    <TableRow data-testid={`row-plan-${item.position ?? item.existingId}`}>
      <TableCell className="text-sm text-muted-foreground">{item.position ?? "—"}</TableCell>
      <TableCell className="text-sm font-medium">{item.name}</TableCell>
      <TableCell>
        <Badge className={ACTION_STYLES[item.action] ?? ""} variant="secondary">
          {item.action}
        </Badge>
      </TableCell>
      <TableCell className="text-xs">
        {item.note && <p className="text-muted-foreground mb-1">{item.note}</p>}
        {item.action === "update" || item.action === "create" ? (
          <ul className="space-y-0.5">
            {item.changes.map((change) => (
              <li key={change.field}>
                <span className="font-mono">{change.field}</span>
                {item.action === "update" ? (
                  <>
                    : {formatValue(change.from)} → {formatValue(change.to)}
                  </>
                ) : (
                  <>: {formatValue(change.to)}</>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

function ImportTab() {
  const { optionsType, definition } = useOptionsLayout();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [text, setText] = useState("");
  const [options, setOptions] = useState<OptionsImportOptions>({ ...DEFAULT_OPTIONS_IMPORT_OPTIONS });
  const [preview, setPreview] = useState<OptionsImportResult | null>(null);
  /** The exact input the current preview was built from. */
  const [previewedFor, setPreviewedFor] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const currentInput = JSON.stringify({ text, options });
  const previewIsStale = preview !== null && previewedFor !== currentInput;

  useEffect(() => {
    // Changing the pasted text or the process options invalidates the plan;
    // Apply stays disabled until a fresh preview is run.
    if (previewIsStale) setPreview(null);
  }, [previewIsStale]);

  const previewMutation = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/options/${optionsType}/import/preview`, {
        text,
        options,
      })) as OptionsImportResult,
    onSuccess: (result) => {
      setPreview(result);
      setPreviewedFor(currentInput);
    },
    onError: (error) => {
      toast({
        title: "Preview failed",
        description: getApiErrorMessage(error, "Could not preview this import."),
        variant: "destructive",
      });
    },
  });

  const applyMutation = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/options/${optionsType}/import/apply`, {
        text,
        options,
      })) as OptionsImportResult,
    onSuccess: (result) => {
      setPreview(result);
      setPreviewedFor(currentInput);
      if (result.applied) {
        queryClient.invalidateQueries({ queryKey: ["/api/options", optionsType] });
        toast({
          title: "Import applied",
          description: `${result.summary.create} created, ${result.summary.update} updated, ${result.summary.delete} deleted.`,
        });
      } else {
        toast({
          title: "Nothing was written",
          description: "The import was refused — see the errors below.",
          variant: "destructive",
        });
      }
    },
    onError: (error) => {
      toast({
        title: "Import failed",
        description: getApiErrorMessage(error, "Could not apply this import."),
        variant: "destructive",
      });
    },
  });

  const busy = previewMutation.isPending || applyMutation.isPending;
  const cleanPreview =
    preview !== null && !previewIsStale && preview.errors.length === 0 && preview.dryRun;
  const hasWrites = preview ? optionsImportHasWrites(preview.items) : false;
  const deleteCount = preview?.summary.delete ?? 0;

  const runApply = () => {
    setConfirmOpen(false);
    applyMutation.mutate();
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle data-testid="text-import-title">Import {definition.pluralName}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`Paste the JSON exported from the Export tab here…`}
            className="font-mono text-xs min-h-[16rem]"
            data-testid="input-import-json"
          />

          <div className="flex flex-wrap gap-6">
            <div className="flex items-center gap-2">
              <Checkbox
                id="import-create"
                checked={options.create}
                onCheckedChange={(checked) =>
                  setOptions((prev) => ({ ...prev, create: checked === true }))
                }
                data-testid="checkbox-import-create"
              />
              <Label htmlFor="import-create">Create new records</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="import-update"
                checked={options.update}
                onCheckedChange={(checked) =>
                  setOptions((prev) => ({ ...prev, update: checked === true }))
                }
                data-testid="checkbox-import-update"
              />
              <Label htmlFor="import-update">Update matched records</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="import-delete"
                checked={options.delete}
                onCheckedChange={(checked) =>
                  setOptions((prev) => ({ ...prev, delete: checked === true }))
                }
                data-testid="checkbox-import-delete"
              />
              <Label htmlFor="import-delete">Delete records missing from the file</Label>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => previewMutation.mutate()}
              disabled={busy || text.trim() === ""}
              data-testid="button-preview-import"
            >
              {previewMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-2 h-4 w-4" />
              )}
              Preview
            </Button>
            <Button
              variant="default"
              onClick={() => (deleteCount > 0 ? setConfirmOpen(true) : runApply())}
              disabled={busy || !cleanPreview || !hasWrites}
              data-testid="button-apply-import"
            >
              {applyMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              Apply
            </Button>
            {preview && !previewIsStale && !hasWrites && preview.errors.length === 0 && (
              <span className="text-sm text-muted-foreground" data-testid="text-nothing-to-do">
                Nothing to apply — every record is unchanged.
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {preview && !previewIsStale && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {preview.errors.length > 0 ? (
                <AlertTriangle className="h-5 w-5 text-destructive" />
              ) : (
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              )}
              {preview.applied ? "Import applied" : "Preview"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground" data-testid="text-preview-summary">
              {preview.summary.create} to create · {preview.summary.update} to update ·{" "}
              {preview.summary.unchanged} unchanged · {preview.summary.delete} to delete ·{" "}
              {preview.summary.skipped} skipped
            </p>

            {preview.errors.length > 0 && (
              <div
                className="rounded-md border border-destructive/50 bg-destructive/10 p-3"
                data-testid="list-preview-errors"
              >
                <p className="text-sm font-medium text-destructive mb-2">
                  Nothing will be written until these are fixed:
                </p>
                <ul className="space-y-1 text-sm text-destructive">
                  {preview.errors.map((error, i) => (
                    <li key={i} data-testid={`text-preview-error-${i}`}>
                      {error.position !== null ? `Record ${error.position}` : "File"}
                      {error.name ? ` (${error.name})` : ""}: {error.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">#</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="w-28">Action</TableHead>
                    <TableHead>Changes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.items.map((item, i) => (
                    <PlanRow key={`${item.position ?? "db"}-${item.existingId ?? i}`} item={item} />
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteCount} record{deleteCount === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This import removes {deleteCount} {deleteCount === 1 ? definition.singularName : definition.pluralName}{" "}
              that {deleteCount === 1 ? "is" : "are"} not in the pasted file. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runApply} data-testid="button-confirm-delete">
              Apply import
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function OptionsImportPage() {
  return (
    <OptionsLayout activeTab="import">
      <ImportTab />
    </OptionsLayout>
  );
}
