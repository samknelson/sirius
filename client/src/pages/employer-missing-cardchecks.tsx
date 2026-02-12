import { Users, ArrowLeft, Mail, Phone, Loader2, Download } from "lucide-react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useState, useMemo } from "react";
import pdfMake from "pdfmake/build/pdfmake";
import pdfFonts from "pdfmake/build/vfs_fonts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

pdfMake.vfs = (pdfFonts as any).pdfMake?.vfs || pdfFonts.vfs;

interface MissingCardcheckWorker {
  workerId: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  bargainingUnitId: string | null;
  bargainingUnitName: string;
  invalidReason: 'Missing' | 'BU Mismatch' | 'Termination Expired' | null;
  employmentStatus: string | null;
}

interface MissingCardchecksResponse {
  employer: {
    id: string;
    name: string;
  };
  workers: MissingCardcheckWorker[];
  totalCount: number;
}

function generatePdf(employer: { name: string }, workers: MissingCardcheckWorker[], missingCount: number) {
  const tableBody = [
    [
      { text: 'Name', style: 'tableHeader' },
      { text: 'Reason', style: 'tableHeader' },
      { text: 'Status', style: 'tableHeader' },
      { text: 'Email', style: 'tableHeader' },
      { text: 'Phone', style: 'tableHeader' },
      { text: 'Bargaining Unit', style: 'tableHeader' },
    ],
  ];
  
  if (workers.length > 0) {
    workers.forEach((worker) => {
      tableBody.push([
        { text: worker.displayName, style: undefined as any },
        { text: worker.invalidReason || 'Missing', style: 'reasonCell' as any },
        { text: worker.employmentStatus || '-', style: undefined as any },
        { text: worker.email || '-', style: undefined as any },
        { text: worker.phone || '-', style: undefined as any },
        { text: worker.bargainingUnitName, style: undefined as any },
      ]);
    });
  } else {
    tableBody.push([
      { text: 'All active workers have valid signed card checks', colSpan: 6, style: 'emptyMessage' } as any,
      {}, {}, {}, {}, {}
    ]);
  }

  const docDefinition = {
    pageSize: 'LETTER' as const,
    pageMargins: [40, 40, 40, 40] as [number, number, number, number],
    content: [
      {
        text: employer.name,
        style: 'header',
        margin: [0, 0, 0, 5] as [number, number, number, number],
      },
      {
        text: 'Missing Card Checks Report',
        style: 'subheader',
        margin: [0, 0, 0, 15] as [number, number, number, number],
      },
      {
        columns: [
          { text: `Workers Missing Card Checks: ${missingCount}`, style: 'stat' },
          { text: `Generated: ${new Date().toLocaleDateString()}`, style: 'stat', alignment: 'right' as const },
        ],
        margin: [0, 0, 0, 20] as [number, number, number, number],
      },
      {
        table: {
          headerRows: 1,
          widths: ['*', 'auto', 'auto', '*', 'auto', 'auto'],
          body: tableBody,
        },
        layout: {
          fillColor: (rowIndex: number) => (rowIndex === 0 ? '#f3f4f6' : null),
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => '#d1d5db',
          vLineColor: () => '#d1d5db',
        },
      },
    ],
    styles: {
      header: {
        fontSize: 18,
        bold: true,
      },
      subheader: {
        fontSize: 14,
        color: '#6b7280',
      },
      stat: {
        fontSize: 11,
        color: '#374151',
        bold: true,
      },
      tableHeader: {
        bold: true,
        fontSize: 10,
        color: '#374151',
      },
      reasonCell: {
        fontSize: 9,
        color: '#dc2626',
        italics: true,
      },
      emptyMessage: {
        fontSize: 10,
        color: '#6b7280',
        italics: true,
        alignment: 'center',
      },
    },
    defaultStyle: {
      fontSize: 9,
    },
  };

  const fileName = `missing-cardchecks-${employer.name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}.pdf`;
  pdfMake.createPdf(docDefinition as any).download(fileName);
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
          <div className="flex items-center gap-2">
            {data && (
              <Button 
                variant="default" 
                size="sm" 
                onClick={() => generatePdf(data.employer, data.workers, data.totalCount)}
                data-testid="button-download-pdf"
              >
                <Download className="h-4 w-4 mr-2" />
                Download PDF
              </Button>
            )}
            <Link href="/employers/organizing">
              <Button variant="outline" size="sm" data-testid="button-back">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Organizing List
              </Button>
            </Link>
          </div>
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
                  {filteredWorkers.length} Workers Missing Valid Card Checks
                </h2>
                <p className="text-sm text-muted-foreground" data-testid="text-description">
                  Active workers who need to sign a card check (missing, bargaining unit mismatch, or expired due to termination)
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
                      : "All active workers have valid signed card checks!"}
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
                        <TableHead data-testid="header-reason">Reason</TableHead>
                        <TableHead data-testid="header-status">Status</TableHead>
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
                            <Badge 
                              variant={worker.invalidReason === 'Missing' ? 'secondary' : 'destructive'}
                              data-testid={`reason-${worker.workerId}`}
                            >
                              {worker.invalidReason || 'Missing'}
                            </Badge>
                          </TableCell>
                          <TableCell data-testid={`status-${worker.workerId}`}>
                            {worker.employmentStatus || '-'}
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
