import { Users, ArrowLeft, Mail, Phone, Loader2 } from "lucide-react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useState, useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface MissingCardcheckWorker {
  workerId: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  bargainingUnitId: string | null;
  bargainingUnitName: string;
}

interface MissingCardchecksResponse {
  employer: {
    id: string;
    name: string;
  };
  workers: MissingCardcheckWorker[];
  totalCount: number;
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-64" />
      <Card>
        <CardContent className="p-0">
          <div className="space-y-2 p-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function EmployerMissingCardchecks() {
  const params = useParams<{ employerId: string }>();
  const employerId = params.employerId;
  const [search, setSearch] = useState("");

  const { data, isLoading, error } = useQuery<MissingCardchecksResponse>({
    queryKey: [`/api/employers/${employerId}/missing-cardchecks`],
    enabled: !!employerId,
  });

  const filteredWorkers = useMemo(() => {
    if (!data?.workers) return [];
    if (!search.trim()) return data.workers;
    const searchLower = search.toLowerCase();
    return data.workers.filter(
      (w) =>
        w.displayName.toLowerCase().includes(searchLower) ||
        w.email?.toLowerCase().includes(searchLower) ||
        w.phone?.includes(search) ||
        w.bargainingUnitName.toLowerCase().includes(searchLower)
    );
  }, [data?.workers, search]);

  return (
    <div className="bg-background text-foreground min-h-screen">
      <PageHeader
        title={data?.employer?.name ? `Missing Card Checks - ${data.employer.name}` : "Missing Card Checks"}
        icon={<Users className="text-primary-foreground" size={16} />}
        actions={
          <Link href="/employers/organizing">
            <Button variant="outline" size="sm" data-testid="button-back">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Organizing List
            </Button>
          </Link>
        }
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {isLoading ? (
          <LoadingSkeleton />
        ) : error ? (
          <div className="text-center py-12">
            <p className="text-destructive" data-testid="text-error">
              Failed to load missing card check list
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold" data-testid="text-count">
                  {filteredWorkers.length} Workers Missing Card Checks
                </h2>
                <p className="text-sm text-muted-foreground" data-testid="text-description">
                  Active workers at this employer who have not signed a card check
                </p>
              </div>
              <Input
                placeholder="Search by name, email, phone, or unit..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="max-w-sm"
                data-testid="input-search"
              />
            </div>

            {filteredWorkers.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground" data-testid="text-empty">
                    {search
                      ? "No workers match your search"
                      : "All active workers have signed card checks!"}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <Table data-testid="table-missing-cardchecks">
                    <TableHeader>
                      <TableRow>
                        <TableHead data-testid="header-name">Name</TableHead>
                        <TableHead data-testid="header-email">Email</TableHead>
                        <TableHead data-testid="header-phone">Phone</TableHead>
                        <TableHead data-testid="header-bargaining-unit">Bargaining Unit</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredWorkers.map((worker) => (
                        <TableRow key={worker.workerId} data-testid={`row-worker-${worker.workerId}`}>
                          <TableCell>
                            <Link href={`/workers/${worker.workerId}`}>
                              <span className="font-medium text-primary hover:underline cursor-pointer" data-testid={`link-worker-${worker.workerId}`}>
                                {worker.displayName}
                              </span>
                            </Link>
                          </TableCell>
                          <TableCell>
                            {worker.email ? (
                              <a
                                href={`mailto:${worker.email}`}
                                className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
                                data-testid={`email-${worker.workerId}`}
                              >
                                <Mail className="h-3 w-3" />
                                <span className="truncate max-w-[200px]">{worker.email}</span>
                              </a>
                            ) : (
                              <span className="text-muted-foreground" data-testid={`email-empty-${worker.workerId}`}>-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {worker.phone ? (
                              <a
                                href={`tel:${worker.phone}`}
                                className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
                                data-testid={`phone-${worker.workerId}`}
                              >
                                <Phone className="h-3 w-3" />
                                <span>{worker.phone}</span>
                              </a>
                            ) : (
                              <span className="text-muted-foreground" data-testid={`phone-empty-${worker.workerId}`}>-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" data-testid={`unit-${worker.workerId}`}>
                              {worker.bargainingUnitName}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
