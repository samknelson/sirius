import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface CaseRow {
  id: string;
  entityType: string;
  entityId: string;
  entityName: string | null;
  assigneeName: string;
  statusName: string;
  statusClosed: boolean;
  createdAt: string;
  deadlineYmd: string;
  resolutionName: string | null;
  resolutionYmd: string | null;
}

export default function CaseListPanel({
  entityType,
  entityId,
}: {
  entityType?: "worker" | "employer" | "trust_provider";
  entityId?: string;
}) {
  const entityScoped = Boolean(entityType && entityId);
  const [view, setView] = useState<"active" | "historical">("active");
  const [scope, setScope] = useState<"my" | "all">("my");
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({
    view,
    scope: entityScoped ? "all" : scope,
    page: String(page),
    pageSize: "25",
    sort: "deadline",
    direction: "asc",
  });
  if (entityType && entityId) {
    params.set("entityType", entityType);
    params.set("entityId", entityId);
  }
  const { data, isLoading } = useQuery<{ items: CaseRow[]; total: number }>({
    queryKey: ["/api/sitespecific/bao/cases", params.toString()],
    queryFn: async () => {
      const response = await fetch(`/api/sitespecific/bao/cases?${params}`);
      if (!response.ok) throw new Error("Failed to load cases");
      return response.json();
    },
  });
  const items = data?.items ?? [];
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>Cases</CardTitle>
        <div className="flex gap-2">
          {!entityScoped && (
            <Select value={scope} onValueChange={(v: "my" | "all") => { setScope(v); setPage(1); }}>
              <SelectTrigger className="w-32" data-testid="select-case-scope"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="my">My Cases</SelectItem><SelectItem value="all">All Cases</SelectItem></SelectContent>
            </Select>
          )}
          <Select value={view} onValueChange={(v: "active" | "historical") => { setView(v); setPage(1); }}>
            <SelectTrigger className="w-36" data-testid="select-case-view"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="historical">Historical</SelectItem></SelectContent>
          </Select>
          <Link href={`/bao/cases/new${entityScoped ? `?entityType=${entityType}&entityId=${entityId}` : ""}`}>
            <Button data-testid="button-add-bao-case">New Case</Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? <p>Loading…</p> : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No {view} cases.</p>
        ) : (
          <div className="divide-y">
            {items.map((item) => (
              <Link key={item.id} href={`/bao/cases/${item.id}`}>
                <div className="grid cursor-pointer gap-2 py-3 hover:bg-muted/50 md:grid-cols-6" data-testid={`row-bao-case-${item.id}`}>
                  {!entityScoped && <span className="font-medium">{item.entityName ?? item.entityId}</span>}
                  <Badge variant={item.statusClosed ? "outline" : "secondary"}>{item.statusName}</Badge>
                  <span>{item.assigneeName}</span>
                  <span>Created {item.createdAt.slice(0, 10)}</span>
                  <span>Due {item.deadlineYmd}</span>
                  {item.statusClosed && <span>{item.resolutionName} · {item.resolutionYmd}</span>}
                </div>
              </Link>
            ))}
          </div>
        )}
        {(data?.total ?? 0) > 25 && (
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button variant="outline" disabled={page * 25 >= (data?.total ?? 0)} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}