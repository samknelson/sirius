import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, Building2, Phone, Mail, ExternalLink, AlertCircle } from "lucide-react";
import { Link } from "wouter";
import { formatPhoneNumberForDisplay } from "@/lib/phone-utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface WorkerRepresentativeDetails {
  id: string;
  workerId: string;
  employerId: string;
  bargainingUnitId: string;
  employer: {
    id: string;
    name: string;
  };
  bargainingUnit: {
    id: string;
    name: string;
  };
  steward: {
    id: string;
    contactId: string;
    displayName: string;
    email: string | null;
    primaryPhoneNumber: string | null;
  };
  matchesWorkerBargainingUnit: boolean;
}

function WorkerRepresentativesContent() {
  const { worker } = useWorkerLayout();

  const { data: representatives = [], isLoading } = useQuery<WorkerRepresentativeDetails[]>({
    queryKey: ["/api/workers", worker.id, "representatives"],
  });

  const groupedByEmployer = representatives.reduce((acc, rep) => {
    const employerId = rep.employer.id;
    if (!acc[employerId]) {
      acc[employerId] = {
        employer: rep.employer,
        stewards: [],
      };
    }
    acc[employerId].stewards.push(rep);
    return acc;
  }, {} as Record<string, { employer: { id: string; name: string }; stewards: WorkerRepresentativeDetails[] }>);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Representatives
          </CardTitle>
          <CardDescription>
            Shop stewards who represent you at your current employers
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (representatives.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Representatives
          </CardTitle>
          <CardDescription>
            Shop stewards who represent you at your current employers
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center mb-4">
              <Users className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground" data-testid="text-no-representatives">
              No shop stewards are currently assigned to represent you at your active employers.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Representatives
          </CardTitle>
          <CardDescription>
            Shop stewards who represent you at your current employers
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            These are the shop stewards assigned to represent workers at your current employers.
            Contact them if you need assistance with workplace issues.
          </p>
        </CardContent>
      </Card>

      {Object.values(groupedByEmployer).map(({ employer, stewards }) => (
        <Card key={employer.id}>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">{employer.name}</CardTitle>
            </div>
            <Link href={`/employers/${employer.id}`}>
              <Button variant="ghost" size="icon" data-testid={`button-view-employer-${employer.id}`}>
                <ExternalLink className="h-4 w-4" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Steward</TableHead>
                  <TableHead>Bargaining Unit</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stewards.map((rep) => (
                  <TableRow key={rep.id} data-testid={`row-representative-${rep.id}`}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Link href={`/workers/${rep.steward.id}`}>
                          <span className="font-medium hover:underline cursor-pointer" data-testid={`link-steward-${rep.steward.id}`}>
                            {rep.steward.displayName}
                          </span>
                        </Link>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge 
                          variant={rep.matchesWorkerBargainingUnit ? "default" : "secondary"}
                          data-testid={`badge-bargaining-unit-${rep.id}`}
                        >
                          {rep.bargainingUnit.name}
                        </Badge>
                        {!rep.matchesWorkerBargainingUnit && (
                          <span 
                            className="text-xs text-muted-foreground flex items-center gap-1" 
                            title="This steward represents a different bargaining unit than yours"
                            data-testid={`text-different-unit-${rep.id}`}
                          >
                            <AlertCircle className="h-3 w-3" />
                            Different unit
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {rep.steward.email ? (
                        <a 
                          href={`mailto:${rep.steward.email}`}
                          className="flex items-center gap-1 text-sm hover:underline"
                          data-testid={`link-email-${rep.id}`}
                        >
                          <Mail className="h-3 w-3" />
                          {rep.steward.email}
                        </a>
                      ) : (
                        <span className="text-muted-foreground text-sm">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {rep.steward.primaryPhoneNumber ? (
                        <a 
                          href={`tel:${rep.steward.primaryPhoneNumber}`}
                          className="flex items-center gap-1 text-sm hover:underline"
                          data-testid={`link-phone-${rep.id}`}
                        >
                          <Phone className="h-3 w-3" />
                          {formatPhoneNumberForDisplay(rep.steward.primaryPhoneNumber)}
                        </a>
                      ) : (
                        <span className="text-muted-foreground text-sm">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function WorkerRepresentatives() {
  return (
    <WorkerLayout activeTab="representatives">
      <WorkerRepresentativesContent />
    </WorkerLayout>
  );
}
