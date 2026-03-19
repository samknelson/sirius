import { useState, useMemo, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Download, Landmark, Search, Phone, Mail, Globe, User, ChevronRight, Users, Loader2, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";

interface OfficialReport {
  id: string;
  name: string;
  officeName: string;
  level: string;
  division: string | null;
  party: string | null;
  phones: string[] | null;
  emails: string[] | null;
  photoUrl: string | null;
  urls: string[] | null;
  workerCount: number;
}

interface OfficialWorker {
  workerId: string;
  workerName: string | null;
  address: string | null;
  lastLookedUpAt: string;
}

function getLevelColor(level: string): string {
  switch (level) {
    case "federal": return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
    case "state": return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200";
    case "local": return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
    default: return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200";
  }
}

function WorkersDialog({ official, open, onOpenChange }: { official: OfficialReport | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data: workers = [], isLoading } = useQuery<OfficialWorker[]>({
    queryKey: ["/api/sitespecific/btu/political/officials", official?.id, "workers"],
    enabled: open && !!official?.id,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Workers represented by {official?.name}
            <span className="block text-sm font-normal text-muted-foreground mt-1">
              {official?.officeName}
            </span>
          </DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-3 py-4">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : workers.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No workers found for this representative.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Worker Name</TableHead>
                <TableHead>Address Used</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workers.map((w) => (
                <TableRow key={w.workerId} data-testid={`row-drilldown-worker-${w.workerId}`}>
                  <TableCell>
                    <Link
                      href={`/workers/${w.workerId}`}
                      className="text-primary hover:underline font-medium"
                      data-testid={`link-worker-${w.workerId}`}
                    >
                      {w.workerName || "Unknown"}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {w.address || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface BulkProgress {
  type: string;
  total?: number;
  processed?: number;
  succeeded?: number;
  skippedNoAddress?: number;
  skippedExisting?: number;
  failed?: number;
  errors?: { workerId: string; error: string }[];
  message?: string;
}

function BulkLookupDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [skipExisting, setSkipExisting] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<BulkProgress | null>(null);
  const [finished, setFinished] = useState(false);
  const { toast } = useToast();
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

  const startBulkLookup = useCallback(async () => {
    setRunning(true);
    setFinished(false);
    setProgress({ type: "starting" });

    try {
      const response = await fetch("/api/sitespecific/btu/political/bulk-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ skipExisting }),
      });

      if (!response.ok || !response.body) {
        const errorData = await response.json().catch(() => ({ message: "Failed to start bulk lookup" }));
        throw new Error(errorData.message || "Failed to start bulk lookup");
      }

      const reader = response.body.getReader();
      readerRef.current = reader;
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6)) as BulkProgress;
              setProgress(data);
              if (data.type === "complete" || data.type === "cancelled" || data.type === "error") {
                setFinished(true);
                setRunning(false);
                queryClient.invalidateQueries({ queryKey: ["/api/sitespecific/btu/political/report"] });
              }
            } catch { /* skip malformed JSON */ }
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "Bulk lookup failed", description: msg, variant: "destructive" });
      setRunning(false);
      setFinished(true);
    }
  }, [skipExisting, toast]);

  const cancelBulkLookup = useCallback(async () => {
    try {
      await fetch("/api/sitespecific/btu/political/bulk-lookup/cancel", {
        method: "POST",
        credentials: "include",
      });
    } catch { /* best effort */ }
  }, []);

  const handleClose = useCallback(() => {
    if (running) return;
    setProgress(null);
    setFinished(false);
    onOpenChange(false);
  }, [running, onOpenChange]);

  const pct = progress?.total && progress.processed ? Math.round((progress.processed / progress.total) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Bulk Representative Lookup</DialogTitle>
          <DialogDescription>
            Look up elected representatives for all workers using their primary address on file.
          </DialogDescription>
        </DialogHeader>

        {!running && !finished && (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-3">
              <Checkbox
                id="skip-existing"
                checked={skipExisting}
                onCheckedChange={(v) => setSkipExisting(!!v)}
                data-testid="checkbox-skip-existing"
              />
              <label htmlFor="skip-existing" className="text-sm cursor-pointer">
                Skip workers who already have representatives
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              This process calls external APIs for each worker and may take several minutes depending on the number of workers.
            </p>
          </div>
        )}

        {(running || finished) && progress && (
          <div className="space-y-4 py-2">
            {progress.total != null && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>{running ? "Processing..." : "Complete"}</span>
                  <span>{progress.processed ?? 0} / {progress.total}</span>
                </div>
                <Progress value={pct} className="h-2" />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 text-sm">
              {progress.succeeded != null && (
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  <span>{progress.succeeded} looked up</span>
                </div>
              )}
              {(progress.skippedExisting ?? 0) > 0 && (
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-yellow-600" />
                  <span>{progress.skippedExisting} already had reps</span>
                </div>
              )}
              {(progress.skippedNoAddress ?? 0) > 0 && (
                <div className="flex items-center gap-2">
                  <XCircle className="w-4 h-4 text-muted-foreground" />
                  <span>{progress.skippedNoAddress} no address</span>
                </div>
              )}
              {(progress.failed ?? 0) > 0 && (
                <div className="flex items-center gap-2">
                  <XCircle className="w-4 h-4 text-red-600" />
                  <span>{progress.failed} failed</span>
                </div>
              )}
            </div>

            {progress.type === "error" && (
              <div className="text-sm text-red-600 bg-red-50 dark:bg-red-950 p-3 rounded">
                {progress.message}
              </div>
            )}

            {progress.type === "cancelled" && (
              <div className="text-sm text-yellow-700 bg-yellow-50 dark:bg-yellow-950 p-3 rounded">
                Lookup was cancelled.
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {!running && !finished && (
            <>
              <Button variant="outline" onClick={handleClose} data-testid="button-cancel-bulk-dialog">
                Cancel
              </Button>
              <Button onClick={startBulkLookup} data-testid="button-start-bulk-lookup">
                <Users className="w-4 h-4 mr-2" />
                Start Lookup
              </Button>
            </>
          )}
          {running && (
            <Button variant="destructive" onClick={cancelBulkLookup} data-testid="button-cancel-bulk-lookup">
              Stop
            </Button>
          )}
          {finished && (
            <Button onClick={handleClose} data-testid="button-close-bulk-results">
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PoliticalProfilesReport() {
  const [searchQuery, setSearchQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"name" | "office" | "workers">("workers");
  const [selectedOfficial, setSelectedOfficial] = useState<OfficialReport | null>(null);
  const [drilldownOpen, setDrilldownOpen] = useState(false);
  const [bulkLookupOpen, setBulkLookupOpen] = useState(false);

  const { data: officials = [], isLoading } = useQuery<OfficialReport[]>({
    queryKey: ["/api/sitespecific/btu/political/report"],
  });

  const filtered = useMemo(() => {
    let result = officials;

    if (levelFilter !== "all") {
      result = result.filter(o => o.level === levelFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(o =>
        o.name.toLowerCase().includes(q) ||
        o.officeName.toLowerCase().includes(q) ||
        (o.party || "").toLowerCase().includes(q) ||
        (o.division || "").toLowerCase().includes(q)
      );
    }

    result = [...result].sort((a, b) => {
      switch (sortBy) {
        case "workers": return b.workerCount - a.workerCount;
        case "name": return a.name.localeCompare(b.name);
        case "office": return a.officeName.localeCompare(b.officeName);
        default: return 0;
      }
    });

    return result;
  }, [officials, levelFilter, searchQuery, sortBy]);

  const handleExportCsv = () => {
    window.open("/api/sitespecific/btu/political/report/csv", "_blank");
  };

  const handleWorkerCountClick = (official: OfficialReport) => {
    setSelectedOfficial(official);
    setDrilldownOpen(true);
  };

  return (
    <div className="bg-background text-foreground min-h-screen">
      <PageHeader
        title="Political Profiles"
        icon={<Landmark className="text-primary-foreground" size={16} />}
        actions={
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground" data-testid="text-official-count">
              {filtered.length} Official{filtered.length !== 1 ? "s" : ""}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBulkLookupOpen(true)}
              data-testid="button-bulk-lookup"
            >
              <Users className="w-4 h-4 mr-2" />
              Bulk Lookup
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCsv}
              data-testid="button-export-csv"
            >
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
          </div>
        }
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-center gap-4 mb-6">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, office, party..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                  data-testid="input-search-officials"
                />
              </div>
              <Select value={levelFilter} onValueChange={setLevelFilter}>
                <SelectTrigger className="w-[150px]" data-testid="select-level-filter">
                  <SelectValue placeholder="All Levels" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Levels</SelectItem>
                  <SelectItem value="federal">Federal</SelectItem>
                  <SelectItem value="state">State</SelectItem>
                  <SelectItem value="local">Local</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sortBy} onValueChange={(v: string) => setSortBy(v as "name" | "office" | "workers")}>
                <SelectTrigger className="w-[180px]" data-testid="select-sort">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="workers">Most Workers</SelectItem>
                  <SelectItem value="name">Name A-Z</SelectItem>
                  <SelectItem value="office">Office A-Z</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {isLoading ? (
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground" data-testid="text-no-officials">
                <Landmark className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-lg font-medium">No political officials found</p>
                <p className="text-sm mt-1">
                  {officials.length === 0
                    ? "Look up representatives on individual worker profiles to populate this report."
                    : "Try adjusting your search or filters."}
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Official</TableHead>
                    <TableHead>Office</TableHead>
                    <TableHead>Level</TableHead>
                    <TableHead>Party</TableHead>
                    <TableHead>Division</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead className="text-right">Workers</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((official) => (
                    <TableRow key={official.id} data-testid={`row-official-${official.id}`}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          {official.photoUrl ? (
                            <img
                              src={official.photoUrl}
                              alt={official.name}
                              className="w-8 h-8 rounded-full object-cover"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                              <User className="w-4 h-4 text-muted-foreground" />
                            </div>
                          )}
                          <span className="font-medium" data-testid={`text-official-name-${official.id}`}>
                            {official.name}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell data-testid={`text-official-office-${official.id}`}>
                        {official.officeName}
                      </TableCell>
                      <TableCell>
                        <Badge className={getLevelColor(official.level)}>
                          {official.level}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {official.party || "\u2014"}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {official.division || "\u2014"}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          {official.phones && official.phones.length > 0 && (
                            <a href={`tel:${official.phones[0]}`} title={official.phones[0]}>
                              <Phone className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                            </a>
                          )}
                          {official.emails && official.emails.length > 0 && (
                            <a href={`mailto:${official.emails[0]}`} title={official.emails[0]}>
                              <Mail className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                            </a>
                          )}
                          {official.urls && official.urls.length > 0 && (
                            <a href={official.urls[0]} target="_blank" rel="noopener noreferrer" title="Website">
                              <Globe className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                            </a>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right" data-testid={`text-official-workers-${official.id}`}>
                        {official.workerCount > 0 ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="font-medium text-primary hover:underline"
                            onClick={() => handleWorkerCountClick(official)}
                            data-testid={`button-drilldown-${official.id}`}
                          >
                            {official.workerCount}
                            <ChevronRight className="w-4 h-4 ml-1" />
                          </Button>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>

      <WorkersDialog
        official={selectedOfficial}
        open={drilldownOpen}
        onOpenChange={setDrilldownOpen}
      />

      <BulkLookupDialog
        open={bulkLookupOpen}
        onOpenChange={setBulkLookupOpen}
      />
    </div>
  );
}
