import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Code } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { getApiErrorMessage } from "@/lib/queryClient";
import { prettifySqlSimple } from "../../../shared/utils/sql-prettify";
import type { EligibleWorkerActionsProps } from "../../../../../client/src/lib/eligible-worker-actions";

interface SqlResponse { sql: string; params: unknown[]; appliedConditions: unknown[] }
export default function EligibleWorkersSql({ jobId, query }: EligibleWorkerActionsProps) {
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const mutation = useMutation({
    mutationFn: async (): Promise<SqlResponse> => {
      const response = await fetch(`/api/dispatch-jobs/${jobId}/eligible-workers-sql?${query}`);
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || "Failed to fetch SQL");
      return response.json();
    },
    onSuccess: () => setOpen(true),
    onError: error => toast({ title: "Error", description: getApiErrorMessage(error, "Failed to fetch SQL query"), variant: "destructive" }),
  });
  if (!hasPermission("admin")) return null;
  const data = mutation.data;
  return <>
    <Button variant="outline" size="sm" onClick={() => mutation.mutate()} disabled={mutation.isPending} data-testid="button-debug-sql">
      <Code className="h-4 w-4 mr-1" />Debug: show SQL
    </Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader><DialogTitle>Eligible Workers SQL Query</DialogTitle><DialogDescription>The SQL query used to fetch eligible workers for this job.</DialogDescription></DialogHeader>
        <ScrollArea className="h-[60vh]">
          {data && <div className="space-y-4">
            <h4>SQL:</h4><pre className="p-4 bg-muted rounded-md text-xs whitespace-pre-wrap break-all font-mono">{prettifySqlSimple(data.sql)}</pre>
            {data.params.length > 0 && <><h4>Parameters:</h4><pre>{JSON.stringify(data.params, null, 2)}</pre></>}
            {data.appliedConditions.length > 0 && <><h4>Applied Conditions:</h4><pre>{JSON.stringify(data.appliedConditions, null, 2)}</pre></>}
          </div>}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  </>;
}
