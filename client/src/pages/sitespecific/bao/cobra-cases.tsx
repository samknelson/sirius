import { useState } from "react";
import { ShieldPlus, Plus, RefreshCw } from "lucide-react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { PageHeader } from "@/components/layout/PageHeader";
import type { BaoCobraCaseWithDetails } from "@shared/schema/sitespecific/bao/schema";
import {
  cobraSourceLabel,
  type CobraStatusOption,
  type CobraQualifyingEventOption,
} from "@/components/sitespecific/bao/CobraCaseForm";

const ALL = "__all__";

function formatYmd(value: string | null | undefined): string {
  if (!value) return "—";
  const ymd = value.slice(0, 10);
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd;
  return `${parseInt(m[2])}/${parseInt(m[3])}/${m[1]}`;
}

interface CobraReconcileSummary {
  events: number;
  groups: number;
  notQualifying: number;
  created: number;
  merged: number;
  skippedExisting: number;
  skippedInvariant: number;
  errors: number;
}

export default function BaoCobraCases() {
  const { toast } = useToast();
  const [statusId, setStatusId] = useState<string>(ALL);
  const [qualifyingEventId, setQualifyingEventId] = useState<string>(ALL);
  const [fromYmd, setFromYmd] = useState("");
  const [toYmd, setToYmd] = useState("");

  const { data: statuses = [] } = useQuery<CobraStatusOption[]>({
    queryKey: ["/api/options/bao-cobra-status"],
  });
  const { data: events = [] } = useQuery<CobraQualifyingEventOption[]>({
    queryKey: ["/api/options/bao-cobra-qualifying-event"],
  });

  const { data: cases = [], isLoading } = useQuery<BaoCobraCaseWithDetails[]>({
    queryKey: [
      "/api/sitespecific/bao/cobra/cases",
      statusId,
      qualifyingEventId,
      fromYmd,
      toYmd,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusId !== ALL) params.set("statusId", statusId);
      if (qualifyingEventId !== ALL) params.set("qualifyingEventId", qualifyingEventId);
      if (/^\d{4}-\d{2}-\d{2}$/.test(fromYmd)) params.set("fromYmd", fromYmd);
      if (/^\d{4}-\d{2}-\d{2}$/.test(toYmd)) params.set("toYmd", toYmd);
      const response = await fetch(`/api/sitespecific/bao/cobra/cases?${params.toString()}`);
      if (!response.ok) throw new Error("Failed to load COBRA cases");
      return response.json();
    },
  });

  const reconcileMutation = useMutation({
    mutationFn: async (): Promise<CobraReconcileSummary> => {
      return apiRequest("POST", "/api/sitespecific/bao/cobra/cases/reconcile");
    },
    onSuccess: (summary) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sitespecific/bao/cobra/cases"] });
      toast({
        title: "Reconciliation complete",
        description: `${summary.created} case(s) created, ${summary.merged} merged, ${summary.skippedExisting} already handled (${summary.groups} termination month(s) from ${summary.events} event(s))${summary.errors ? `, ${summary.errors} error(s)` : ""}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Reconciliation failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="bg-background text-foreground min-h-screen">
      <PageHeader
        title="COBRA Cases"
        icon={<ShieldPlus className="text-primary-foreground" size={16} />}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => reconcileMutation.mutate()}
            disabled={reconcileMutation.isPending}
            data-testid="button-reconcile-cobra-cases"
          >
            <RefreshCw
              size={16}
              className={`mr-2 ${reconcileMutation.isPending ? "animate-spin" : ""}`}
            />
            {reconcileMutation.isPending ? "Reconciling…" : "Reconcile from WMB Events"}
          </Button>
          <Link href="/cobra/cases/add">
            <Button data-testid="button-add-cobra-case">
              <Plus size={16} className="mr-2" />
              Add Case
            </Button>
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Filters</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-4">
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={statusId} onValueChange={setStatusId}>
                <SelectTrigger className="w-52" data-testid="select-filter-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All statuses</SelectItem>
                  {statuses.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Qualifying Event</Label>
              <Select value={qualifyingEventId} onValueChange={setQualifyingEventId}>
                <SelectTrigger className="w-52" data-testid="select-filter-event">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All events</SelectItem>
                  {events.map((ev) => (
                    <SelectItem key={ev.id} value={ev.id}>
                      {ev.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Effective From</Label>
              <Input
                type="date"
                value={fromYmd}
                onChange={(e) => setFromYmd(e.target.value)}
                data-testid="input-filter-from"
              />
            </div>
            <div className="space-y-1">
              <Label>Effective To</Label>
              <Input
                type="date"
                value={toYmd}
                onChange={(e) => setToYmd(e.target.value)}
                data-testid="input-filter-to"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 space-y-3">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : cases.length === 0 ? (
              <div
                className="text-center py-12 text-muted-foreground"
                data-testid="text-no-cobra-cases"
              >
                No COBRA cases found.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Covered Person</TableHead>
                    <TableHead>Subscriber</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Qualifying Event</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>COBRA Effective</TableHead>
                    <TableHead>Last Day to Elect</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cases.map((c) => (
                    <TableRow key={c.id} data-testid={`row-cobra-case-${c.id}`}>
                      <TableCell
                        className="font-medium"
                        data-testid={`text-case-covered-${c.id}`}
                      >
                        {c.coveredPersonName ?? "—"}
                      </TableCell>
                      <TableCell data-testid={`text-case-subscriber-${c.id}`}>
                        {c.subscriberName ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={c.statusClosed ? "outline" : "secondary"}
                          data-testid={`badge-case-status-${c.id}`}
                        >
                          {c.statusName ?? "—"}
                        </Badge>
                      </TableCell>
                      <TableCell data-testid={`text-case-event-${c.id}`}>
                        {c.qualifyingEventName ?? "—"}
                      </TableCell>
                      <TableCell data-testid={`text-case-source-${c.id}`}>
                        {cobraSourceLabel(c.source)}
                      </TableCell>
                      <TableCell data-testid={`text-case-effective-${c.id}`}>
                        {formatYmd(c.cobraEffectiveYmd)}
                      </TableCell>
                      <TableCell data-testid={`text-case-elect-by-${c.id}`}>
                        {formatYmd(c.lastDayToElectYmd)}
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        <Link href={`/cobra/cases/${c.id}`}>
                          <Button
                            variant="ghost"
                            size="sm"
                            data-testid={`button-view-case-${c.id}`}
                          >
                            View
                          </Button>
                        </Link>
                        <Link href={`/cobra/cases/${c.id}/edit`}>
                          <Button
                            variant="ghost"
                            size="sm"
                            data-testid={`button-edit-case-${c.id}`}
                          >
                            Edit
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
