import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CrewLeadsExport, CrewLeadsImportMode, CrewLeadsImportResult } from "@shared/freemanCrewleadsTransfer";
import { optionsImportHasWrites } from "@shared/optionsTransfer";
import { apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Copy, Download, Loader2, Upload } from "lucide-react";

const BASE = "/api/sitespecific/freeman/crewleads";

function CrewLeadsExportContent() {
  const { toast } = useToast();
  const { data, isLoading, isError } = useQuery<CrewLeadsExport>({
    queryKey: [`${BASE}/export`],
    staleTime: 0,
    gcTime: 0,
  });
  const json = data ? JSON.stringify(data, null, 2) : "";
  // Do not offer stale cached data when the fresh request failed.
  const ready = !isLoading && !isError && !!data;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      toast({ title: "Copied JSON" });
    } catch {
      toast({ title: "Copy failed", description: "Select the JSON below and copy it manually.", variant: "destructive" });
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `freeman-crew-leads-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={!ready} onClick={copy} data-testid="button-copy-crewleads">
          <Copy className="mr-2 h-4 w-4" />Copy
        </Button>
        <Button variant="outline" disabled={!ready} onClick={download} data-testid="button-download-crewleads">
          <Download className="mr-2 h-4 w-4" />Download
        </Button>
      </div>
      {isLoading ? <p role="status">Loading export…</p> : isError ?
        <p role="alert" className="text-destructive">Could not load the export. Close and reopen to retry.</p> : (
          <>
            <p className="text-sm text-muted-foreground">{data?.records.length ?? 0} crew leads. Includes the complete list, regardless of the page filter.</p>
            <pre className="max-h-96 overflow-auto rounded-md border bg-muted p-4 text-xs" data-testid="text-crewleads-export">{json}</pre>
          </>
        )}
    </div>
  );
}

function CrewLeadsImportContent({ onApplied }: { onApplied: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [mode, setMode] = useState<CrewLeadsImportMode>("merge");
  const [preview, setPreview] = useState<CrewLeadsImportResult | null>(null);
  const [previewInput, setPreviewInput] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const input = JSON.stringify({ text, mode });
  const current = previewInput === input;
  const result = current ? preview : null;
  const errorToast = (error: unknown) => toast({
    title: "Import request failed",
    description: getApiErrorMessage(error, "Could not process the import."),
    variant: "destructive",
  });
  const previewMutation = useMutation({
    mutationFn: async (request: { text: string; mode: CrewLeadsImportMode }) =>
      await apiRequest("POST", `${BASE}/import/preview`, request) as CrewLeadsImportResult,
    onMutate: () => { setPreview(null); setConfirmOpen(false); },
    onSuccess: (response, request) => {
      setPreview(response);
      setPreviewInput(JSON.stringify(request));
    },
    onError: errorToast,
  });
  const applyMutation = useMutation({
    mutationFn: async (confirmed: boolean) => await apiRequest("POST", `${BASE}/import/apply`, {
      text, mode, token: result?.token, confirmDeletion: confirmed,
    }) as CrewLeadsImportResult,
    onSuccess: (response) => {
      setPreview(response);
      if (response.applied) {
        queryClient.invalidateQueries({ queryKey: [BASE] });
        queryClient.invalidateQueries({ queryKey: [`${BASE}/export`] });
        onApplied();
        const { create, update, unchanged, delete: deleted } = response.summary;
        toast({ title: "Import applied", description: `${create} created, ${update} updated, ${unchanged} unchanged, ${deleted} deleted.` });
      } else {
        toast({ title: "Nothing was written", description: "Review the errors and preview again.", variant: "destructive" });
      }
    },
    onError: (error) => { setPreview(null); errorToast(error); },
  });
  const busy = previewMutation.isPending || applyMutation.isPending;
  const canApply = !!result && !result.applied && !result.stale &&
    !result.errors.length && optionsImportHasWrites(result.items);
  const deletions = result?.summary.delete ?? 0;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Paste exported JSON, a JSON array, or one <strong>Name | Sirius ID</strong> pair per line.
        Tabs also work. Values are trimmed; blank lines are ignored. IDs match by Sirius ID, never name or internal record ID.
      </p>
      <Label htmlFor="crewleads-import-text">JSON or name / Sirius ID lines</Label>
      <Textarea id="crewleads-import-text" value={text} disabled={busy}
        onChange={(event) => { setText(event.target.value); setPreview(null); setConfirmOpen(false); }}
        placeholder={'Alex Smith | 00124\nJamie Jones\t00987'}
        className="min-h-40 font-mono text-xs" data-testid="input-crewleads-import" />
      <div className="space-y-2">
        <Label htmlFor="crewleads-import-mode">Import mode</Label>
        <select id="crewleads-import-mode" value={mode} disabled={busy}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          data-testid="select-crewleads-import-mode"
          onChange={(event) => { setMode(event.target.value as CrewLeadsImportMode); setPreview(null); setConfirmOpen(false); }}>
          <option value="merge">Create/update — keep other existing records</option>
          <option value="replace">Replace all — delete records absent from this import</option>
        </select>
      </div>
      {mode === "replace" && <p className="text-sm text-destructive">
        Replace all permanently deletes absent crew leads. Existing crew sheets may lose their crew-lead reference/display.
        An explicit empty JSON array [] clears the list after confirmation; blank text does not.
      </p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || !text.trim()} onClick={() => previewMutation.mutate({ text, mode })}
          data-testid="button-preview-crewleads">
          {previewMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Preview
        </Button>
        <Button disabled={busy || !canApply}
          onClick={() => deletions ? setConfirmOpen(true) : applyMutation.mutate(false)}
          data-testid="button-apply-crewleads">
          {applyMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}Apply
        </Button>
      </div>
      {result && <div className="space-y-3" aria-live="polite">
        <h3 className="font-semibold">{result.applied ? "Import applied" : "Preview"}</h3>
        <p className="text-sm" data-testid="text-crewleads-import-summary">
          {result.summary.create} create · {result.summary.update} update · {result.summary.unchanged} unchanged · {result.summary.delete} delete
        </p>
        {!!result.errors.length && <div role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
          <p>Nothing will be written until these errors are fixed:</p>
          <ul>{result.errors.map((error, index) => <li key={index}>
            {error.position === null ? "File" : `Row ${error.position}`}: {error.message}
          </li>)}</ul>
        </div>}
        {!result.errors.length && !optionsImportHasWrites(result.items) && <p className="text-sm text-muted-foreground">Nothing to apply — every record is unchanged.</p>}
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader><TableRow><TableHead>Row</TableHead><TableHead>Sirius ID</TableHead><TableHead>Name</TableHead><TableHead>Action</TableHead><TableHead>Changes</TableHead></TableRow></TableHeader>
            <TableBody>{result.items.map((item, index) => <TableRow key={index}>
              <TableCell>{item.position ?? "—"}</TableCell>
              <TableCell>{item.siriusId}</TableCell><TableCell>{item.name}</TableCell>
              <TableCell className={item.action === "delete" ? "text-destructive" : ""}>{item.action}</TableCell>
              <TableCell>{item.changes.map((change) => <div key={change.field} className="text-xs">
                {change.field}: {change.from == null ? "—" : String(change.from)} → {String(change.to)}
              </div>)}</TableCell>
            </TableRow>)}</TableBody>
          </Table>
        </div>
      </div>}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{result?.clearAll ? "Delete ALL crew leads?" : `Delete ${deletions} crew lead${deletions === 1 ? "" : "s"}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              This import permanently deletes {deletions} crew lead{deletions === 1 ? "" : "s"} absent from the input.
              Existing crew sheets may lose their crew-lead reference/display. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy || !canApply} data-testid="button-confirm-crewleads-import"
              onClick={() => { setConfirmOpen(false); applyMutation.mutate(true); }}>Apply import</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function CrewLeadsTransfer({ kind, onClose, onApplied }: {
  kind: "import" | "export"; onClose: () => void; onApplied: () => void;
}) {
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{kind === "import" ? "Import" : "Export"} Freeman crew leads</DialogTitle>
        <DialogDescription>{kind === "import"
          ? "Preview changes before applying them. Existing matched records keep their internal IDs and application data."
          : "Copy or download portable JSON with names and Sirius IDs."}</DialogDescription>
      </DialogHeader>
      {kind === "import" ? <CrewLeadsImportContent onApplied={onApplied} /> : <CrewLeadsExportContent />}
    </DialogContent>
  </Dialog>;
}
