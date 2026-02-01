import { Building, Building2, Factory, Store, Warehouse, Home, Landmark, Hospital, Users, Award, Loader2, UserX, Download, Briefcase, X, MapPin, School, GraduationCap, Baby, Backpack, BookOpen, Library, Sparkles, HelpCircle, Church, Flag, Star } from "lucide-react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useState, useMemo } from "react";
import pdfMake from "pdfmake/build/pdfmake";
import pdfFonts from "pdfmake/build/vfs_fonts";
import { useTerm } from "@/contexts/TerminologyContext";
import { useAuth } from "@/contexts/AuthContext";

pdfMake.vfs = (pdfFonts as any).pdfMake?.vfs || pdfFonts.vfs;

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
  email: string | null;
  phone: string | null;
}

interface Principal {
  contactId: string;
  displayName: string;
  email: string | null;
  phone: string | null;
}

interface MissingCardcheckWorker {
  workerId: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  bargainingUnitName: string;
  invalidReason: 'Missing' | 'BU Mismatch' | 'Termination Expired' | null;
}

interface MissingCardchecksResponse {
  employer: { id: string; name: string };
  workers: MissingCardcheckWorker[];
  totalCount: number;
}

interface SchoolTypeInfo {
  id: string;
  name: string;
  icon: string | null;
}

interface OrganizingEmployer {
  id: string;
  name: string;
  typeId: string | null;
  typeName: string | null;
  typeIcon: string | null;
  schoolTypeIds: string[];
  schoolTypes: SchoolTypeInfo[];
  regionId: string | null;
  regionName: string | null;
  gradeStart: string | null;
  gradeEnd: string | null;
  totalWorkers: number;
  signedWorkers: number;
  bargainingUnits: BargainingUnitStats[];
  stewards: Steward[];
  principals: Principal[];
}

interface EmployerType {
  id: string;
  name: string;
}

interface SchoolType {
  id: string;
  name: string;
  data?: { icon?: string };
}

interface Region {
  id: string;
  name: string;
}

interface FetchResult {
  data: MissingCardchecksResponse | null;
  error: boolean;
}

async function fetchAllMissingCardchecks(employers: OrganizingEmployer[]): Promise<Map<string, FetchResult>> {
  const results = new Map<string, FetchResult>();
  
  const responses = await Promise.all(
    employers.map(async (emp) => {
      try {
        const response = await fetch(`/api/employers/${emp.id}/missing-cardchecks`);
        if (response.ok) {
          const data: MissingCardchecksResponse = await response.json();
          return { id: emp.id, result: { data, error: false } };
        }
        return { id: emp.id, result: { data: null, error: true } };
      } catch {
        return { id: emp.id, result: { data: null, error: true } };
      }
    })
  );
  
  responses.forEach(({ id, result }) => {
    results.set(id, result);
  });
  
  return results;
}

type TermFn = (key: string, options?: { plural?: boolean; count?: number; capitalize?: boolean; lowercase?: boolean }) => string;

