import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Phone, Mail, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { DashboardPluginProps } from "../types";
import { Skeleton } from "@/components/ui/skeleton";

interface MyStewardData {
  stewards: Array<{
    id: string;
    workerId: string;
    displayName: string;
    email: string | null;
    phone: string | null;
  }>;
  worker: { id: string } | null;
  employer: { id: string; name: string } | null;
  bargainingUnit: { id: string; name: string } | null;
}

export function MyStewardPlugin({ enabledComponents }: DashboardPluginProps) {
  const hasAccess = enabledComponents?.includes("worker.steward");

  const { data, isLoading, error } = useQuery<MyStewardData>({
    queryKey: ["/api/dashboard-plugins/my-steward"],
    enabled: hasAccess,
  });

  if (!hasAccess) {
    return null;
  }

  if (isLoading) {
    return (
      <Card data-testid="plugin-my-steward">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            My Steward
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return null;
  }

  if (!data.worker) {
    return (
      <Card data-testid="plugin-my-steward">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            My Steward
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No linked worker record found for your account.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (data.stewards.length === 0) {
    const emptyMessage = data.employer && data.bargainingUnit
      ? `No steward is assigned to ${data.bargainingUnit.name} at ${data.employer.name}.`
      : "No steward is currently assigned for your employer and bargaining unit.";
    
    return (
      <Card data-testid="plugin-my-steward">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            My Steward
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground" data-testid="text-no-steward">
            {emptyMessage}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="plugin-my-steward">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          My Steward{data.stewards.length > 1 ? "s" : ""}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {data.employer && data.bargainingUnit && (
            <p className="text-sm text-muted-foreground">
              {data.employer.name} - {data.bargainingUnit.name}
            </p>
          )}
          {data.stewards.map((steward) => (
            <div
              key={steward.id}
              className="p-3 rounded-md bg-muted/50"
              data-testid={`steward-card-${steward.id}`}
            >
              <div className="font-medium" data-testid={`steward-name-${steward.id}`}>
                {steward.displayName}
              </div>
              <div className="mt-2 space-y-1">
                {steward.email && (
                  <a
                    href={`mailto:${steward.email}`}
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                    data-testid={`steward-email-${steward.id}`}
                  >
                    <Mail className="h-3 w-3" />
                    {steward.email}
                  </a>
                )}
                {steward.phone && (
                  <a
                    href={`tel:${steward.phone}`}
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                    data-testid={`steward-phone-${steward.id}`}
                  >
                    <Phone className="h-3 w-3" />
                    {steward.phone}
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
