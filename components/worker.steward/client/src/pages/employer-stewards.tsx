import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { EmployerLayout, useEmployerLayout } from "@/components/layouts/EmployerLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Users, AlertTriangle, ExternalLink } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useTerm } from "@/contexts/TerminologyContext";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface StewardWithDetails {
  id: string;
  workerId: string;
  employerId: string;
  bargainingUnitId: string;
  worker: {
    id: string;
    contactId: string;
  };
  bargainingUnit: {
    id: string;
    name: string;
  };
  contact: {
    id: string;
    displayName: string;
    email: string | null;
    primaryPhoneNumber: string | null;
  };
}

function EmployerStewardsContent() {
  const { employer } = useEmployerLayout();
  const { hasComponent } = useAuth();
  const term = useTerm();

  const componentEnabled = hasComponent("worker.steward");

  const { data: stewards = [], isLoading } = useQuery<StewardWithDetails[]>({
    queryKey: ["/api/employers", employer.id, "stewards"],
    enabled: componentEnabled,
  });

  if (!componentEnabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            {term("steward", { plural: true })}
          </CardTitle>
          <CardDescription>
            {term("steward", { plural: true })} assigned to this employer
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive" data-testid="alert-component-disabled">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Feature Not Enabled</AlertTitle>
            <AlertDescription>
              The {term("steward", { plural: true })} feature is not enabled. Please contact your administrator 
              to enable the &ldquo;worker.steward&rdquo; component.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            {term("steward", { plural: true })}
          </CardTitle>
          <CardDescription>
            {term("steward", { plural: true })} assigned to this employer
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          {term("steward", { plural: true })}
        </CardTitle>
        <CardDescription>
          {term("steward", { plural: true })} assigned to this employer
        </CardDescription>
      </CardHeader>
      <CardContent>
        {stewards.length === 0 ? (
          <p className="text-muted-foreground text-sm" data-testid="text-no-stewards">
            No {term("steward", { plural: true, lowercase: true })} are assigned to this employer.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Bargaining Unit</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="w-[80px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stewards.map((steward) => (
                <TableRow key={steward.id} data-testid={`row-steward-${steward.id}`}>
                  <TableCell>
                    <span className="font-medium">{steward.contact.displayName}</span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span>{steward.bargainingUnit.name}</span>
                      <Link href={`/bargaining-units/${steward.bargainingUnit.id}`}>
                        <Button variant="ghost" size="icon" className="h-6 w-6">
                          <ExternalLink className="h-3 w-3" />
                        </Button>
                      </Link>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-muted-foreground">
                      {steward.contact.email || "—"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-muted-foreground">
                      {steward.contact.primaryPhoneNumber || "—"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Link href={`/workers/${steward.workerId}/union/steward`}>
                      <Button variant="ghost" size="icon" data-testid={`button-view-worker-${steward.workerId}`}>
                        <ExternalLink className="h-4 w-4" />
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
  );
}

export default function EmployerStewards() {
  return (
    <EmployerLayout activeTab="stewards">
      <EmployerStewardsContent />
    </EmployerLayout>
  );
}
