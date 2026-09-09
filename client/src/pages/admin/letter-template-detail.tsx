import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileJson, Loader2, Maximize2, RefreshCw, Save, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { ApiError, apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import { useCatalogQuery } from "@/hooks/useCatalogQuery";
import { TokenStudio, type StudioField } from "@/components/template-studio/TokenStudio";
import { MEDIUM_FIELDS, MEDIUM_NAMES, type MediumName } from "@shared/delivery-fields";
import { readTokenContext } from "@shared/token-contexts";
import type { LetterTemplate } from "./letter-templates";

const mediumLabel: Record<MediumName, string> = { email: "Email", sms: "SMS", postal: "Postal", inapp: "In-app" };
const fieldLabel = (key: string) => key === "bodyHtml" ? "Body" : key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());
const fieldsFor = (medium: MediumName): StudioField[] => MEDIUM_FIELDS[medium].map((f) => ({ key: f.key, label: fieldLabel(f.key), mode: f.syntax === "html" ? "html" : ["subject", "title", "linkUrl", "linkLabel"].includes(f.key) ? "line" : "multiline" }));

export default function LetterTemplateDetailPage() {
  usePageTitle("Letter Template");
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: "", siriusId: "", medium: "email" as MediumName, contextIds: [] as string[], content: {} as Record<string, string>, dataText: "{}" });
  const [initialized, setInitialized] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [studioOpen, setStudioOpen] = useState(false);
  const [contextPickerOpen, setContextPickerOpen] = useState(false);
  const [studioContext, setStudioContext] = useState("");
  const [jsonError, setJsonError] = useState("");

  const template = useQuery<LetterTemplate>({ queryKey: [`/api/admin/letter-templates/${id}`], enabled: Boolean(id) });
  const contexts = useCatalogQuery<{ catalog: { entries: Array<{ id: string; name: string; detail?: unknown }> } }>("/api/catalogs/token-contexts");
  const contextOptions = useMemo(() => (contexts.data?.catalog.entries ?? []).map((e) => readTokenContext(e as never)).filter(Boolean), [contexts.data]);
  useEffect(() => {
    if (template.data && !initialized) {
      setForm({ name: template.data.name, siriusId: template.data.siriusId ?? "", medium: template.data.medium, contextIds: template.data.contextIds, content: template.data.content ?? {}, dataText: JSON.stringify(template.data.data ?? {}, null, 2) });
      setInitialized(true); setDirty(false);
    }
  }, [template.data, initialized]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = useMutation({
    mutationFn: () => {
      let data: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(form.dataText);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
        data = parsed as Record<string, unknown>;
      } catch { throw new Error("Data must be a valid JSON object."); }
      return apiRequest("PATCH", `/api/admin/letter-templates/${id}`, { name: form.name.trim(), siriusId: form.siriusId.trim() || null, medium: form.medium, contextIds: form.contextIds, content: form.content, data });
    },
    onSuccess: (next: LetterTemplate) => { queryClient.setQueryData([`/api/admin/letter-templates/${id}`], next); queryClient.invalidateQueries({ queryKey: ["/api/admin/letter-templates"] }); setDirty(false); setJsonError(""); },
  });
  const errorMessage = save.error ? getApiErrorMessage(save.error, "Could not save this template.") : template.error ? getApiErrorMessage(template.error, "Could not load this template.") : null;
  const setField = <K extends keyof typeof form>(key: K, value: typeof form[K]) => { setForm((current) => ({ ...current, [key]: value })); setDirty(true); };
  const openStudio = () => {
    if (form.contextIds.length === 1) { setStudioContext(form.contextIds[0]); setStudioOpen(true); }
    else setContextPickerOpen(true);
  };
  if (template.isLoading) return <div className="space-y-4"><div className="h-8 w-64 animate-pulse rounded bg-muted" /><div className="h-72 animate-pulse rounded bg-muted" /></div>;
  if (template.isError || !template.data) {
    const notFound = template.error instanceof ApiError && template.error.status === 404;
    return <div className="space-y-4"><Link href="/admin/letter-templates" className="inline-flex items-center text-sm text-muted-foreground"><ArrowLeft className="mr-2 h-4 w-4" />Back to templates</Link><Card><CardContent className="py-14 text-center"><TriangleAlert className="mx-auto h-8 w-8 text-destructive" /><p className="mt-3 font-medium">{notFound ? "Template not found" : "Couldn’t load this template"}</p><p className="mt-1 text-sm text-muted-foreground">{errorMessage ?? (notFound ? "This template may have been removed." : "The server did not answer successfully.")}</p><Button variant="outline" className="mt-4" onClick={() => void template.refetch()}>Retry</Button></CardContent></Card></div>;
  }

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-5"><div><Link href="/admin/letter-templates" className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="mr-1.5 h-3.5 w-3.5" />Letter templates</Link><h1 className="mt-2 text-2xl font-semibold tracking-tight">{form.name || "Untitled template"}</h1><p className="mt-1 font-mono text-xs text-muted-foreground">{id}</p></div><div className="flex items-center gap-2">{dirty && <span className="text-xs text-amber-700">Unsaved changes</span>}<Button onClick={() => save.mutate()} disabled={!form.name.trim() || !form.contextIds.length || save.isPending || !dirty}>{save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save changes</Button></div></div>
    {errorMessage && <Alert variant="destructive"><AlertDescription>{errorMessage}</AlertDescription></Alert>}
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
      <div className="space-y-6">
        <Card><CardHeader><CardTitle className="text-base">Template identity</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2"><Label htmlFor="detail-name">Name</Label><Input id="detail-name" value={form.name} onChange={(e) => setField("name", e.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="sirius-id">Sirius ID <span className="font-normal text-muted-foreground">(optional)</span></Label><Input id="sirius-id" value={form.siriusId} onChange={(e) => setField("siriusId", e.target.value)} /></div>
          <div className="space-y-2"><Label>Medium</Label><Select value={form.medium} onValueChange={(v) => {
            const medium = v as MediumName;
            const allowed = new Set(MEDIUM_FIELDS[medium].map((field) => field.key));
            const discarded = Object.entries(form.content).filter(
              ([key, value]) => !allowed.has(key) && value.trim() !== "",
            );
            if (
              discarded.length > 0 &&
              !window.confirm(
                `Changing to ${mediumLabel[medium]} will remove ${discarded.length} authored field${discarded.length === 1 ? "" : "s"} that this medium does not support. Continue?`,
              )
            ) return;
            setForm((current) => ({
              ...current,
              medium,
              content: Object.fromEntries(Object.entries(current.content).filter(([key]) => allowed.has(key))),
            }));
            setDirty(true);
          }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{MEDIUM_NAMES.map((m) => <SelectItem key={m} value={m}>{mediumLabel[m]}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2 sm:col-span-2"><Label>Token contexts</Label>{contexts.isError && <Alert variant="destructive"><AlertDescription className="flex items-center justify-between gap-3"><span>Available token contexts could not be loaded. Existing selections are unchanged.</span><Button type="button" variant="outline" size="sm" onClick={() => void contexts.refetch()}><RefreshCw className="mr-2 h-3.5 w-3.5" />Retry</Button></AlertDescription></Alert>}<div className="flex flex-wrap gap-1.5 rounded-md border p-2">{form.contextIds.map((context) => <button type="button" key={context} onClick={() => setField("contextIds", form.contextIds.filter((id) => id !== context))} className="rounded border bg-muted/40 px-2 py-1 font-mono text-[11px]">{context} ×</button>)}<Select disabled={contexts.isError || contexts.isLoading} onValueChange={(value) => { if (!form.contextIds.includes(value)) setField("contextIds", [...form.contextIds, value]); }}><SelectTrigger className="h-7 w-44 border-dashed text-xs"><SelectValue placeholder={contexts.isLoading ? "Loading contexts…" : "Add context"} /></SelectTrigger><SelectContent>{contextOptions.map((c) => c && !form.contextIds.includes(c.id) && <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></div></div>
        </CardContent></Card>
        <Card><CardHeader className="flex flex-row items-center justify-between gap-3"><div><CardTitle className="text-base">Delivery content</CardTitle><p className="mt-1 text-sm text-muted-foreground">Edit tokenized fields together so preview and delivery stay aligned.</p></div><Button variant="outline" size="sm" onClick={openStudio}><Maximize2 className="mr-2 h-4 w-4" />Open TokenStudio</Button></CardHeader><CardContent><div className="divide-y rounded-md border">{fieldsFor(form.medium).map((field) => <div key={field.key} className="flex items-start gap-4 px-3 py-3"><span className="w-28 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{field.label}</span><span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm">{form.content[field.key] || <em className="text-muted-foreground">Not set</em>}</span></div>)}</div></CardContent></Card>
      </div>
      <Card className="h-fit"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><FileJson className="h-4 w-4" />Data payload</CardTitle><p className="text-sm text-muted-foreground">Optional JSON object passed with this template.</p></CardHeader><CardContent><Textarea className="min-h-64 font-mono text-xs" value={form.dataText} onChange={(e) => { setField("dataText", e.target.value); try { const parsed: unknown = JSON.parse(e.target.value); setJsonError(parsed && typeof parsed === "object" && !Array.isArray(parsed) ? "" : "Data must be a JSON object."); } catch { setJsonError("JSON is not valid yet."); } }} />{jsonError && <p className="mt-2 text-xs text-destructive">{jsonError}</p>}</CardContent></Card>
    </div>
    <Dialog open={contextPickerOpen} onOpenChange={setContextPickerOpen}><DialogContent><DialogHeader><DialogTitle>Choose a token context</DialogTitle><DialogDescription>This template has multiple contexts. Select which context TokenStudio should use for this editing session.</DialogDescription></DialogHeader><Select onValueChange={(value) => { setStudioContext(value); setContextPickerOpen(false); setStudioOpen(true); }}><SelectTrigger><SelectValue placeholder="Select context" /></SelectTrigger><SelectContent>{form.contextIds.map((context) => <SelectItem key={context} value={context}>{contextOptions.find((c) => c?.id === context)?.name ?? context}</SelectItem>)}</SelectContent></Select></DialogContent></Dialog>
    <TokenStudio open={studioOpen} onOpenChange={setStudioOpen} title={`${form.name || "Letter template"} · ${mediumLabel[form.medium]}`} description="Changes are kept in this form until you save the template." channel={form.medium} contextId={studioContext} fields={fieldsFor(form.medium)} fieldSpecs={MEDIUM_FIELDS[form.medium]} values={form.content} onValueChange={(key, value) => setField("content", { ...form.content, [key]: value })} />
  </div>;
}