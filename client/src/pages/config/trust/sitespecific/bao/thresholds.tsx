import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface MemberStatus {
  id: string;
  name: string;
  sequence?: number;
  data?: Record<string, any> | null;
}

const OPTIONS_KEY = ["/api/options", "worker-ms"] as const;

function getSavedThreshold(status: MemberStatus): number | undefined {
  const value = status.data?.sitespecific?.bao?.threshold;
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

/**
 * Merge a threshold (or its removal) into a status's existing JSON `data`
 * without disturbing any other keys. The unified-options update endpoint
 * replaces the whole `data` column, so we must send the full merged object.
 */
function mergeThreshold(
  existing: Record<string, any> | null | undefined,
  threshold: number | undefined,
): Record<string, any> {
  const data: Record<string, any> = { ...(existing ?? {}) };
  const sitespecific: Record<string, any> = { ...(data.sitespecific ?? {}) };
  const bao: Record<string, any> = { ...(sitespecific.bao ?? {}) };

  if (threshold === undefined) {
    delete bao.threshold;
  } else {
    bao.threshold = threshold;
  }

  sitespecific.bao = bao;
  data.sitespecific = sitespecific;
  return data;
}

export default function BaoMemberStatusThresholdsPage() {
  usePageTitle("Member Status Thresholds");
  const { toast } = useToast();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const { data: statuses = [], isLoading } = useQuery<MemberStatus[]>({
    queryKey: OPTIONS_KEY,
  });

  const sorted = useMemo(
    () =>
      [...statuses].sort(
        (a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || a.name.localeCompare(b.name),
      ),
    [statuses],
  );

  const updateMutation = useMutation({
    mutationFn: async ({
      status,
      threshold,
    }: {
      status: MemberStatus;
      threshold: number | undefined;
    }) => {
      const data = mergeThreshold(status.data, threshold);
      return apiRequest("PUT", `/api/options/worker-ms/${status.id}`, { data });
    },
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({ queryKey: OPTIONS_KEY });
      setEdits((prev) => {
        const next = { ...prev };
        delete next[variables.status.id];
        return next;
      });
      toast({ title: "Saved", description: `Threshold updated for ${variables.status.name}.` });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
    onSettled: () => setSavingId(null),
  });

  function currentValue(status: MemberStatus): string {
    if (status.id in edits) return edits[status.id];
    const saved = getSavedThreshold(status);
    return saved === undefined ? "" : String(saved);
  }

  function isDirty(status: MemberStatus): boolean {
    if (!(status.id in edits)) return false;
    const saved = getSavedThreshold(status);
    const savedStr = saved === undefined ? "" : String(saved);
    return edits[status.id].trim() !== savedStr;
  }

  function validationError(raw: string): string | null {
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    if (!/^\d+$/.test(trimmed)) {
      return "Enter a whole number of hours (0 or greater).";
    }
    return null;
  }

  function handleSave(status: MemberStatus) {
    const raw = currentValue(status);
    const error = validationError(raw);
    if (error) {
      toast({ title: "Invalid value", description: error, variant: "destructive" });
      return;
    }
    const trimmed = raw.trim();
    const threshold = trimmed === "" ? undefined : parseInt(trimmed, 10);
    setSavingId(status.id);
    updateMutation.mutate({ status, threshold });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle data-testid="text-page-title">Member Status Thresholds</CardTitle>
              <CardDescription>
                Set the hours threshold (a whole number of hours) for each member status.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : sorted.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No member statuses configured yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member Status</TableHead>
                  <TableHead className="w-[220px]">Hours Threshold</TableHead>
                  <TableHead className="w-[120px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((status) => {
                  const raw = currentValue(status);
                  const error = validationError(raw);
                  const dirty = isDirty(status);
                  const saving = savingId === status.id;
                  return (
                    <TableRow key={status.id} data-testid={`row-status-${status.id}`}>
                      <TableCell data-testid={`text-status-name-${status.id}`}>
                        {status.name}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          inputMode="numeric"
                          placeholder="Not set"
                          value={raw}
                          onChange={(e) =>
                            setEdits((prev) => ({ ...prev, [status.id]: e.target.value }))
                          }
                          data-testid={`input-threshold-${status.id}`}
                        />
                        {error && (
                          <p
                            className="text-xs text-destructive mt-1"
                            data-testid={`error-threshold-${status.id}`}
                          >
                            {error}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          onClick={() => handleSave(status)}
                          disabled={!dirty || !!error || saving}
                          data-testid={`button-save-${status.id}`}
                        >
                          {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                          Save
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
