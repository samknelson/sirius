import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, FileText, Loader2, Maximize2, RefreshCw, Save } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TokenStudio, type StudioField } from "@/components/template-studio/TokenStudio";
import { apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { MEDIUM_FIELDS } from "@shared/delivery-fields";

const CONTEXT_ID = "employer-compliance-letter";
const STARTER_URL = "/api/employer-compliance/letter-starter";
const STARTER_CHOICE = "__reusable_starter__";

interface ComplianceLetterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employerId: string;
  employerName: string;
  wizardType: string;
  year: number;
  month: number;
  monthsBack: number;
  selectedAccountIds: string[];
}

interface StarterResponse {
  name: string;
  medium: "postal";
  contextIds: string[];
  content: { bodyHtml?: string; description?: string };
}

interface LetterTemplateOption {
  id: string;
  name: string;
  medium: "postal";
  contextIds: string[];
  content: Record<string, string>;
}

interface SavedTemplate {
  id?: string;
  name?: string;
}

const letterFields: StudioField[] = [
  { key: "body", label: "Letter body", mode: "html" },
  { key: "description", label: "Mailing description", mode: "multiline" },
];

function starterValues(starter?: StarterResponse): Record<string, string> {
  // The reusable starter calls its HTML field bodyHtml; postal delivery's
  // canonical medium field is body, which is what MEDIUM_FIELDS.postal declares.
  return {
    body: starter?.content?.bodyHtml ?? "",
    description: starter?.content?.description ?? "",
  };
}