function generateAggregatePdf(
  employers: OrganizingEmployer[],
  missingData: Map<string, FetchResult>,
  totalStats: { totalWorkers: number; signedWorkers: number; employerCount: number },
  term: TermFn
) {
  const content: any[] = [];
  const overallPercentage = totalStats.totalWorkers > 0 
    ? Math.round((totalStats.signedWorkers / totalStats.totalWorkers) * 100) 
    : 0;
  const totalMissing = totalStats.totalWorkers - totalStats.signedWorkers;

  // Summary page
  content.push(
    { text: 'Missing Card Checks Report', style: 'title', margin: [0, 0, 0, 5] as [number, number, number, number] },
    { text: `All ${term('employer', { plural: true })} Summary`, style: 'subtitle', margin: [0, 0, 0, 30] as [number, number, number, number] },
    {
      table: {
        widths: ['*', 'auto'],
        body: [
          [{ text: `Total ${term('employer', { plural: true })}`, style: 'summaryLabel' }, { text: `${totalStats.employerCount}`, style: 'summaryValue', alignment: 'right' as const }],
          [{ text: `Total ${term('worker', { plural: true })}`, style: 'summaryLabel' }, { text: `${totalStats.totalWorkers}`, style: 'summaryValue', alignment: 'right' as const }],
          [{ text: 'Signed Card Checks', style: 'summaryLabel' }, { text: `${totalStats.signedWorkers} (${overallPercentage}%)`, style: 'summaryValue', alignment: 'right' as const }],
          [{ text: 'Missing Card Checks', style: 'summaryLabel' }, { text: `${totalMissing}`, style: 'summaryValue', alignment: 'right' as const }],
        ],
      },
      layout: 'noBorders',
      margin: [0, 0, 0, 40] as [number, number, number, number],
    },
    { text: `Generated: ${new Date().toLocaleDateString()}`, style: 'date' },
  );

  // Each employer on its own page
  employers.forEach((employer) => {
    const fetchResult = missingData.get(employer.id);
    const hasError = !fetchResult || fetchResult.error;
    const workers = fetchResult?.data?.workers || [];
    const missingCount = employer.totalWorkers - employer.signedWorkers;
    const percentage = employer.totalWorkers > 0 
      ? Math.round((employer.signedWorkers / employer.totalWorkers) * 100) 
      : 0;

    content.push({ text: '', pageBreak: 'before' });

    // School header with type
    content.push(
      { text: employer.name, style: 'employerHeader', margin: [0, 0, 0, 3] as [number, number, number, number] },
    );
    
    if (employer.typeName) {
      content.push(
        { text: employer.typeName, style: 'employerType', margin: [0, 0, 0, 8] as [number, number, number, number] }
      );
    }

    // Stats row
    content.push(
      {
        columns: [
          { text: `${term('worker', { plural: true })}: ${employer.totalWorkers}`, style: 'stat' },
          { text: `Signed: ${employer.signedWorkers} (${percentage}%)`, style: 'stat' },
          { text: `Missing: ${missingCount}`, style: 'stat' },
        ],
        margin: [0, 0, 0, 10] as [number, number, number, number],
      }
    );

    // Bargaining unit breakdown
    if (employer.bargainingUnits.length > 0) {
      content.push(
        { text: term('bargainingUnit', { plural: true }), style: 'sectionHeader', margin: [0, 0, 0, 5] as [number, number, number, number] }
      );
      employer.bargainingUnits.forEach((unit) => {
        const unitPct = unit.totalWorkers > 0 ? Math.round((unit.signedWorkers / unit.totalWorkers) * 100) : 0;
        content.push(
          { text: `${unit.name}: ${unit.signedWorkers}/${unit.totalWorkers} (${unitPct}%)`, style: 'unitInfo', margin: [10, 0, 0, 2] as [number, number, number, number] }
        );
      });
      content.push({ text: '', margin: [0, 0, 0, 8] as [number, number, number, number] });
    }

    // Stewards section
    if (employer.stewards.length > 0) {
      content.push(
        { text: term('steward', { plural: true }), style: 'sectionHeader', margin: [0, 0, 0, 5] as [number, number, number, number] }
      );
      employer.stewards.forEach((steward) => {
        const contactParts = [steward.displayName];
        if (steward.phone) contactParts.push(steward.phone);
        if (steward.email) contactParts.push(steward.email);
        content.push(
          { text: contactParts.join(' | '), style: 'contactInfo', margin: [10, 0, 0, 2] as [number, number, number, number] }
        );
      });
      content.push({ text: '', margin: [0, 0, 0, 8] as [number, number, number, number] });
    }

    // Principals section
    if (employer.principals.length > 0) {
      content.push(
        { text: 'Principals', style: 'sectionHeader', margin: [0, 0, 0, 5] as [number, number, number, number] }
      );
      employer.principals.forEach((principal) => {
        const contactParts = [principal.displayName];
        if (principal.phone) contactParts.push(principal.phone);
        if (principal.email) contactParts.push(principal.email);
        content.push(
          { text: contactParts.join(' | '), style: 'contactInfo', margin: [10, 0, 0, 2] as [number, number, number, number] }
        );
      });
      content.push({ text: '', margin: [0, 0, 0, 8] as [number, number, number, number] });
    }

    // Missing card checks section
    content.push(
      { text: 'Missing Card Checks', style: 'sectionHeader', margin: [0, 0, 0, 5] as [number, number, number, number] }
    );

    const tableBody = [
      [
        { text: 'Name', style: 'tableHeader' },
        { text: 'Reason', style: 'tableHeader' },
        { text: 'Email', style: 'tableHeader' },
        { text: 'Phone', style: 'tableHeader' },
        { text: 'Bargaining Unit', style: 'tableHeader' },
      ],
    ];

    if (hasError) {
      tableBody.push([
        { text: 'Data unavailable - failed to fetch worker list', colSpan: 5, style: 'errorMessage' } as any,
        {}, {}, {}, {}
      ]);
    } else if (workers.length > 0) {
      workers.forEach((worker) => {
        tableBody.push([
          { text: worker.displayName, style: undefined as any },
          { text: worker.invalidReason || 'Missing', style: 'reasonCell' as any },
          { text: worker.email || '-', style: undefined as any },
          { text: worker.phone || '-', style: undefined as any },
          { text: worker.bargainingUnitName, style: undefined as any },
        ]);
      });
    } else {
      tableBody.push([
        { text: 'All active workers have valid signed card checks', colSpan: 5, style: 'emptyMessage' } as any,
        {}, {}, {}, {}
      ]);
    }

    content.push({
      table: {
        headerRows: 1,
        widths: ['*', 'auto', '*', 'auto', 'auto'],
        body: tableBody,
      },
      layout: {
        fillColor: (rowIndex: number) => (rowIndex === 0 ? '#f3f4f6' : null),
        hLineWidth: () => 0.5,
        vLineWidth: () => 0.5,
        hLineColor: () => '#d1d5db',
        vLineColor: () => '#d1d5db',
      },
    });
  });

  const docDefinition = {
    pageSize: 'LETTER' as const,
    pageMargins: [40, 40, 40, 40] as [number, number, number, number],
    content,
    styles: {
      title: { fontSize: 22, bold: true },
      subtitle: { fontSize: 14, color: '#6b7280' },
      summaryLabel: { fontSize: 12, color: '#374151' },
      summaryValue: { fontSize: 12, bold: true, color: '#111827' },
      date: { fontSize: 10, color: '#6b7280' },
      employerHeader: { fontSize: 14, bold: true },
      employerType: { fontSize: 10, color: '#6b7280', italics: true },
      stat: { fontSize: 10, color: '#374151' },
      sectionHeader: { fontSize: 10, bold: true, color: '#374151' },
      unitInfo: { fontSize: 9, color: '#4b5563' },
      contactInfo: { fontSize: 9, color: '#374151' },
      tableHeader: { bold: true, fontSize: 9, color: '#374151' },
      reasonCell: { fontSize: 8, color: '#dc2626', italics: true },
      emptyMessage: { fontSize: 9, color: '#6b7280', italics: true, alignment: 'center' },
      errorMessage: { fontSize: 9, color: '#dc2626', italics: true, alignment: 'center' },
    },
    defaultStyle: { fontSize: 8 },
  };

  const fileName = `missing-cardchecks-all-schools-${new Date().toISOString().split('T')[0]}.pdf`;
  pdfMake.createPdf(docDefinition as any).download(fileName);
}

