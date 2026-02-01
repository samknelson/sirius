import { Building, Building2, Factory, Store, Warehouse, Home, Landmark, Hospital, Users, Award, Loader2, UserX, Download, Briefcase } from "lucide-react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useState, useMemo } from "react";
import pdfMake from "pdfmake/build/pdfmake";
import pdfFonts from "pdfmake/build/vfs_fonts";

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
}

interface MissingCardchecksResponse {
  employer: { id: string; name: string };
  workers: MissingCardcheckWorker[];
  totalCount: number;
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
  principals: Principal[];
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

function generateAggregatePdf(
  employers: OrganizingEmployer[],
  missingData: Map<string, FetchResult>,
  totalStats: { totalWorkers: number; signedWorkers: number; employerCount: number }
) {
  const content: any[] = [];
  const overallPercentage = totalStats.totalWorkers > 0 
    ? Math.round((totalStats.signedWorkers / totalStats.totalWorkers) * 100) 
    : 0;
  const totalMissing = totalStats.totalWorkers - totalStats.signedWorkers;

  // Summary page
  content.push(
    { text: 'Missing Card Checks Report', style: 'title', margin: [0, 0, 0, 5] as [number, number, number, number] },
    { text: 'All Schools Summary', style: 'subtitle', margin: [0, 0, 0, 30] as [number, number, number, number] },
    {
      table: {
        widths: ['*', 'auto'],
        body: [
          [{ text: 'Total Schools', style: 'summaryLabel' }, { text: `${totalStats.employerCount}`, style: 'summaryValue', alignment: 'right' as const }],
          [{ text: 'Total Workers', style: 'summaryLabel' }, { text: `${totalStats.totalWorkers}`, style: 'summaryValue', alignment: 'right' as const }],
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
          { text: `Workers: ${employer.totalWorkers}`, style: 'stat' },
          { text: `Signed: ${employer.signedWorkers} (${percentage}%)`, style: 'stat' },
          { text: `Missing: ${missingCount}`, style: 'stat' },
        ],
        margin: [0, 0, 0, 10] as [number, number, number, number],
      }
    );

    // Bargaining unit breakdown
    if (employer.bargainingUnits.length > 0) {
      content.push(
        { text: 'Bargaining Units', style: 'sectionHeader', margin: [0, 0, 0, 5] as [number, number, number, number] }
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
        { text: 'Stewards', style: 'sectionHeader', margin: [0, 0, 0, 5] as [number, number, number, number] }
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
        { text: 'Email', style: 'tableHeader' },
        { text: 'Phone', style: 'tableHeader' },
        { text: 'Bargaining Unit', style: 'tableHeader' },
      ],
    ];

    if (hasError) {
      tableBody.push([
        { text: 'Data unavailable - failed to fetch worker list', colSpan: 4, style: 'errorMessage' } as any,
        {}, {}, {}
      ]);
    } else if (workers.length > 0) {
      workers.forEach((worker) => {
        tableBody.push([
          { text: worker.displayName, style: undefined as any },
          { text: worker.email || '-', style: undefined as any },
          { text: worker.phone || '-', style: undefined as any },
          { text: worker.bargainingUnitName, style: undefined as any },
        ]);
      });
    } else {
      tableBody.push([
        { text: 'All active workers have signed card checks', colSpan: 4, style: 'emptyMessage' } as any,
        {}, {}, {}
      ]);
    }

    content.push({
      table: {
        headerRows: 1,
        widths: ['*', '*', 'auto', 'auto'],
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
      emptyMessage: { fontSize: 9, color: '#6b7280', italics: true, alignment: 'center' },
      errorMessage: { fontSize: 9, color: '#dc2626', italics: true, alignment: 'center' },
    },
    defaultStyle: { fontSize: 8 },
  };

  const fileName = `missing-cardchecks-all-schools-${new Date().toISOString().split('T')[0]}.pdf`;
  pdfMake.createPdf(docDefinition as any).download(fileName);
}

const iconMap: Record<string, typeof Building2> = {
  Building,
  Building2,
  Factory,
  Store,
  Warehouse,
  Home,
  Landmark,
  Hospital,
};

function EmployerTypeIcon({ icon, typeName }: { icon: string | null; typeName: string | null }) {
  const IconComponent = icon ? iconMap[icon] : null;
  
  if (!IconComponent) {
    return <Building2 className="h-5 w-5 text-muted-foreground" />;
  }
  
  return <IconComponent className="h-5 w-5 text-primary" />;
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
  const missingCount = employer.totalWorkers - employer.signedWorkers;

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
      </CardHeader>
      <CardContent className="space-y-4 flex-1">
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
  const [isExporting, setIsExporting] = useState(false);

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

  const handleExportAll = async () => {
    if (employers.length === 0) return;
    
    setIsExporting(true);
    try {
      const missingData = await fetchAllMissingCardchecks(employers);
      generateAggregatePdf(employers, missingData, totalStats);
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
              {totalStats.signedWorkers}/{totalStats.totalWorkers} workers ({overallPercentage}%) across {totalStats.employerCount} employers
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
