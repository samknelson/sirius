import { Building, Building2, Factory, Store, Warehouse, Home, Landmark, Hospital, Users, Award, Loader2, UserX, Download, Briefcase, X, MapPin, School, GraduationCap, Baby, Backpack, BookOpen, Library, Sparkles, HelpCircle, Church, Flag, Star, Settings, Plus, Trash2, Clock } from "lucide-react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useState, useMemo, useEffect } from "react";
import pdfMake from "pdfmake/build/pdfmake";
import pdfFonts from "pdfmake/build/vfs_fonts";
import { useTerm } from "@/contexts/TerminologyContext";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

pdfMake.vfs = (pdfFonts as any).pdfMake?.vfs || pdfFonts.vfs;

interface BargainingUnitStats {
  id: string;
  name: string;
  totalWorkers: number;
  signedWorkers: number;
  duesRate: number | null;
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

interface StatusGroup {
  id: string;
  name: string;
  statusIds: string[];
  isPrimary: boolean;
}

interface EmploymentStatusOption {
  id: string;
  name: string;
  code: string;
  employed: boolean;
}

interface SecondaryGroupWorker {
  workerId: string;
  employerId: string;
  employerName: string;
  displayName: string;
  statusName: string;
  statusDate: string | null;
}

interface SecondaryGroupData {
  id: string;
  name: string;
  workers: SecondaryGroupWorker[];
}

interface NewMember {
  workerId: string;
  displayName: string;
  signedDate: string;
  bargainingUnitName: string;
  bargainingUnitId: string;
  employerName: string;
  employerId: string | null;
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
  term: TermFn,
  secondaryGroups: SecondaryGroupData[] = [],
  newMembers: NewMember[] = [],
  newMemberDays: number = 30
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

  for (const group of secondaryGroups) {
    if (group.workers.length === 0) continue;
    
    content.push({ text: '', pageBreak: 'before' });
    content.push(
      { text: group.name, style: 'title', margin: [0, 0, 0, 5] as [number, number, number, number] },
      { text: `${group.workers.length} ${term('worker', { plural: group.workers.length !== 1, lowercase: true })}`, style: 'subtitle', margin: [0, 0, 0, 15] as [number, number, number, number] },
    );

    const groupTableBody: any[] = [
      [
        { text: 'Name', style: 'tableHeader' },
        { text: term('employer'), style: 'tableHeader' },
        { text: 'Status', style: 'tableHeader' },
        { text: 'Since', style: 'tableHeader' },
      ],
    ];

    for (const worker of group.workers) {
      groupTableBody.push([
        { text: worker.displayName },
        { text: worker.employerName },
        { text: worker.statusName },
        { text: worker.statusDate ? new Date(worker.statusDate).toLocaleDateString() : '-' },
      ]);
    }

    content.push({
      table: {
        headerRows: 1,
        widths: ['*', '*', 'auto', 'auto'],
        body: groupTableBody,
      },
      layout: {
        fillColor: (rowIndex: number) => (rowIndex === 0 ? '#f3f4f6' : null),
        hLineWidth: () => 0.5,
        vLineWidth: () => 0.5,
        hLineColor: () => '#d1d5db',
        vLineColor: () => '#d1d5db',
      },
    });
  }

