import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, ChevronRight, RefreshCw } from "lucide-react";

interface DenormStatusCounts {
  ok: number;
  stale: number;
  error: number;
  total: number;
}

interface DenormConfigSummary {
  id: string;
  pluginId: string;
  name: string | null;
  pluginName: string;
  enabled: boolean;
  counts: DenormStatusCounts;
}

interface DenormWriteDeclaration {
  storage: string;
  soleWriter: boolean;
}

interface DenormRelationship {
  pluginId: string;
  pluginName: string;
  entityType: string;
  reads: string[];
  writes: DenormWriteDeclaration[];
}

type DenormView = "status" | "relationships";

export default function DenormConfigsPage() {
  usePageTitle("Denorm");

  const [view, setView] = useState<DenormView>("status");

  return (
    <div className="space-y-6">
      <div>
        <h1
          className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2"
          data-testid="text-page-title"
        >
          <RefreshCw className="h-6 w-6" />
          Denorm
        </h1>
        <p className="text-muted-foreground mt-2" data-testid="text-page-description">
          {view === "status"
            ? "Each denorm plugin keeps a slice of data in sync. These numbers show how many records are up to date (ok), need recomputing (stale), or failed (error)."
            : "What each denorm plugin reads from and writes to, at storage-object granularity. A sole-writer target is owned outright by its plugin; a shared target is written by several cooperating writers."}
        </p>
      </div>

      <div
        className="inline-flex items-center rounded-md border bg-muted p-1"
        role="tablist"
        data-testid="segmented-denorm-view"
      >
        <button
          type="button"
          role="tab"
          aria-selected={view === "status"}
          onClick={() => setView("status")}
          className={`px-3 py-1.5 text-sm font-medium rounded-sm transition-colors ${
            view === "status"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
          data-testid="button-view-status"
        >
          Status
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "relationships"}
          onClick={() => setView("relationships")}
          className={`px-3 py-1.5 text-sm font-medium rounded-sm transition-colors ${
            view === "relationships"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
          data-testid="button-view-relationships"
        >
          Relationships
        </button>
      </div>

      {view === "status" ? <StatusView /> : <RelationshipsView />}
    </div>
  );
}

function StatusView() {
  const { data: configs = [], isLoading } = useQuery<DenormConfigSummary[]>({
    queryKey: ["/api/denorm/configs"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" data-testid="loading-spinner" />
      </div>
    );
  }

  if (configs.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p
            className="text-center text-muted-foreground"
            data-testid="text-empty-configs"
          >
            No denorm plugins are configured yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="rounded-md border">
      <Table data-testid="table-denorm-configs">
        <TableHeader>
          <TableRow>
            <TableHead>Plugin</TableHead>
            <TableHead>Enabled?</TableHead>
            <TableHead className="text-right">OK</TableHead>
            <TableHead className="text-right">Stale</TableHead>
            <TableHead className="text-right">Error</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {configs.map((config) => (
            <TableRow key={config.id} data-testid={`row-denorm-${config.id}`}>
              <TableCell>
                <Link href={`/admin/denorm/${config.id}`}>
                  <span
                    className="font-medium hover:text-primary cursor-pointer"
                    data-testid={`link-denorm-${config.id}`}
                  >
                    {config.name || config.pluginName}
                  </span>
                </Link>
              </TableCell>
              <TableCell>
                <Badge variant={config.enabled ? "default" : "secondary"}>
                  {config.enabled ? "Enabled" : "Disabled"}
                </Badge>
              </TableCell>
              <TableCell
                className="text-right tabular-nums"
                data-testid={`text-ok-${config.id}`}
              >
                {config.counts.ok}
              </TableCell>
              <TableCell
                className="text-right tabular-nums"
                data-testid={`text-stale-${config.id}`}
              >
                {config.counts.stale}
              </TableCell>
              <TableCell
                className="text-right tabular-nums"
                data-testid={`text-error-${config.id}`}
              >
                {config.counts.error}
              </TableCell>
              <TableCell
                className="text-right tabular-nums font-medium"
                data-testid={`text-total-${config.id}`}
              >
                {config.counts.total}
              </TableCell>
              <TableCell className="text-right">
                <Link href={`/admin/denorm/${config.id}`}>
                  <Button
                    variant="ghost"
                    size="icon"
                    data-testid={`button-view-${config.id}`}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function RelationshipsView() {
  const { data: relationships = [], isLoading } = useQuery<DenormRelationship[]>({
    queryKey: ["/api/denorm/relationships"],
  });

  // Cross-reference: for each storage namespace, who reads it and who writes it.
  const byStorage = useMemo(() => {
    const map = new Map<
      string,
      { readers: string[]; writers: { pluginName: string; soleWriter: boolean }[] }
    >();
    for (const rel of relationships) {
      for (const r of rel.reads) {
        const entry = map.get(r) ?? { readers: [], writers: [] };
        entry.readers.push(rel.pluginName);
        map.set(r, entry);
      }
      for (const w of rel.writes) {
        const entry = map.get(w.storage) ?? { readers: [], writers: [] };
        entry.writers.push({ pluginName: rel.pluginName, soleWriter: w.soleWriter });
        map.set(w.storage, entry);
      }
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [relationships]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" data-testid="loading-spinner" />
      </div>
    );
  }

  if (relationships.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p
            className="text-center text-muted-foreground"
            data-testid="text-empty-relationships"
          >
            No denorm plugins are registered.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h2 className="text-lg font-semibold" data-testid="text-heading-per-plugin">
          By plugin
        </h2>
        <div className="rounded-md border">
          <Table data-testid="table-denorm-relationships">
            <TableHeader>
              <TableRow>
                <TableHead>Plugin</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Reads</TableHead>
                <TableHead>Writes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {relationships.map((rel) => (
                <TableRow key={rel.pluginId} data-testid={`row-rel-${rel.pluginId}`}>
                  <TableCell
                    className="font-medium"
                    data-testid={`text-rel-plugin-${rel.pluginId}`}
                  >
                    {rel.pluginName}
                    <div className="text-xs text-muted-foreground font-normal">
                      {rel.pluginId}
                    </div>
                  </TableCell>
                  <TableCell data-testid={`text-rel-entity-${rel.pluginId}`}>
                    <Badge variant="outline">{rel.entityType}</Badge>
                  </TableCell>
                  <TableCell data-testid={`text-rel-reads-${rel.pluginId}`}>
                    <div className="flex flex-wrap gap-1">
                      {rel.reads.map((r) => (
                        <Badge key={r} variant="secondary" className="font-mono text-xs">
                          {r}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell data-testid={`text-rel-writes-${rel.pluginId}`}>
                    <div className="flex flex-wrap gap-1">
                      {rel.writes.map((w) => (
                        <Badge
                          key={w.storage}
                          variant={w.soleWriter ? "default" : "outline"}
                          className="font-mono text-xs"
                          title={
                            w.soleWriter
                              ? "Sole writer: this plugin owns this storage outright"
                              : "Shared target: several writers converge on this storage"
                          }
                        >
                          {w.storage}
                          {w.soleWriter ? "" : " (shared)"}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">
          A solid badge marks a sole-writer target (owned outright by that
          plugin). A &quot;(shared)&quot; badge marks a target several writers
          converge on — each write diff-checks first so re-running is always
          safe.
        </p>
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold" data-testid="text-heading-per-storage">
          By storage
        </h2>
        <div className="rounded-md border">
          <Table data-testid="table-denorm-by-storage">
            <TableHeader>
              <TableRow>
                <TableHead>Storage</TableHead>
                <TableHead>Read by</TableHead>
                <TableHead>Written by</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byStorage.map(([storageName, entry]) => (
                <TableRow key={storageName} data-testid={`row-storage-${storageName}`}>
                  <TableCell
                    className="font-mono text-xs font-medium"
                    data-testid={`text-storage-name-${storageName}`}
                  >
                    {storageName}
                  </TableCell>
                  <TableCell data-testid={`text-storage-readers-${storageName}`}>
                    {entry.readers.length > 0 ? (
                      <span className="text-sm">{entry.readers.join(", ")}</span>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell data-testid={`text-storage-writers-${storageName}`}>
                    {entry.writers.length > 0 ? (
                      <span className="text-sm">
                        {entry.writers
                          .map(
                            (w) =>
                              `${w.pluginName}${w.soleWriter ? " (sole writer)" : ""}`,
                          )
                          .join(", ")}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
