import { useState } from "react";
import { useParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { DispatchJobLayout } from "@/components/layouts/DispatchJobLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiRequest, queryClient, getApiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { T631_STATUS_BADGE } from "@/components/sitespecific/t631/InterviewStatusModal";

const PAGE_SIZE = 50;

interface OfferRow {
  id: string;
  siriusId: number;
  name: string;
  interview: { id: string; status: string } | null;
}

interface OffersResponse {
  job: { id: string; title: string; employerName: string | null };
  total: number;
  workers: OfferRow[];
}

export default function DispatchJobT631InterviewOffersPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <DispatchJobLayout activeTab="sitespecific-t631-interviews-offers">
      <OffersContent jobId={id!} />
    </DispatchJobLayout>
  );
}

function OffersContent({ jobId }: { jobId: string }) {
  const { toast } = useToast();
  const [nameFilter, setNameFilter] = useState("");
  const [appliedName, setAppliedName] = useState("");
  const [page, setPage] = useState(0);
  const [offerTarget, setOfferTarget] = useState<OfferRow | null>(null);

  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(page * PAGE_SIZE),
  });
  if (appliedName) params.set("name", appliedName);
  const listUrl = `/api/sitespecific/t631/interviews/views/job/${jobId}/offers?${params.toString()}`;

  const { data, isLoading, isError } = useQuery<OffersResponse>({
    queryKey: [listUrl],
  });

  const invalidateOfferQueries = () => {
    // All pages/filters of this job's offers view + the List subtab data.
    queryClient.invalidateQueries({
      predicate: (q) =>
        typeof q.queryKey[0] === "string" &&
        (q.queryKey[0] as string).startsWith(
          `/api/sitespecific/t631/interviews/views/job/${jobId}`,
        ),
    });
    // Interview rows can flip tab relevance gating.
    queryClient.invalidateQueries({ queryKey: ["/api/access/tabs"] });
  };

  const offerMutation = useMutation({
    mutationFn: async (workerId: string) =>
      apiRequest("POST", `/api/sitespecific/t631/interviews/views/job/${jobId}/offers`, {
        workerId,
      }),
    onSuccess: () => {
      toast({ title: "Interview offered", description: "The worker now has an offered interview." });
      setOfferTarget(null);
      invalidateOfferQueries();
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not offer interview",
        description: getApiErrorMessage(error, "Failed to create the interview offer."),
        variant: "destructive",
      });
      setOfferTarget(null);
      // A 409 means someone else already offered — refresh so the row shows it.
      invalidateOfferQueries();
    },
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus size={18} /> Interview Offers
          </CardTitle>
          <CardDescription>
            Workers who would be eligible for this job once they pass an interview.
            Offer an interview to invite them.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setPage(0);
              setAppliedName(nameFilter.trim());
            }}
          >
            <Input
              placeholder="Filter by name…"
              value={nameFilter}
              onChange={(e) => setNameFilter(e.target.value)}
              className="max-w-xs"
              data-testid="input-offers-name-filter"
            />
            <Button type="submit" variant="outline" data-testid="button-offers-filter">
              Filter
            </Button>
          </form>

          {isLoading ? (
            <Skeleton className="h-64 w-full" data-testid="skeleton-offers" />
          ) : isError || !data ? (
            <p className="text-muted-foreground text-center py-8" data-testid="text-offers-error">
              Unable to load eligible workers for this job.
            </p>
          ) : data.workers.length === 0 ? (
            <p className="text-muted-foreground text-center py-8" data-testid="text-no-eligible">
              No eligible workers found.
            </p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Worker</TableHead>
                    <TableHead>ID</TableHead>
                    <TableHead>Interview</TableHead>
                    <TableHead className="w-40" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.workers.map((row) => (
                    <TableRow key={row.id} data-testid={`row-offer-${row.id}`}>
                      <TableCell data-testid={`text-offer-name-${row.id}`}>{row.name}</TableCell>
                      <TableCell>{row.siriusId}</TableCell>
                      <TableCell>
                        {row.interview ? (
                          <Badge
                            className={(T631_STATUS_BADGE as Record<string, string>)[row.interview.status] ?? ""}
                            data-testid={`badge-offer-status-${row.id}`}
                          >
                            {row.interview.status}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground" data-testid={`text-not-offered-${row.id}`}>
                            Not offered
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {!row.interview && (
                          <Button
                            size="sm"
                            onClick={() => setOfferTarget(row)}
                            data-testid={`button-offer-${row.id}`}
                          >
                            Offer interview
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground" data-testid="text-offers-total">
                  {data.total} eligible worker{data.total === 1 ? "" : "s"}
                </p>
                {totalPages > 1 && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page === 0}
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      data-testid="button-offers-prev"
                    >
                      Previous
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      Page {page + 1} of {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page + 1 >= totalPages}
                      onClick={() => setPage((p) => p + 1)}
                      data-testid="button-offers-next"
                    >
                      Next
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!offerTarget} onOpenChange={(open) => !open && setOfferTarget(null)}>
        <DialogContent data-testid="dialog-offer-confirm">
          <DialogHeader>
            <DialogTitle>Offer interview</DialogTitle>
            <DialogDescription>
              Create an interview with status “offered” for{" "}
              <span className="font-medium text-foreground">{offerTarget?.name}</span>?
              They will appear on the interview list for this job.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOfferTarget(null)} data-testid="button-offer-cancel">
              Cancel
            </Button>
            <Button
              onClick={() => offerTarget && offerMutation.mutate(offerTarget.id)}
              disabled={offerMutation.isPending}
              data-testid="button-offer-confirm"
            >
              {offerMutation.isPending ? "Offering…" : "Offer interview"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