const iconMap: Record<string, typeof Building2> = {
  // Employer type icons (PascalCase)
  Building,
  Building2,
  Factory,
  Store,
  Warehouse,
  Home,
  Landmark,
  Hospital,
  // School type icons (kebab-case as stored in database)
  "graduation-cap": GraduationCap,
  "book-open": BookOpen,
  "flag": Flag,
  "landmark": Landmark,
  "star": Star,
  "users": Users,
  "home": Home,
  "school": School,
  "baby": Baby,
  "backpack": Backpack,
  "library": Library,
  "sparkles": Sparkles,
  "church": Church,
};

// Calculate allowed building reps: 1 per 25 workers per bargaining unit, rounded up
// Only count BUs that have workers; BUs with 0 workers don't contribute to allowed count
function calculateAllowedReps(bargainingUnits: OrganizingEmployer['bargainingUnits']): number {
  return bargainingUnits.reduce((total, unit) => {
    if (unit.totalWorkers === 0) return total;
    return total + Math.ceil(unit.totalWorkers / 25);
  }, 0);
}

function EmployerTypeIcon({ icon, typeName }: { icon: string | null; typeName: string | null }) {
  const IconComponent = icon ? iconMap[icon] : null;
  
  if (!IconComponent) {
    return <Building2 className="h-5 w-5 text-muted-foreground" />;
  }
  
  return <IconComponent className="h-5 w-5 text-primary" />;
}

