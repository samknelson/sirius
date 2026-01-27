import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Phone, Search, UserPlus, Loader2, Check } from "lucide-react";
import { DispatchJobLayout, useDispatchJobLayout } from "@/components/layouts/DispatchJobLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface EligibleWorker {
  id: string;
  siriusId: number;
  displayName: string;
}

interface EligibleWorkersResult {
  workers: EligibleWorker[];
  total: number;
}

function JobDispatchesCbnContent() {
  const { job } = useDispatchJobLayout();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedWorkers, setSelectedWorkers] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery<EligibleWorkersResult>({
    queryKey: [
      `/api/dispatch-jobs/${job.id}/eligible-workers`,
      { name: searchQuery.trim() || undefined, excludeWithDispatches: "true", limit: "100" }
    ],
  });

  const createDispatchMutation = useMutation({
    mutationFn: async (workerIds: string[]) => {
      const results = await Promise.all(
        workerIds.map(workerId =>
          apiRequest("POST", "/api/dispatches", {
            jobId: job.id,
            workerId,
            status: "pending",
          })
        )
      );
      return results;
    },
    onSuccess: (_, workerIds) => {
      toast({
        title: "Dispatches Created",
        description: `Created ${workerIds.length} dispatch${workerIds.length === 1 ? "" : "es"} with status "Pending"`,
      });
      setSelectedWorkers(new Set());
      queryClient.invalidateQueries({ queryKey: [`/api/dispatch-jobs/${job.id}/eligible-workers`] });
      queryClient.invalidateQueries({ queryKey: ["/api/dispatches/job", job.id] });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create one or more dispatches",
        variant: "destructive",
      });
    },
  });

  const workers = data?.workers ?? [];
  const total = data?.total ?? 0;

  const toggleWorkerSelection = (workerId: string) => {
    setSelectedWorkers(prev => {
      const next = new Set(prev);
      if (next.has(workerId)) {
        next.delete(workerId);
      } else {
        next.add(workerId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedWorkers.size === workers.length) {
      setSelectedWorkers(new Set());
    } else {
      setSelectedWorkers(new Set(workers.map(w => w.id)));
    }
  };

  const handleCreateDispatches = () => {
    if (selectedWorkers.size === 0) return;
    createDispatchMutation.mutate(Array.from(selectedWorkers));
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="flex items-center gap-2">
          <Phone className="h-5 w-5" />
          Call by Name
        </CardTitle>
        {selectedWorkers.size > 0 && (
          <Button
            onClick={handleCreateDispatches}
            disabled={createDispatchMutation.isPending}
            data-testid="button-create-dispatches"
          >
            {createDispatchMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <UserPlus className="h-4 w-4 mr-2" />
            )}
            Create {selectedWorkers.size} Dispatch{selectedWorkers.size === 1 ? "" : "es"}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search eligible workers by name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
              data-testid="input-search-workers"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : workers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12" data-testid="empty-state-no-workers">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
              <Phone className="text-muted-foreground" size={32} />
            </div>
            <h3 className="text-lg font-medium text-foreground mb-2" data-testid="text-empty-title">No Eligible Workers</h3>
            <p className="text-muted-foreground text-center" data-testid="text-empty-message">
              {searchQuery
                ? "No eligible workers match your search criteria."
                : "All eligible workers already have dispatches for this job."}
            </p>
          </div>
        ) : (
          <>
            <div className="text-sm text-muted-foreground mb-2" data-testid="text-worker-count">
              Showing {workers.length} of {total} eligible workers without dispatches
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <Checkbox
                      checked={workers.length > 0 && selectedWorkers.size === workers.length}
                      onCheckedChange={toggleSelectAll}
                      aria-label="Select all"
                      data-testid="checkbox-select-all"
                    />
                  </TableHead>
                  <TableHead>Sirius ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workers.map((worker) => (
                  <TableRow key={worker.id} data-testid={`row-worker-${worker.id}`}>
                    <TableCell>
                      <Checkbox
                        checked={selectedWorkers.has(worker.id)}
                        onCheckedChange={() => toggleWorkerSelection(worker.id)}
                        aria-label={`Select ${worker.displayName}`}
                        data-testid={`checkbox-worker-${worker.id}`}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-sm" data-testid={`text-siriusid-${worker.id}`}>
                      {worker.siriusId}
                    </TableCell>
                    <TableCell data-testid={`text-name-${worker.id}`}>{worker.displayName || "Unknown"}</TableCell>
                    <TableCell>
                      {selectedWorkers.has(worker.id) && (
                        <Check className="h-4 w-4 text-primary" data-testid={`icon-selected-${worker.id}`} />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function JobDispatchesCbnPage() {
  return (
    <DispatchJobLayout activeTab="dispatches-cbn">
      <JobDispatchesCbnContent />
    </DispatchJobLayout>
  );
}