export function ComplianceLetterDialog({
  open,
  onOpenChange,
  employerId,
  employerName,
  wizardType,
  year,
  month,
  monthsBack,
  selectedAccountIds,
}: ComplianceLetterDialogProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [values, setValues] = useState<Record<string, string>>({ body: "", description: "" });
  const [templateName, setTemplateName] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [studioOpen, setStudioOpen] = useState(false);
  const initializedForScope = useRef("");

  const scopeKey = `${employerId}:${wizardType}:${year}:${month}:${monthsBack}:${selectedAccountIds.join(",")}`;
  const seedsUrl = useMemo(() => {
    const params = new URLSearchParams({
      employerId,
      wizardType,
      year: String(year),
      month: String(month),
      monthsBack: String(monthsBack),
      ledgerAccountIds: selectedAccountIds.join(","),
    });
    return `/api/employer-compliance/letter-seeds?${params.toString()}`;
  }, [employerId, wizardType, year, month, monthsBack, selectedAccountIds]);

  const starter = useQuery<StarterResponse>({
    queryKey: [STARTER_URL],
    enabled: open,
  });
  const templates = useQuery<LetterTemplateOption[]>({
    queryKey: [
      "/api/admin/letter-templates",
      { medium: "postal", context_id: CONTEXT_ID },
    ],
    enabled: open,
  });

  useEffect(() => {
    if (!open) {
      initializedForScope.current = "";
      return;
    }
    if (!starter.data || initializedForScope.current === scopeKey) return;
    initializedForScope.current = scopeKey;
    setValues(starterValues(starter.data));
    setTemplateName("Employer compliance letter");
    setSelectedTemplateId("");
  }, [open, starter.data, scopeKey, employerName]);

  const saveTemplate = useMutation({
    mutationFn: async () => {
      const name = templateName.trim();
      if (!name) throw new Error("Enter a name for this saved template.");
      const content = { ...values };
      if (selectedTemplateId) {
        return await apiRequest(
          "PATCH",
          `/api/admin/letter-templates/${encodeURIComponent(selectedTemplateId)}`,
          { name, content },
        ) as SavedTemplate;
      }
      return await apiRequest(
        "POST",
        `/api/admin/letter-templates?medium=postal&context_id=${encodeURIComponent(CONTEXT_ID)}`,
        {
          name,
          medium: "postal",
          contextIds: [CONTEXT_ID],
          content,
        },
      ) as SavedTemplate;
    },
    onSuccess: (saved) => {
      if (saved?.id) setSelectedTemplateId(saved.id);
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/letter-templates"] });
      toast({
        title: selectedTemplateId ? "Template updated" : "Template saved",
        description: "The reusable postal template was saved to the letter library.",
      });
    },
  });

  const changeField = (key: string, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    saveTemplate.reset();
  };

  const loadTemplate = (id: string) => {
    if (id === STARTER_CHOICE) {
      setSelectedTemplateId("");
      setValues(starterValues(starter.data));
      setTemplateName("Employer compliance letter");
      saveTemplate.reset();
      return;
    }
    const template = templates.data?.find((item) => item.id === id);
    if (!template) return;
    setSelectedTemplateId(template.id);
    setValues({
      body: template.content?.body ?? template.content?.bodyHtml ?? "",
      description: template.content?.description ?? "",
    });
    setTemplateName(template.name);
    saveTemplate.reset();
  };

  const compatibleTemplates = (templates.data ?? []).filter(
    (template) =>
      template.medium === "postal" &&
      Array.isArray(template.contextIds) &&
      template.contextIds.includes(CONTEXT_ID),
  );
  const loadError = starter.error || templates.error;
  const saveError = saveTemplate.error
    ? getApiErrorMessage(saveTemplate.error, "The template could not be saved.")
    : null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              Preview employer letter
            </DialogTitle>
            <DialogDescription>
              A report-backed draft for <span className="font-medium text-foreground">{employerName}</span>.
              This is a preview only; no letter will be sent.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-md border bg-muted/30 px-4 py-3 text-sm">
              <p className="font-medium">{employerName}</p>
              <p className="mt-1 text-muted-foreground">
                {wizardType || "No upload type"} · {year}-{String(month).padStart(2, "0")} anchor · {monthsBack} month{monthsBack === 1 ? "" : "s"} · {selectedAccountIds.length} ledger account{selectedAccountIds.length === 1 ? "" : "s"}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Preview scope is fixed to this report employer and its selected accounts. Saved templates contain no report or account IDs.
              </p>
            </div>

            {loadError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                  <span>
                    {starter.error
                      ? `Could not load the reusable letter starter: ${getApiErrorMessage(starter.error, "request failed")}`
                      : `Could not load compatible saved templates: ${getApiErrorMessage(templates.error, "request failed")}`}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (starter.error) void starter.refetch();
                      if (templates.error) void templates.refetch();
                    }}
                  >
                    <RefreshCw className="mr-2 h-3.5 w-3.5" />
                    Retry
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {(starter.isLoading || templates.isLoading) && (
              <div className="space-y-2" aria-label="Loading letter options">
                <div className="h-10 animate-pulse rounded-md bg-muted" />
                <div className="h-24 animate-pulse rounded-md bg-muted" />
              </div>
            )}

            {!starter.isLoading && !starter.error && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="compliance-letter-template">Starting content</Label>
                    <Select
                      value={selectedTemplateId || STARTER_CHOICE}
                      onValueChange={loadTemplate}
                      disabled={templates.isLoading || Boolean(templates.error)}
                    >
                      <SelectTrigger id="compliance-letter-template">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={STARTER_CHOICE}>Reusable starter</SelectItem>
                        {compatibleTemplates.map((template) => (
                          <SelectItem key={template.id} value={template.id}>
                            {template.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="compliance-letter-name">Saved template name</Label>
                    <Input
                      id="compliance-letter-name"
                      value={templateName}
                      onChange={(event) => setTemplateName(event.target.value)}
                      placeholder="Name this reusable letter"
                    />
                  </div>
                </div>

                {compatibleTemplates.length === 0 && !templates.isLoading && !templates.error && (
                  <p className="text-xs text-muted-foreground">
                    No saved postal templates are available for this context yet. Saving creates one in the shared letter library.
                  </p>
                )}
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">Review and edit the letter</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Open the token editor to preview this wording against the selected employer&apos;s report.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setStudioOpen(true)}
                    disabled={starter.isLoading || Boolean(starter.error)}
                    data-testid="button-edit-compliance-letter"
                  >
                    <Maximize2 className="mr-2 h-4 w-4" />
                    Edit in TokenStudio
                  </Button>
                </div>
              </>
            )}

            {saveError && <Alert variant="destructive"><AlertDescription>{saveError}</AlertDescription></Alert>}
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close preview
            </Button>
            <Button
              type="button"
              onClick={() => saveTemplate.mutate()}
              disabled={
                starter.isLoading ||
                Boolean(starter.error) ||
                templates.isLoading ||
                Boolean(templates.error) ||
                !templateName.trim() ||
                saveTemplate.isPending
              }
            >
              {saveTemplate.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {selectedTemplateId ? "Update saved template" : "Save as template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {open && starter.data && !starter.error && (
        <TokenStudio
          open={studioOpen}
          onOpenChange={setStudioOpen}
          title={`${employerName} · Postal letter`}
          description="Edit reusable wording here. Report data is supplied only to this preview and is not saved in the template."
          channel="postal"
          fields={letterFields}
          values={values}
          onValueChange={changeField}
          onValuesChange={(nextValues) => {
            const nextContent = {
              body: nextValues.body ?? "",
              description: nextValues.description ?? "",
            };
            setValues(nextContent);
            const matchingTemplate = compatibleTemplates.find(
              (template) =>
                (template.content?.body ?? template.content?.bodyHtml ?? "") === nextContent.body &&
                (template.content?.description ?? "") === nextContent.description,
            );
            setSelectedTemplateId(matchingTemplate?.id ?? "");
            if (matchingTemplate) {
              setTemplateName(matchingTemplate.name);
            }
            saveTemplate.reset();
          }}
          fieldSpecs={MEDIUM_FIELDS.postal}
          contextId={CONTEXT_ID}
          seedsUrl={seedsUrl}
          hostNotice={
            <p className="text-sm text-muted-foreground">
              Report scope: {employerName}. This letter is preview only and will not be sent.
            </p>
          }
        />
      )}
    </>
  );
}