function SchoolTypeIcon({ icon, name }: { icon: string | null; name: string }) {
  const IconComponent = icon ? iconMap[icon] : null;
  
  if (!IconComponent) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <HelpCircle className="h-4 w-4 text-muted-foreground" />
          </span>
        </TooltipTrigger>
        <TooltipContent>{name}</TooltipContent>
      </Tooltip>
    );
  }
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <IconComponent className="h-4 w-4 text-muted-foreground" />
        </span>
      </TooltipTrigger>
      <TooltipContent>{name}</TooltipContent>
    </Tooltip>
  );
}

function CardCheckProgress({ signed, total }: { signed: number; total: number }) {
  const percentage = total > 0 ? Math.round((signed / total) * 100) : 0;
  
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">Educators (with card checks)</span>
        <span className="font-medium">
          {signed}/{total} ({percentage}%)
        </span>
      </div>
      <Progress value={percentage} className="h-2" />
    </div>
  );
}

function EmployerCard({ employer, term }: { employer: OrganizingEmployer; term: TermFn }) {
  const percentage = employer.totalWorkers > 0 
    ? Math.round((employer.signedWorkers / employer.totalWorkers) * 100) 
    : 0;
  const missingCount = employer.totalWorkers - employer.signedWorkers;

  const hasSchoolTypes = employer.schoolTypes && employer.schoolTypes.length > 0;
  const hasRegion = employer.regionName;
  const hasGrades = employer.gradeStart || employer.gradeEnd;
  const gradeLabel = employer.gradeStart && employer.gradeEnd
    ? `${employer.gradeStart}-${employer.gradeEnd}`
    : employer.gradeStart || employer.gradeEnd || "";

  return (
    <Card className="hover-elevate flex flex-col h-full" data-testid={`card-employer-${employer.id}`}>
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
        
        {(hasSchoolTypes || hasRegion || hasGrades) && (
          <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground" data-testid={`info-row-${employer.id}`}>
            {hasSchoolTypes && (
              <div className="flex items-center gap-1" data-testid={`school-types-${employer.id}`}>
                {employer.schoolTypes.map((st) => (
                  <SchoolTypeIcon key={st.id} icon={st.icon} name={st.name} />
                ))}
              </div>
            )}
            {hasGrades && (
              <span data-testid={`grades-${employer.id}`}>Grades {gradeLabel}</span>
            )}
            {hasRegion && (
              <div className="flex items-center gap-1" data-testid={`region-${employer.id}`}>
                <MapPin className="h-4 w-4" />
                <span>Region {employer.regionName}</span>
              </div>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4 flex-1">
        <CardCheckProgress signed={employer.signedWorkers} total={employer.totalWorkers} />
        
        {employer.bargainingUnits.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-medium text-muted-foreground">By {term('bargainingUnit')}</div>
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

        {(() => {
          const allowedReps = calculateAllowedReps(employer.bargainingUnits);
          const currentReps = employer.stewards.length;
          
          // Don't show steward section if no workers (no allowed reps) and no stewards assigned
          if (allowedReps === 0 && currentReps === 0) return null;
          
          const hasOpportunity = currentReps < allowedReps;
          const isOverAllocated = currentReps > allowedReps;
          
          return (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
                  <Award className="h-4 w-4" />
                  <span>{term('steward', { plural: true })}</span>
                </div>
                <Badge 
                  variant={isOverAllocated ? "destructive" : hasOpportunity ? "secondary" : "default"}
                  data-testid={`badge-steward-quota-${employer.id}`}
                >
                  {currentReps}/{allowedReps}
                </Badge>
              </div>
              {employer.stewards.length > 0 && (
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
              )}
            </div>
          );
        })()}

        {employer.principals.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
              <Briefcase className="h-4 w-4" />
              <span>Principal</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {employer.principals.map((principal) => (
                <Badge 
                  key={principal.contactId}
                  variant="secondary" 
                  data-testid={`principal-${principal.contactId}`}
                >
                  {principal.displayName}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
      {missingCount > 0 && (
        <div className="px-6 pb-6">
          <Link href={`/employers/${employer.id}/missing-cardchecks`}>
            <Button 
              variant="outline" 
              size="sm" 
              className="w-full"
              data-testid={`button-missing-${employer.id}`}
            >
              <UserX className="h-4 w-4 mr-2" />
              View {missingCount} Missing Card Checks
            </Button>
          </Link>
        </div>
      )}
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
  const [employerTypeFilter, setEmployerTypeFilter] = useState<string>("");
  const [schoolTypeFilter, setSchoolTypeFilter] = useState<string>("");
  const [regionFilter, setRegionFilter] = useState<string>("");
  const [isExporting, setIsExporting] = useState(false);
  const term = useTerm();
  const { hasComponent } = useAuth();

  // This page is accessible when either sitespecific.btu OR cardcheck component is enabled
  const hasAccess = hasComponent("sitespecific.btu") || hasComponent("cardcheck");
  const hasBtuComponent = hasComponent("sitespecific.btu");

  const { data: employers = [], isLoading, error } = useQuery<OrganizingEmployer[]>({
    queryKey: ["/api/employers/organizing"],
    enabled: hasAccess,
  });

  // Fetch filter options
  const { data: employerTypes = [] } = useQuery<EmployerType[]>({
    queryKey: ["/api/options/employer-type"],
    enabled: hasAccess,
  });

  const { data: schoolTypes = [] } = useQuery<SchoolType[]>({
    queryKey: ["/api/sitespecific/btu/school-types"],
    enabled: hasBtuComponent,
  });

  const { data: regions = [] } = useQuery<Region[]>({
    queryKey: ["/api/sitespecific/btu/regions"],
    enabled: hasBtuComponent,
  });

  const filteredEmployers = useMemo(() => {
    let result = employers;
    
    // Text search
    if (search.trim()) {
      const searchLower = search.toLowerCase();
      result = result.filter((emp) => 
        emp.name.toLowerCase().includes(searchLower) ||
        emp.typeName?.toLowerCase().includes(searchLower) ||
        emp.stewards.some(s => s.displayName.toLowerCase().includes(searchLower))
      );
    }
    
    // Employer type filter
    if (employerTypeFilter) {
      result = result.filter((emp) => emp.typeId === employerTypeFilter);
    }
    
    // School type filter
    if (schoolTypeFilter) {
      result = result.filter((emp) => emp.schoolTypeIds?.includes(schoolTypeFilter));
    }
    
    // Region filter
    if (regionFilter) {
      result = result.filter((emp) => emp.regionId === regionFilter);
    }
    
    return result;
  }, [employers, search, employerTypeFilter, schoolTypeFilter, regionFilter]);

  const hasActiveFilters = employerTypeFilter || schoolTypeFilter || regionFilter;

  const clearAllFilters = () => {
    setEmployerTypeFilter("");
    setSchoolTypeFilter("");
    setRegionFilter("");
  };

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
  
  // Show access denied message if neither component is enabled
  if (!hasAccess) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-center max-w-md p-6">
          <h1 className="text-2xl font-bold mb-2">Feature Not Available</h1>
          <p className="text-muted-foreground">
            This feature requires either the BTU or cardcheck component to be enabled.
          </p>
        </div>
      </div>
    );
  }

  const handleExportAll = async () => {
    if (employers.length === 0) return;
    
    setIsExporting(true);
    try {
      const missingData = await fetchAllMissingCardchecks(employers);
      generateAggregatePdf(employers, missingData, totalStats, term);
    } catch (err) {
      console.error("Failed to generate PDF:", err);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="bg-background text-foreground min-h-screen">
      <PageHeader 
        title="Organizing Employer List" 
        icon={<Users className="text-primary-foreground" size={16} />}
        actions={
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground" data-testid="text-overall-stats">
              {totalStats.signedWorkers}/{totalStats.totalWorkers} {term('worker', { plural: true, lowercase: true })} ({overallPercentage}%) across {totalStats.employerCount} {term('employer', { plural: true, lowercase: true })}
            </span>
            {employers.length > 0 && (
              <Button 
                variant="default" 
                size="sm" 
                onClick={handleExportAll}
                disabled={isExporting}
                data-testid="button-download-all-pdf"
              >
                {isExporting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4 mr-2" />
                    Download All PDF
                  </>
                )}
              </Button>
            )}
          </div>
        }
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              placeholder={`Search ${term('employer', { plural: true, lowercase: true })}, types, or ${term('steward', { plural: true, lowercase: true })}...`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-64"
              data-testid="input-search"
            />
            
            <Select value={employerTypeFilter} onValueChange={setEmployerTypeFilter}>
              <SelectTrigger className="w-48" data-testid="select-employer-type">
                <SelectValue placeholder="Employer Type" />
              </SelectTrigger>
              <SelectContent>
                {employerTypes.map((type) => (
                  <SelectItem key={type.id} value={type.id}>
                    {type.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {hasBtuComponent && regions.length > 0 && (
              <Select value={regionFilter} onValueChange={setRegionFilter}>
                <SelectTrigger className="w-40" data-testid="select-region">
                  <SelectValue placeholder="Region" />
                </SelectTrigger>
                <SelectContent>
                  {regions.map((region) => (
                    <SelectItem key={region.id} value={region.id}>
                      {region.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAllFilters}
                className="text-muted-foreground"
                data-testid="button-clear-filters"
              >
                <X className="h-4 w-4 mr-1" />
                Clear filters
              </Button>
            )}
          </div>
          
          {hasBtuComponent && schoolTypes.length > 0 && (
            <div className="flex flex-wrap items-center gap-2" data-testid="school-type-legend">
              <span className="text-sm text-muted-foreground mr-1">School Types:</span>
              {schoolTypes.map((type) => {
                const iconName = type.data?.icon;
                const IconComponent = iconName ? iconMap[iconName] : HelpCircle;
                const isActive = schoolTypeFilter === type.id;
                return (
                  <button
                    key={type.id}
                    onClick={() => setSchoolTypeFilter(isActive ? "" : type.id)}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-sm transition-colors ${
                      isActive 
                        ? "bg-primary text-primary-foreground" 
                        : "bg-muted/50 text-muted-foreground hover:bg-muted"
                    }`}
                    data-testid={`legend-school-type-${type.id}`}
                  >
                    {IconComponent && <IconComponent className="h-4 w-4" />}
                    <span>{type.name}</span>
                  </button>
                );
              })}
            </div>
          )}
          
          {(hasActiveFilters || search) && (
            <div className="text-sm text-muted-foreground" data-testid="text-filter-results">
              Showing {filteredEmployers.length} of {employers.length} {term('employer', { plural: true, lowercase: true })}
            </div>
          )}
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
              {(search || hasActiveFilters) 
                ? `No ${term('employer', { plural: true, lowercase: true })} match your search or filters` 
                : `No ${term('employer', { plural: true, lowercase: true })} with active ${term('worker', { plural: true, lowercase: true })} found`}
            </p>
            {hasActiveFilters && (
              <Button
                variant="link"
                onClick={clearAllFilters}
                className="mt-2"
                data-testid="button-clear-filters-empty"
              >
                Clear all filters
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredEmployers.map((employer) => (
              <EmployerCard key={employer.id} employer={employer} term={term} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
