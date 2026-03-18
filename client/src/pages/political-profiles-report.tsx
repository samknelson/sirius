import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Download, Landmark, Search, Phone, Mail, Globe, User } from "lucide-react";

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

function getLevelColor(level: string): string {
  switch (level) {
    case "federal": return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
    case "state": return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200";
    case "local": return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
    default: return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200";
  }
}

export default function PoliticalProfilesReport() {
  const [searchQuery, setSearchQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"name" | "office" | "workers">("workers");

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

  const totalWorkers = useMemo(() => {
    const unique = new Set<string>();
    return officials.reduce((sum, o) => sum + o.workerCount, 0);
  }, [officials]);

  const handleExportCsv = () => {
    window.open("/api/sitespecific/btu/political/report/csv", "_blank");
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
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
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
                        {official.party || "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {official.division || "—"}
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
                      <TableCell className="text-right font-medium" data-testid={`text-official-workers-${official.id}`}>
                        {official.workerCount}
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
