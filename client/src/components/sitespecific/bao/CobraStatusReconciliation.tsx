import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Result {
  caseId: string;
  changes: { statusId?: string; paymentStatus?: string | null };
  blockers: string[];
  applied: boolean;
  initialSatisfied?: boolean;
  targetStatusName?: string;
}

export function CobraStatusReconciliation({ caseId }: { caseId: string }) {
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<Result | null>(null);
  const [applied, setApplied] = useState(false);
  const request = useMutation({
    mutationFn: async (mode: "test" | "live") => {
      const response = await apiRequest("POST", "/api/sitespecific/bao/cobra/status-reconcile", {
        mode, caseIds: [caseId],
      });
      return { mode, report: await response.json() as { results: Result[] } };
    },
    onSuccess: async ({ mode, report }) => {
      setPreview(report.results[0]);
      setApplied(mode === "live" && report.results[0].applied);
      if (mode === "live") await queryClient.invalidateQueries();
    },
  });
  return (
    <Card>
      <CardHeader><CardTitle>Status reconciliation</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">Preview the case status supported by posted financial evidence. Applying changes status only, not payments or premiums.</p>
        <Button variant="outline" disabled={request.isPending} onClick={() => {
          setApplied(false);
          request.mutate("test");
        }}>Preview status reconciliation</Button>
        {request.error && <p role="alert" className="text-destructive">{request.error.message}</p>}
        {preview && (
          <div role="status" className="space-y-2 text-sm">
            {preview.blockers.length ? (
              <><p>Reconciliation blocked:</p><ul className="list-disc pl-5">{preview.blockers.map((b) => <li key={b}>{b}</li>)}</ul></>
            ) : applied ? <p>Case status reconciled.</p> : Object.keys(preview.changes).length ? (
              <>
                <p>Proposed payment status: {preview.changes.paymentStatus ?? "unchanged"}.
                  {preview.changes.statusId ? ` Proposed case status: ${preview.targetStatusName}.` : ""}
                  {preview.initialSatisfied !== undefined ? ` Initial obligation: ${preview.initialSatisfied ? "satisfied" : "not yet satisfied"}.` : ""}
                </p>
                <Button disabled={request.isPending} onClick={() => request.mutate("live")}>Apply status reconciliation</Button>
              </>
            ) : <p>No status changes are supported by the current evidence.</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
