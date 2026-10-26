import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { BULK_MESSAGE_TOKEN_CONTEXT } from "@shared/token-contexts";
import type { MediumName } from "@shared/delivery-fields";
import { ApiError, apiRequest } from "@/lib/queryClient";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, RefreshCw } from "lucide-react";

export type BulkTemplateIds = Partial<Record<MediumName, string>>;

interface LetterTemplateOption {
  id: string;
  name: string;
  medium: MediumName;
  contextIds?: string[];
}

interface BulkTemplateSelectorProps {
  media: MediumName[];
  value: BulkTemplateIds;
  onChange: (next: BulkTemplateIds) => void;
  disabled?: boolean;
  testIdPrefix: string;
}

const MEDIUM_LABELS: Record<MediumName, string> = {
  email: "Email",
  sms: "SMS",
  inapp: "In-app",
  postal: "Postal",
};

export function BulkTemplateSelector({
  media,
  value,
  onChange,
  disabled = false,
  testIdPrefix,
}: BulkTemplateSelectorProps) {
  const templatesQuery = useQuery<LetterTemplateOption[]>({
    queryKey: ["/api/admin/letter-templates", { context_id: BULK_MESSAGE_TOKEN_CONTEXT }],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/admin/letter-templates?context_id=${encodeURIComponent(BULK_MESSAGE_TOKEN_CONTEXT)}`,
      ),
    enabled: media.length > 0,
    staleTime: 30000,
  });
  const available = useMemo(
    () => (templatesQuery.data ?? []).filter((template) =>
      template.contextIds?.includes(BULK_MESSAGE_TOKEN_CONTEXT),
    ),
    [templatesQuery.data],
  );
  const templatesForbidden =
    templatesQuery.error instanceof ApiError &&
    (templatesQuery.error.status === 401 || templatesQuery.error.status === 403);

  if (templatesForbidden) return null;

  const updateMedium = (medium: MediumName, templateId: string) => {
    const next = { ...value };
    if (templateId === "none") delete next[medium];
    else next[medium] = templateId;
    onChange(next);
  };

  return (
    <section className="space-y-3 rounded-md border bg-muted/20 p-3" data-testid={`${testIdPrefix}-template-selector`}>
      <div>
        <div className="flex items-center gap-2 text-sm font-medium">
          <FileText className="h-4 w-4 text-muted-foreground" />
          Letter templates <span className="text-xs font-normal text-muted-foreground">Optional · selected per channel</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Leave a channel unset to keep its current wording or start with a blank draft.
        </p>
      </div>
      {templatesQuery.isLoading ? (
        <div className="space-y-2" role="status" aria-label="Loading letter templates">
          {media.map((medium) => <div key={medium} className="h-10 animate-pulse rounded-md border bg-muted/60" />)}
        </div>
      ) : templatesQuery.isError ? (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>Letter templates couldn’t be loaded. You can retry or continue without templates.</span>
            <Button type="button" size="sm" variant="outline" onClick={() => void templatesQuery.refetch()} disabled={templatesQuery.isFetching}>
              <RefreshCw className="mr-2 h-4 w-4" />Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : media.length === 0 ? (
        <p className="text-sm text-muted-foreground">Select at least one channel to choose a template.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {media.map((medium) => {
            const options = available.filter((template) => template.medium === medium);
            return (
              <div key={medium} className="space-y-1.5">
                <Label htmlFor={`${testIdPrefix}-template-${medium}`}>{MEDIUM_LABELS[medium]}</Label>
                <Select
                  value={value[medium] ?? "none"}
                  onValueChange={(templateId) => updateMedium(medium, templateId)}
                  disabled={disabled}
                >
                  <SelectTrigger id={`${testIdPrefix}-template-${medium}`} data-testid={`${testIdPrefix}-template-${medium}`}>
                    <SelectValue placeholder="No template" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No template</SelectItem>
                    {options.map((template) => (
                      <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {options.length === 0 && (
                  <p className="text-xs text-muted-foreground">No bulk-context templates for this channel.</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
