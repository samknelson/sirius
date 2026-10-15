import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, Check, Eye, FileText, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { SimpleHtmlEditor } from "@/components/ui/simple-html-editor";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { apiRequest, getApiErrorMessage, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type Channel = "email" | "postal";
type Defaults = { letterheadHtml: string; footerHtml?: string; showPageCount?: boolean };
type Preview = { html?: string; text?: string; pdfUrl?: string };

const uploadLetterheadImage = async (file: File): Promise<string> => {
  if (!["image/png", "image/jpeg"].includes(file.type)) throw new Error("Choose a PNG or JPEG image.");
  if (file.size > 1024 * 1024) throw new Error("Images must be 1 MB or smaller.");
  const body = new FormData();
  body.append("file", file);
  const response = await fetch("/api/template-assets", { method: "POST", body, credentials: "same-origin" });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.message || `Image upload failed (${response.status}).`);
  if (typeof result?.url !== "string" || !/^https:\/\//i.test(result.url)) {
    throw new Error("Image upload did not return a reusable HTTPS URL.");
  }
  return result.url;
};

export function MessageDefaultsSettings({ channel }: { channel: Channel }) {
  const { toast } = useToast();
  const basePath = `/api/config/${channel}/message-defaults`;
  const queryKey = [basePath];
  const [draft, setDraft] = useState<Defaults>({ letterheadHtml: "", footerHtml: "", showPageCount: false });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [previewing, setPreviewing] = useState(false);
  useEffect(() => () => { if (preview?.pdfUrl) URL.revokeObjectURL(preview.pdfUrl); }, [preview?.pdfUrl]);
  const initialized = useRef(false);
  const isPostal = channel === "postal";
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<Defaults>({
    queryKey,
    queryFn: async () => await apiRequest("GET", basePath) as Defaults,
  });

  useEffect(() => {
    if (data && !initialized.current) {
      initialized.current = true;
      setDraft({
        letterheadHtml: data.letterheadHtml || "",
        footerHtml: data.footerHtml || "",
        showPageCount: Boolean(data.showPageCount),
      });
    }
  }, [data]);

  const saved: Defaults = useMemo(() => ({
    letterheadHtml: data?.letterheadHtml || "",
    footerHtml: data?.footerHtml || "",
    showPageCount: Boolean(data?.showPageCount),
  }), [data]);
  const dirty = draft.letterheadHtml !== saved.letterheadHtml
    || (isPostal && (draft.footerHtml !== saved.footerHtml || draft.showPageCount !== saved.showPageCount));

  const saveMutation = useMutation({
    mutationFn: async (values: Defaults) => await apiRequest("PUT", basePath, isPostal
      ? values
      : { letterheadHtml: values.letterheadHtml }) as Defaults,
    onSuccess: (result) => {
      const normalized = {
        letterheadHtml: result?.letterheadHtml ?? draft.letterheadHtml,
        footerHtml: result?.footerHtml ?? draft.footerHtml,
        showPageCount: result?.showPageCount ?? draft.showPageCount,
      };
      queryClient.setQueryData(queryKey, normalized);
      setDraft(normalized);
      toast({ title: "Message defaults saved", description: "These defaults will be used for messages sent after this change." });
    },
    onError: (saveError) => toast({
      title: "Could not save message defaults",
      description: getApiErrorMessage(saveError, "Try saving again."),
      variant: "destructive",
    }),
  });

  const previewDefaults = async () => {
    setPreviewing(true);
    setPreviewError("");
    setPreview(null);
    try {
      const response = await fetch(`${basePath}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(isPostal
          ? { letterheadHtml: draft.letterheadHtml, footerHtml: draft.footerHtml, showPageCount: draft.showPageCount }
          : { letterheadHtml: draft.letterheadHtml }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message || body?.error || `Preview failed (${response.status}).`);
      }
      if (isPostal) {
        const blob = await response.blob();
        if (!blob.type.includes("application/pdf")) throw new Error("The preview did not return a PDF.");
        setPreview({ pdfUrl: URL.createObjectURL(blob) });
      } else {
        const result = await response.json() as { html?: string; text?: string };
        setPreview({ html: result.html || "", text: result.text || "" });
      }
    } catch (previewFailure) {
      setPreviewError(getApiErrorMessage(previewFailure, "Unable to build preview."));
    } finally {
      setPreviewing(false);
    }
  };

  const closePreview = () => {
    setPreview(null);
    setPreviewError("");
  };

  if (isLoading) {
    return <Card><CardHeader><Skeleton className="h-6 w-56" /><Skeleton className="h-4 w-96 max-w-full" /></CardHeader><CardContent><Skeleton className="h-36 w-full" /></CardContent></Card>;
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                {isPostal ? "Postal letterhead & footer" : "Email letterhead"}
              </CardTitle>
              <CardDescription className="mt-1 max-w-3xl">
                {isPostal
                  ? "Set the shared letterhead and footer for postal messages. A postal header is not supported."
                  : "Set a shared letterhead that appears above the individual email message content."}
              </CardDescription>
            </div>
            {data && <Badge variant={dirty ? "secondary" : "outline"}>{dirty ? "Unsaved changes" : "Saved"}</Badge>}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {isError ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Could not load message defaults</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>{getApiErrorMessage(error, "Check your connection and retry.")}</span>
                <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
                  {isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="rounded-md border bg-muted/40 p-3 text-sm leading-relaxed text-muted-foreground">
                These defaults are independent of the selected {channel} provider. Changes affect subsequent individual, bulk, automated, and offline messages, including queued work when it is delivered. Blank content removes that branding. Template tokens are not supported here. External Lob templates and remotely hosted documents are unchanged.
              </div>
              <section className="space-y-2" aria-labelledby={`${channel}-letterhead-label`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <Label id={`${channel}-letterhead-label`}>{isPostal ? "Postal Letterhead" : "Email Letterhead"}</Label>
                    <p className="text-xs text-muted-foreground">{isPostal ? "Printed once at the beginning of the first page, below the mailing-address reserve." : "Shown above the email message body."}</p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setDraft((current) => ({ ...current, letterheadHtml: "" }))} disabled={saveMutation.isPending || !draft.letterheadHtml}>
                    <Trash2 className="mr-2 h-4 w-4" />Clear {isPostal ? "Postal" : "Email"} Letterhead
                  </Button>
                </div>
                <SimpleHtmlEditor
                  value={draft.letterheadHtml}
                  onChange={(letterheadHtml) => setDraft((current) => ({ ...current, letterheadHtml }))}
                  placeholder="Add a logo, organization name, or other shared branding…"
                  templateMode={channel}
                  uploadImage={uploadLetterheadImage}
                  disabled={saveMutation.isPending}
                  minHeight={140}
                  data-testid={`${channel}-letterhead-editor`}
                />
              </section>

              {isPostal && (
                <>
                  <section className="space-y-2" aria-labelledby="postal-footer-label">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <Label id="postal-footer-label">Postal Footer</Label>
                        <p className="text-xs text-muted-foreground">Repeated on every page, including continuation pages. Keep within 6.5 inches wide and 0.75 inches high.</p>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => setDraft((current) => ({ ...current, footerHtml: "" }))} disabled={saveMutation.isPending || !draft.footerHtml}>
                        <Trash2 className="mr-2 h-4 w-4" />Clear Postal Footer
                      </Button>
                    </div>
                    <SimpleHtmlEditor
                      value={draft.footerHtml || ""}
                      onChange={(footerHtml) => setDraft((current) => ({ ...current, footerHtml }))}
                      placeholder="Add a closing note or contact details…"
                      templateMode="postal"
                      uploadImage={uploadLetterheadImage}
                      disabled={saveMutation.isPending}
                      minHeight={140}
                      data-testid="postal-footer-editor"
                    />
                  </section>
                  <div className="flex items-start justify-between gap-4 rounded-md border p-4">
                    <div className="space-y-1">
                      <Label htmlFor="postal-page-count">Show page count</Label>
                      <p className="text-sm text-muted-foreground">Show “Page X of Y” below the footer on every page.</p>
                    </div>
                    <Switch
                      id="postal-page-count"
                      checked={Boolean(draft.showPageCount)}
                      disabled={saveMutation.isPending}
                      onCheckedChange={(showPageCount) => setDraft((current) => ({ ...current, showPageCount }))}
                    />
                  </div>
                </>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <p className="text-xs text-muted-foreground">Edits are saved only when you select Save defaults. Preview uses your current draft.</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={previewDefaults} disabled={saveMutation.isPending || previewing}>
                    {previewing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}
                    Preview unsaved changes
                  </Button>
                  <Button onClick={() => saveMutation.mutate(draft)} disabled={!dirty || saveMutation.isPending}>
                    {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                    {saveMutation.isPending ? "Saving…" : "Save defaults"}
                  </Button>
                </div>
              </div>
              {saveMutation.isError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Save failed</AlertTitle>
                  <AlertDescription>Nothing was changed. Review the error and try Save defaults again.</AlertDescription>
                </Alert>
              )}
              {previewError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Preview unavailable</AlertTitle>
                  <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                    <span>{previewError}</span>
                    <Button variant="outline" size="sm" onClick={previewDefaults} disabled={previewing}>Retry preview</Button>
                  </AlertDescription>
                </Alert>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!preview} onOpenChange={(open) => { if (!open) closePreview(); }}>
        <DialogContent className="flex max-h-[92dvh] w-[min(96vw,980px)] max-w-none flex-col">
          <DialogHeader>
            <DialogTitle>{isPostal ? "Postal PDF preview" : "Email preview"}</DialogTitle>
            <DialogDescription>This preview was generated from the current draft. It was not saved or sent.</DialogDescription>
          </DialogHeader>
          {preview?.pdfUrl ? (
            <iframe title="Postal message PDF preview" src={preview.pdfUrl} className="min-h-[60dvh] w-full flex-1 rounded-md border" />
          ) : preview?.html !== undefined ? (
            <div className="grid min-h-0 flex-1 gap-4 overflow-hidden md:grid-cols-2">
              <iframe title="Rendered email preview" srcDoc={preview.html} sandbox="" className="min-h-[52dvh] w-full rounded-md border bg-white" />
              <div className="min-h-[52dvh] overflow-auto rounded-md border bg-muted/30 p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Plain text</p>
                <pre className="whitespace-pre-wrap break-words font-sans text-sm">{preview.text}</pre>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
