import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ArrowRight, CheckCircle2, AlertCircle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";

interface FeedField {
  id: string;
  name: string;
  type?: string;
  required?: boolean;
  requiredForCreate?: boolean;
  requiredForUpdate?: boolean;
  description?: string;
}

interface MapData {
  fields: FeedField[];
  previewRows: any[][];
  columnCount: number;
  fileName: string | null;
  columnMapping: Record<string, string>;
  mode: "create" | "update";
  hasHeaders: boolean;
}

const UNMAPPED = "_unmapped";

/** Normalize either stored shape into the flipped `{ fieldId: colKey }`. */
function toFieldToCol(
  mapping: Record<string, string>,
): Record<string, string> {
  const keys = Object.keys(mapping);
  const isOld = keys.length > 0 && keys.every((k) => k.startsWith("col_"));
  if (!isOld) return { ...mapping };
  const flipped: Record<string, string> = {};
  for (const [colKey, fieldId] of Object.entries(mapping)) {
    if (fieldId && fieldId !== UNMAPPED) flipped[fieldId] = colKey;
  }
  return flipped;
}

function isRequired(field: FeedField, mode: "create" | "update"): boolean {
  return !!(
    field.required ||
    (mode === "create" && field.requiredForCreate) ||
    (mode === "update" && field.requiredForUpdate)
  );
}

/**
 * Generic escape-hatch `map` step for feed/import wizards — the flipped
 * mapping UI (feed fields as rows, each pointing at a file column). Reads
 * fields + preview through the fixed dispatcher `getData` route and writes
 * `columnMapping` / `mode` / `hasHeaders` through `submit`. No wizard route.
 */
export function FeedMap({ wizardId, step }: WizardStepComponentProps) {
  const { toast } = useToast();

  const { data: mapData, isLoading } = useQuery<MapData>({
    queryKey: ["/api/wizards", wizardId, "dispatch", step.id, "data"],
  });

  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<"create" | "update">("create");
  const [hasHeaders, setHasHeaders] = useState(true);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!mapData || hydrated) return;
    setMapping(toFieldToCol(mapData.columnMapping || {}));
    setMode(mapData.mode || "create");
    setHasHeaders(mapData.hasHeaders ?? true);
    setHydrated(true);
  }, [mapData, hydrated]);

  const columns = useMemo(() => {
    const count = mapData?.columnCount ?? 0;
    const headerRow =
      hasHeaders && mapData?.previewRows?.[0] ? mapData.previewRows[0] : null;
    return Array.from({ length: count }, (_, i) => ({
      key: `col_${i}`,
      label: headerRow?.[i]
        ? String(headerRow[i])
        : `Column ${i + 1}`,
    }));
  }, [mapData, hasHeaders]);

  const fields = mapData?.fields ?? [];

  const duplicateCols = useMemo(() => {
    const used = Object.values(mapping).filter((c) => c && c !== UNMAPPED);
    return new Set(used.filter((c, i) => used.indexOf(c) !== i));
  }, [mapping]);

  const missingRequired = useMemo(
    () =>
      fields.filter(
        (f) =>
          isRequired(f, mode) &&
          (!mapping[f.id] || mapping[f.id] === UNMAPPED),
      ),
    [fields, mapping, mode],
  );

  const saveMutation = useMutation({
    mutationFn: async () =>
      apiRequest("POST", `/api/wizards/${wizardId}/dispatch/${step.id}/submit`, {
        input: {
          columnMapping: mapping,
          mode,
          hasHeaders,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
      queryClient.invalidateQueries({
        queryKey: ["/api/wizards", wizardId, "dispatch", step.id, "data"],
      });
      toast({
        title: "Mapping Saved",
        description: "Column mapping saved. You can proceed to the next step.",
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Save Failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const setField = (fieldId: string, colKey: string) => {
    setMapping((prev) => ({ ...prev, [fieldId]: colKey }));
  };

  const previewBody =
    (hasHeaders ? mapData?.previewRows?.slice(1) : mapData?.previewRows) ?? [];

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </CardContent>
      </Card>
    );
  }

  if (!mapData?.fileName || columns.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{step.name}</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>No file to map</AlertTitle>
            <AlertDescription>
              Go back to the upload step and upload a data file first.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{step.name}</CardTitle>
          <CardDescription>
            Map each field to a column from{" "}
            <span className="font-medium">{mapData.fileName}</span>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-wrap items-center gap-8">
            <div className="space-y-2">
              <Label>Import Mode</Label>
              <RadioGroup
                value={mode}
                onValueChange={(v) => setMode(v as "create" | "update")}
                className="flex gap-4"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="create" id="mode-create" />
                  <Label htmlFor="mode-create" className="font-normal">
                    Create new records
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="update" id="mode-update" />
                  <Label htmlFor="mode-update" className="font-normal">
                    Update existing records
                  </Label>
                </div>
              </RadioGroup>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                id="has-headers"
                checked={hasHeaders}
                onCheckedChange={setHasHeaders}
              />
              <Label htmlFor="has-headers" className="font-normal">
                First row contains headers
              </Label>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Field</TableHead>
                <TableHead className="w-8" />
                <TableHead>File Column</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fields.map((field) => {
                const value = mapping[field.id] || UNMAPPED;
                const isDup = value !== UNMAPPED && duplicateCols.has(value);
                return (
                  <TableRow key={field.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{field.name}</span>
                        {isRequired(field, mode) && (
                          <Badge variant="destructive" className="text-xs">
                            Required
                          </Badge>
                        )}
                      </div>
                      {field.description && (
                        <p className="text-xs text-muted-foreground">
                          {field.description}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={value}
                        onValueChange={(v) => setField(field.id, v)}
                      >
                        <SelectTrigger
                          className={isDup ? "border-destructive" : undefined}
                          data-testid={`select-map-${field.id}`}
                        >
                          <SelectValue placeholder="Select a column…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={UNMAPPED}>
                            <span className="text-muted-foreground">
                              — Not mapped —
                            </span>
                          </SelectItem>
                          {columns.map((col) => (
                            <SelectItem key={col.key} value={col.key}>
                              {col.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {isDup && (
                        <p className="text-xs text-destructive mt-1">
                          This column is mapped to more than one field.
                        </p>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {missingRequired.length > 0 ? (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Required fields not mapped</AlertTitle>
              <AlertDescription>
                {missingRequired.map((f) => f.name).join(", ")}
              </AlertDescription>
            </Alert>
          ) : (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>All required fields mapped</AlertTitle>
              <AlertDescription>
                Save the mapping to continue.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex justify-end">
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={
                saveMutation.isPending ||
                duplicateCols.size > 0 ||
                missingRequired.length > 0
              }
              data-testid="button-save-mapping"
            >
              {saveMutation.isPending ? "Saving…" : "Save Mapping"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {previewBody.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Preview</CardTitle>
            <CardDescription>
              First {previewBody.length} data row(s)
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((col) => (
                    <TableHead key={col.key}>{col.label}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {previewBody.map((row, i) => (
                  <TableRow key={i}>
                    {columns.map((col, ci) => (
                      <TableCell key={col.key} className="whitespace-nowrap">
                        {row[ci] != null ? String(row[ci]) : ""}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
