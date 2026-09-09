import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus, Search, ArrowRight, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import { useCatalogQuery } from "@/hooks/useCatalogQuery";
import { readTokenContext } from "@shared/token-contexts";
import { MEDIUM_NAMES, type MediumName } from "@shared/delivery-fields";

export interface LetterTemplate {
  id: string;
  name: string;
  medium: MediumName;
  contextIds: string[];
  content: Record<string, string>;
  siriusId: string | null;
  data: Record<string, unknown>;
}

const mediumLabel: Record<MediumName, string> = { email: "Email", sms: "SMS", postal: "Postal", inapp: "In-app" };

export default function LetterTemplatesPage() {
  usePageTitle("Letter Templates");
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [medium, setMedium] = useState<MediumName>("email");
  const [contextIds, setContextIds] = useState<string[]>([]);
  const [contextInput, setContextInput] = useState("");

  const templates = useQuery<LetterTemplate[]>({ queryKey: ["/api/admin/letter-templates"] });
  const contexts = useCatalogQuery<{ catalog: { entries: Array<{ id: string; name: string; description?: string; detail?: unknown }> } }>("/api/catalogs/token-contexts");
  const contextOptions = useMemo(
    () => (contexts.data?.catalog.entries ?? []).map((entry) => readTokenContext(entry as never)).filter(Boolean),
    [contexts.data],
  );
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (templates.data ?? []).filter((item) => !term || item.name.toLowerCase().includes(term) || item.id.toLowerCase().includes(term));
  }, [templates.data, search]);

  const create = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/letter-templates", { name: name.trim(), medium, contextIds }),
    onSuccess: (created: LetterTemplate) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/letter-templates"] });
      setLocation(`/admin/letter-templates/${created.id}`);
    },
  });

  const addContext = (value: string) => {
    if (value && !contextIds.includes(value)) setContextIds((ids) => [...ids, value]);
    setContextInput("");
  };
  const createError = create.error ? getApiErrorMessage(create.error, "Could not create this template.") : null;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Configuration / Communications</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Letter templates</h1>
          <p className="mt-1 text-sm text-muted-foreground">Reusable wording with explicit delivery fields and token contexts.</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><FileText className="h-4 w-4" /> {templates.data?.length ?? 0} templates</div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 border-b py-4">
            <CardTitle className="text-base">Saved templates</CardTitle>
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="h-9 pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or ID" aria-label="Search templates" />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {templates.isLoading ? <div className="space-y-3 p-5"><div className="h-10 animate-pulse rounded bg-muted" /><div className="h-10 animate-pulse rounded bg-muted" /></div> :
              templates.isError ? <div className="p-8 text-center"><p className="text-sm text-destructive">Couldn’t load letter templates.</p><Button variant="outline" size="sm" className="mt-3" onClick={() => void templates.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Retry</Button></div> :
              visible.length === 0 ? <div className="p-10 text-center"><FileText className="mx-auto h-8 w-8 text-muted-foreground/50" /><p className="mt-3 text-sm font-medium">{search ? "No matching templates" : "No letter templates yet"}</p><p className="mt-1 text-xs text-muted-foreground">{search ? "Try a different name or identifier." : "Create the first reusable delivery template."}</p></div> :
              <div className="divide-y">{visible.map((item) => <Link key={item.id} href={`/admin/letter-templates/${item.id}`} className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-muted/40">
                <div className="flex h-9 w-9 items-center justify-center rounded-md border bg-muted/30"><FileText className="h-4 w-4 text-muted-foreground" /></div>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{item.name}</p><p className="mt-1 font-mono text-[11px] text-muted-foreground">{item.id} · {item.contextIds.length} context{item.contextIds.length === 1 ? "" : "s"}</p></div>
                <span className="rounded border px-2 py-1 text-[11px] font-medium text-muted-foreground">{mediumLabel[item.medium]}</span><ArrowRight className="h-4 w-4 text-muted-foreground" />
              </Link>)}</div>}
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader><CardTitle className="text-base">Create template</CardTitle><p className="text-sm text-muted-foreground">Start with the delivery contract. Content can be authored in TokenStudio after creation.</p></CardHeader>
          <CardContent className="space-y-4">
            {createError && <Alert variant="destructive"><AlertDescription>{createError}</AlertDescription></Alert>}
            {contexts.isError && <Alert variant="destructive"><AlertDescription className="flex items-center justify-between gap-3"><span>Token contexts could not be loaded.</span><Button type="button" variant="outline" size="sm" onClick={() => void contexts.refetch()}><RefreshCw className="mr-2 h-3.5 w-3.5" />Retry</Button></AlertDescription></Alert>}
            <div className="space-y-2"><Label htmlFor="template-name">Name</Label><Input id="template-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Benefits enrollment reminder" /></div>
            <div className="space-y-2"><Label>Medium</Label><Select value={medium} onValueChange={(v) => setMedium(v as MediumName)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{MEDIUM_NAMES.map((m) => <SelectItem key={m} value={m}>{mediumLabel[m]}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>Token contexts</Label><Select value={contextInput} onValueChange={addContext}><SelectTrigger><SelectValue placeholder="Select at least one context" /></SelectTrigger><SelectContent>{contextOptions.map((c) => c && <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select>
              <div className="flex flex-wrap gap-1.5">{contextIds.map((id) => <button type="button" key={id} onClick={() => setContextIds((ids) => ids.filter((value) => value !== id))} className="rounded border bg-muted/40 px-2 py-1 font-mono text-[11px] hover:bg-muted" title="Remove context">{id} ×</button>)}</div>
            </div>
            <Button className="w-full" disabled={!name.trim() || contextIds.length === 0 || create.isPending || contexts.isError} onClick={() => create.mutate()}>{create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}Create template</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}