  if (newMembers.length > 0) {
    content.push({ text: '', pageBreak: 'before' });
    content.push(
      { text: 'New Members', style: 'title', margin: [0, 0, 0, 5] as [number, number, number, number] },
      { text: `${newMembers.length} new ${term('worker', { plural: newMembers.length !== 1, lowercase: true })} in last ${newMemberDays} days`, style: 'subtitle', margin: [0, 0, 0, 5] as [number, number, number, number] },
      { text: 'These members need to be voted into the union at a membership meeting.', style: 'date', margin: [0, 0, 0, 15] as [number, number, number, number] },
    );

    const newMemberTableBody: any[] = [
      [
        { text: 'Name', style: 'tableHeader' },
        { text: term('employer'), style: 'tableHeader' },
        { text: term('bargainingUnit'), style: 'tableHeader' },
        { text: 'Signed Date', style: 'tableHeader' },
      ],
    ];

    for (const member of newMembers) {
      newMemberTableBody.push([
        { text: member.displayName },
        { text: member.employerName },
        { text: member.bargainingUnitName },
        { text: new Date(member.signedDate).toLocaleDateString() },
      ]);
    }

    content.push({
      table: {
        headerRows: 1,
        widths: ['*', '*', 'auto', 'auto'],
        body: newMemberTableBody,
      },
      layout: {
        fillColor: (rowIndex: number) => (rowIndex === 0 ? '#f3f4f6' : null),
        hLineWidth: () => 0.5,
        vLineWidth: () => 0.5,
        hLineColor: () => '#d1d5db',
        vLineColor: () => '#d1d5db',
      },
    });
  }

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
                const missingWorkers = unit.totalWorkers - unit.signedWorkers;
                const missingRevenue = unit.duesRate && missingWorkers > 0 ? missingWorkers * unit.duesRate : null;
                return (
                  <div key={unit.id} data-testid={`unit-${employer.id}-${unit.id}`}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="truncate text-muted-foreground">{unit.name}</span>
                      <span className="font-medium shrink-0 ml-2">
                        {unit.signedWorkers}/{unit.totalWorkers} ({unitPercentage}%)
                      </span>
                    </div>
                    {missingRevenue !== null && (
                      <div className="flex items-center justify-end text-xs text-muted-foreground mt-0.5" data-testid={`text-missing-revenue-${employer.id}-${unit.id}`}>
                        <span>${missingRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} potential missing dues</span>
                      </div>
                    )}
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

function StatusGroupsDialog({ isAdmin }: { isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<StatusGroup[]>([]);
  const [newMemberDays, setNewMemberDays] = useState<number>(30);
  const { toast } = useToast();

  const { data: statuses = [] } = useQuery<EmploymentStatusOption[]>({
    queryKey: ["/api/options/employment-status"],
    enabled: open,
  });

  const { data: savedGroups = [] } = useQuery<StatusGroup[]>({
    queryKey: ["/api/organizing/status-groups"],
    enabled: open,
  });

  const { data: savedDays } = useQuery<{ days: number }>({
    queryKey: ["/api/organizing/new-member-days"],
    enabled: open,
  });

  const saveMutation = useMutation({
    mutationFn: async ({ groups: newGroups, days }: { groups: StatusGroup[]; days: number }) => {
      await Promise.all([
        apiRequest("PUT", "/api/organizing/status-groups", { groups: newGroups }),
        apiRequest("PUT", "/api/organizing/new-member-days", { days }),
      ]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organizing/status-groups"] });
      queryClient.invalidateQueries({ queryKey: ["/api/organizing/new-member-days"] });
      queryClient.invalidateQueries({ queryKey: ["/api/employers/organizing"] });
      toast({ title: "Settings saved" });
      setOpen(false);
    },
    onError: () => {
      toast({ title: "Failed to save settings", variant: "destructive" });
    },
  });

  useEffect(() => {
    if (open && savedDays?.days !== undefined) {
      setNewMemberDays(savedDays.days);
    }
  }, [open, savedDays]);

  const handleOpen = (isOpen: boolean) => {
    if (isOpen) {
      setGroups(savedGroups.length > 0 ? JSON.parse(JSON.stringify(savedGroups)) : []);
      setNewMemberDays(savedDays?.days ?? 30);
    }
    setOpen(isOpen);
  };

  const addGroup = () => {
    setGroups([...groups, {
      id: crypto.randomUUID(),
      name: "",
      statusIds: [],
      isPrimary: groups.length === 0,
    }]);
  };

  const removeGroup = (id: string) => {
    const updated = groups.filter(g => g.id !== id);
    if (updated.length > 0 && !updated.some(g => g.isPrimary)) {
      updated[0].isPrimary = true;
    }
    setGroups(updated);
  };

  const updateGroupName = (id: string, name: string) => {
    setGroups(groups.map(g => g.id === id ? { ...g, name } : g));
  };

  const togglePrimary = (id: string) => {
    setGroups(groups.map(g => ({ ...g, isPrimary: g.id === id })));
  };

  const toggleStatus = (groupId: string, statusId: string) => {
    setGroups(groups.map(g => {
      if (g.id !== groupId) return g;
      const has = g.statusIds.includes(statusId);
      return {
        ...g,
        statusIds: has
          ? g.statusIds.filter(s => s !== statusId)
          : [...g.statusIds, statusId],
      };
    }));
  };

  const assignedStatusIds = new Set(groups.flatMap(g => g.statusIds));

  if (!isAdmin) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid="button-status-groups-config">
          <Settings className="h-4 w-4 mr-2" />
          Status Groups
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto" aria-describedby="organizing-settings-desc">
        <DialogHeader>
          <DialogTitle>Organizing List Settings</DialogTitle>
        </DialogHeader>
        <p id="organizing-settings-desc" className="text-sm text-muted-foreground mb-4">
          Configure status groups and new member tracking for the organizing employer list.
        </p>

        <div className="mb-6">
          <Label className="text-sm font-medium mb-2 block">New Member Window (days)</Label>
          <p className="text-xs text-muted-foreground mb-2">
            Workers whose first signed card check falls within this many days are shown as new members.
          </p>
          <Input
            type="number"
            min={1}
            max={365}
            value={newMemberDays}
            onChange={(e) => setNewMemberDays(Math.max(1, Math.min(365, parseInt(e.target.value) || 30)))}
            className="w-32"
            data-testid="input-new-member-days"
          />
        </div>

        <Label className="text-sm font-medium mb-2 block">Employment Status Groups</Label>
        <p className="text-xs text-muted-foreground mb-4">
          Configure which employment statuses appear on the main employer cards (primary group)
          and which statuses get their own summary sections.
        </p>

        <div className="space-y-6">
          {groups.map((group) => (
            <Card key={group.id} data-testid={`card-status-group-${group.id}`}>
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Group name (e.g., Active Workers, On Leave)"
                    value={group.name}
                    onChange={(e) => updateGroupName(group.id, e.target.value)}
                    className="flex-1"
                    data-testid={`input-group-name-${group.id}`}
                  />
                  <div className="flex items-center gap-2 shrink-0">
                    <Checkbox
                      id={`primary-${group.id}`}
                      checked={group.isPrimary}
                      onCheckedChange={() => togglePrimary(group.id)}
                      data-testid={`checkbox-primary-${group.id}`}
                    />
                    <Label htmlFor={`primary-${group.id}`} className="text-sm whitespace-nowrap">
                      Primary
                    </Label>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeGroup(group.id)}
                    data-testid={`button-remove-group-${group.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {group.isPrimary && (
                  <p className="text-xs text-muted-foreground">
                    Workers with these statuses will appear on the main employer cards and count toward card check statistics.
                  </p>
                )}
                <div className="grid grid-cols-2 gap-2">
                  {statuses.map((status) => {
                    const isInThisGroup = group.statusIds.includes(status.id);
                    const isInOtherGroup = !isInThisGroup && assignedStatusIds.has(status.id);
                    return (
                      <div key={status.id} className="flex items-center gap-2">
                        <Checkbox
                          id={`status-${group.id}-${status.id}`}
                          checked={isInThisGroup}
                          disabled={isInOtherGroup}
                          onCheckedChange={() => toggleStatus(group.id, status.id)}
                          data-testid={`checkbox-status-${group.id}-${status.id}`}
                        />
                        <Label
                          htmlFor={`status-${group.id}-${status.id}`}
                          className={`text-sm ${isInOtherGroup ? "text-muted-foreground line-through" : ""}`}
                        >
                          {status.name} ({status.code})
                        </Label>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}

          <Button variant="outline" onClick={addGroup} className="w-full" data-testid="button-add-group">
            <Plus className="h-4 w-4 mr-2" />
            Add Status Group
          </Button>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="ghost" onClick={() => setOpen(false)} data-testid="button-cancel-groups">
            Cancel
          </Button>
          <Button
            onClick={() => saveMutation.mutate({ groups, days: newMemberDays })}
            disabled={saveMutation.isPending || groups.some(g => !g.name.trim())}
            data-testid="button-save-groups"
          >
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SecondaryGroupSection({ group, term }: { group: SecondaryGroupData; term: TermFn }) {
  const [expanded, setExpanded] = useState(false);
  const displayWorkers = expanded ? group.workers : group.workers.slice(0, 10);
  const hasMore = group.workers.length > 10;

  if (group.workers.length === 0) return null;

  const employerCounts = new Map<string, number>();
  for (const w of group.workers) {
    employerCounts.set(w.employerName, (employerCounts.get(w.employerName) || 0) + 1);
  }

  return (
    <Card data-testid={`card-secondary-group-${group.id}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">{group.name}</CardTitle>
          </div>
          <Badge variant="secondary" data-testid={`badge-group-count-${group.id}`}>
            {group.workers.length} {term('worker', { plural: group.workers.length !== 1, lowercase: true })}
            {" across "}
            {employerCounts.size} {term('employer', { plural: employerCounts.size !== 1, lowercase: true })}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>{term('employer')}</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Since</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayWorkers.map((worker) => (
              <TableRow key={`${worker.workerId}-${worker.employerId}`}>
                <TableCell>
                  <Link href={`/workers/${worker.workerId}`}>
                    <span className="underline-offset-2 hover:underline cursor-pointer" data-testid={`link-worker-${worker.workerId}`}>
                      {worker.displayName}
                    </span>
                  </Link>
                </TableCell>
                <TableCell>
                  <Link href={`/employers/${worker.employerId}`}>
                    <span className="underline-offset-2 hover:underline cursor-pointer text-muted-foreground" data-testid={`link-employer-${worker.employerId}`}>
                      {worker.employerName}
                    </span>
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{worker.statusName}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {worker.statusDate
                    ? new Date(worker.statusDate).toLocaleDateString()
                    : "-"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {hasMore && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full mt-2"
            onClick={() => setExpanded(!expanded)}
            data-testid={`button-toggle-group-${group.id}`}
          >
            {expanded ? "Show less" : `Show all ${group.workers.length} ${term('worker', { plural: true, lowercase: true })}`}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function NewMembersSection({ members, days, term }: { members: NewMember[]; days: number; term: TermFn }) {
  const [expanded, setExpanded] = useState(false);
  const displayMembers = expanded ? members : members.slice(0, 10);
  const hasMore = members.length > 10;

  if (members.length === 0) return null;

  return (
    <Card data-testid="card-new-members">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Star className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">New Members</CardTitle>
          </div>
          <Badge variant="secondary" data-testid="badge-new-members-count">
            {members.length} new in last {days} days
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {term('worker', { plural: true })} whose first signed card check is within the last {days} days. These members need to be voted into the union at a membership meeting.
        </p>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>{term('employer')}</TableHead>
              <TableHead>{term('bargainingUnit')}</TableHead>
              <TableHead>Signed Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayMembers.map((member) => (
              <TableRow key={member.workerId}>
                <TableCell>
                  <Link href={`/workers/${member.workerId}`}>
                    <span className="underline-offset-2 hover:underline cursor-pointer" data-testid={`link-new-member-${member.workerId}`}>
                      {member.displayName}
                    </span>
                  </Link>
                </TableCell>
                <TableCell>
                  {member.employerId ? (
                    <Link href={`/employers/${member.employerId}`}>
                      <span className="underline-offset-2 hover:underline cursor-pointer text-muted-foreground" data-testid={`link-new-member-employer-${member.employerId}`}>
                        {member.employerName}
                      </span>
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">{member.employerName}</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{member.bargainingUnitName}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(member.signedDate).toLocaleDateString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {hasMore && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full mt-2"
            onClick={() => setExpanded(!expanded)}
            data-testid="button-toggle-new-members"
          >
            {expanded ? "Show less" : `Show all ${members.length} new members`}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export default function EmployersOrganizing() {
  const [search, setSearch] = useState("");
  const [employerTypeFilter, setEmployerTypeFilter] = useState<string>("");
  const [schoolTypeFilter, setSchoolTypeFilter] = useState<string>("");
  const [regionFilter, setRegionFilter] = useState<string>("");
  const [isExporting, setIsExporting] = useState(false);
  const term = useTerm();
  const { hasComponent, hasPermission } = useAuth();

  const hasAccess = hasComponent("sitespecific.btu") || hasComponent("cardcheck");
  const hasBtuComponent = hasComponent("sitespecific.btu");
  const isAdmin = hasPermission("admin");

  interface OrganizingResponse {
    employers: OrganizingEmployer[];
    distinctTotalWorkers: number;
    distinctSignedWorkers: number;
    secondaryGroups?: SecondaryGroupData[];
    statusGroups?: StatusGroup[];
    newMembers?: NewMember[];
    newMemberDays?: number;
  }

  const { data: organizingData, isLoading, error } = useQuery<OrganizingResponse>({
    queryKey: ["/api/employers/organizing"],
    enabled: hasAccess,
  });

  const employers = organizingData?.employers || [];
  const secondaryGroups = organizingData?.secondaryGroups || [];

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
    let totalMissingDuesRevenue = 0;
    let hasDuesRates = false;
    for (const emp of employers) {
      for (const bu of emp.bargainingUnits) {
        if (bu.duesRate && bu.duesRate > 0) {
          hasDuesRates = true;
          const missing = bu.totalWorkers - bu.signedWorkers;
          if (missing > 0) {
            totalMissingDuesRevenue += missing * bu.duesRate;
          }
        }
      }
    }
    return {
      totalWorkers: organizingData?.distinctTotalWorkers || 0,
      signedWorkers: organizingData?.distinctSignedWorkers || 0,
      employerCount: employers.length,
      totalMissingDuesRevenue,
      hasDuesRates,
    };
  }, [organizingData, employers]);

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
      generateAggregatePdf(
        employers, missingData, totalStats, term, secondaryGroups,
        organizingData?.newMembers ?? [],
        organizingData?.newMemberDays ?? 30
      );
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
              {totalStats.hasDuesRates && totalStats.totalMissingDuesRevenue > 0 && (
                <span className="ml-2 font-medium text-destructive" data-testid="text-total-missing-revenue">
                  · ${totalStats.totalMissingDuesRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} potential missing dues
                </span>
              )}
            </span>
            <StatusGroupsDialog isAdmin={isAdmin} />
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

        {(organizingData?.newMembers?.length ?? 0) > 0 && (
          <div className="mt-8" data-testid="new-members-section">
            <NewMembersSection
              members={organizingData!.newMembers!}
              days={organizingData!.newMemberDays ?? 30}
              term={term}
            />
          </div>
        )}

        {secondaryGroups.length > 0 && (
          <div className="mt-8 space-y-4" data-testid="secondary-groups-section">
            {secondaryGroups.map((group) => (
              <SecondaryGroupSection key={group.id} group={group} term={term} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
