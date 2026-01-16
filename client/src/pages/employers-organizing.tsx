import { Building2, Users, Award, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useState, useMemo } from "react";

interface BargainingUnitStats {
  id: string;
  name: string;
  totalWorkers: number;
  signedWorkers: number;
}

interface Steward {
  workerId: string;
  displayName: string;
  bargainingUnitId: string;
  bargainingUnitName: string;
}

interface OrganizingEmployer {
  id: string;
  name: string;
  typeId: string | null;
  typeName: string | null;
  typeIcon: string | null;
  totalWorkers: number;
  signedWorkers: number;
  bargainingUnits: BargainingUnitStats[];
  stewards: Steward[];
}

function EmployerTypeIcon({ icon, typeName }: { icon: string | null; typeName: string | null }) {
  if (!icon) {
    return <Building2 className="h-5 w-5 text-muted-foreground" />;
  }
  return (
    <span className="text-lg" title={typeName || undefined}>
      {icon}
    </span>
  );
}

function CardCheckProgress({ signed, total }: { signed: number; total: number }) {
  const percentage = total > 0 ? Math.round((signed / total) * 100) : 0;
  
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">Card Checks</span>
        <span className="font-medium">
          {signed}/{total} ({percentage}%)
        </span>
      </div>
      <Progress value={percentage} className="h-2" />
    </div>
  );
}

function EmployerCard({ employer }: { employer: OrganizingEmployer }) {
  const percentage = employer.totalWorkers > 0 
    ? Math.round((employer.signedWorkers / employer.totalWorkers) * 100) 
    : 0;

  return (
    <Card className="hover-elevate" data-testid={`card-employer-${employer.id}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <EmployerTypeIcon icon={employer.typeIcon} typeName={employer.typeName} />
            <Link href={`/employers/${employer.id}`}>
              <CardTitle className="text-base font-medium truncate underline-offset-2 hover:underline" data-testid={`link-employer-${employer.id}`}>
                {employer.name}
              </CardTitle>
            </Link>
          </div>
          <Badge 
            variant={percentage >= 50 ? "default" : "secondary"}
            className="shrink-0"
            data-testid={`badge-percentage-${employer.id}`}
          >
            {percentage}%
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <CardCheckProgress signed={employer.signedWorkers} total={employer.totalWorkers} />
        
        {employer.bargainingUnits.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-medium text-muted-foreground">By Bargaining Unit</div>
            <div className="space-y-2">
              {employer.bargainingUnits.map((unit) => {
                const unitPercentage = unit.totalWorkers > 0 
                  ? Math.round((unit.signedWorkers / unit.totalWorkers) * 100) 
                  : 0;
                return (
                  <div key={unit.id} className="flex items-center justify-between text-sm" data-testid={`unit-${employer.id}-${unit.id}`}>
                    <span className="truncate text-muted-foreground">{unit.name}</span>
                    <span className="font-medium shrink-0 ml-2">
                      {unit.signedWorkers}/{unit.totalWorkers} ({unitPercentage}%)
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {employer.stewards.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
              <Award className="h-4 w-4" />
              <span>Stewards</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {employer.stewards.map((steward) => (
                <Link key={steward.workerId} href={`/workers/${steward.workerId}`}>
                  <Badge 
                    variant="outline" 
                    className="cursor-pointer"
                    data-testid={`steward-${steward.workerId}`}
                  >
                    {steward.displayName}
                  </Badge>
                </Link>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <Card key={i}>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-5 rounded" />
              <Skeleton className="h-5 w-40" />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-2 w-full" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function EmployersOrganizing() {
  const [search, setSearch] = useState("");

  const { data: employers = [], isLoading, error } = useQuery<OrganizingEmployer[]>({
    queryKey: ["/api/employers/organizing"],
  });

  const filteredEmployers = useMemo(() => {
    if (!search.trim()) return employers;
    const searchLower = search.toLowerCase();
    return employers.filter((emp) => 
      emp.name.toLowerCase().includes(searchLower) ||
      emp.typeName?.toLowerCase().includes(searchLower) ||
      emp.stewards.some(s => s.displayName.toLowerCase().includes(searchLower))
    );
  }, [employers, search]);

  const totalStats = useMemo(() => {
    return employers.reduce(
      (acc, emp) => ({
        totalWorkers: acc.totalWorkers + emp.totalWorkers,
        signedWorkers: acc.signedWorkers + emp.signedWorkers,
        employerCount: acc.employerCount + 1,
      }),
      { totalWorkers: 0, signedWorkers: 0, employerCount: 0 }
    );
  }, [employers]);

  const overallPercentage = totalStats.totalWorkers > 0 
    ? Math.round((totalStats.signedWorkers / totalStats.totalWorkers) * 100) 
    : 0;

  return (
    <div className="bg-background text-foreground min-h-screen">
      <PageHeader 
        title="Organizing Employer List" 
        icon={<Users className="text-primary-foreground" size={16} />}
        actions={
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground" data-testid="text-overall-stats">
              {totalStats.signedWorkers}/{totalStats.totalWorkers} workers ({overallPercentage}%) across {totalStats.employerCount} employers
            </span>
          </div>
        }
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <Input
            placeholder="Search employers, types, or stewards..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-md"
            data-testid="input-search"
          />
        </div>

        {isLoading ? (
          <LoadingSkeleton />
        ) : error ? (
          <div className="text-center py-12">
            <p className="text-destructive" data-testid="text-error">
              Failed to load organizing employer list
            </p>
          </div>
        ) : filteredEmployers.length === 0 ? (
          <div className="text-center py-12">
            <Building2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground" data-testid="text-empty">
              {search ? "No employers match your search" : "No employers with active workers found"}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredEmployers.map((employer) => (
              <EmployerCard key={employer.id} employer={employer} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
