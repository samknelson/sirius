import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Trash2, Loader2, AlertTriangle, Download, Search, Eye, X, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PageHeader } from "@/components/layout/PageHeader";

interface BtuCsgRecord {
  id: string;
  bpsId: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  nonBpsEmail: string | null;
  school: string | null;
  principalHeadmaster: string | null;
  role: string | null;
  typeOfClass: string | null;
  course: string | null;
  section: string | null;
  numberOfStudents: string | null;
  comments: string | null;
  status: string;
  adminNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

const STATUS_COLORS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  in_progress: "default",
  resolved: "outline",
  closed: "outline",
};

const STATUS_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "pending", label: "Pending" },
  { value: "in_progress", label: "In Progress" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

export default function BtuCsgListPage() {
  const { toast } = useToast();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [schoolFilter, setSchoolFilter] = useState("all");

  const { data: records = [], isLoading, error } = useQuery<BtuCsgRecord[]>({
    queryKey: ["/api/sitespecific/btu/csg"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/sitespecific/btu/csg/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sitespecific/btu/csg"] });
      toast({
        title: "Record Deleted",
        description: "The grievance record has been deleted.",
      });
      setDeleteId(null);
    },
    onError: (error: any) => {
      toast({
        title: "Delete Failed",
        description: error?.message || "Failed to delete record.",
        variant: "destructive",
      });
    },
  });

  const uniqueSchools = useMemo(() => {
    const schools = records
      .map(r => r.school)
      .filter((school): school is string => !!school);
    return Array.from(new Set(schools)).sort();
  }, [records]);

  const filteredRecords = useMemo(() => {
    return records.filter(record => {
      const matchesSearch = searchQuery === "" || 
        `${record.firstName} ${record.lastName}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
        record.bpsId?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        record.school?.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesStatus = statusFilter === "all" || record.status === statusFilter;
      const matchesSchool = schoolFilter === "all" || record.school === schoolFilter;

      return matchesSearch && matchesStatus && matchesSchool;
    });
  }, [records, searchQuery, statusFilter, schoolFilter]);

  const escapeCSV = (value: string | null | undefined): string => {
    if (value === null || value === undefined) return "";
    const str = String(value);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const exportToCSV = () => {
    if (filteredRecords.length === 0) {
      toast({
        title: "No data to export",
        description: "There are no records matching the current filters.",
        variant: "destructive",
      });
      return;
    }

    const headers = [
      "ID",
      "BPS ID",
      "First Name",
      "Last Name",
      "Phone",
      "Non-BPS Email",
      "School",
      "Principal/Headmaster",
      "Role",
      "Type of Class",
      "Course",
      "Section",
      "Number of Students",
      "Comments",
      "Status",
      "Admin Notes",
      "Created At",
      "Updated At",
    ];

    const rows = filteredRecords.map((record) => [
      escapeCSV(record.id),
      escapeCSV(record.bpsId),
      escapeCSV(record.firstName),
      escapeCSV(record.lastName),
      escapeCSV(record.phone),
      escapeCSV(record.nonBpsEmail),
      escapeCSV(record.school),
      escapeCSV(record.principalHeadmaster),
      escapeCSV(record.role),
      escapeCSV(record.typeOfClass),
      escapeCSV(record.course),
      escapeCSV(record.section),
      escapeCSV(record.numberOfStudents),
      escapeCSV(record.comments),
      escapeCSV(record.status),
      escapeCSV(record.adminNotes),
      escapeCSV(record.createdAt),
      escapeCSV(record.updatedAt),
    ]);

    const csv = [headers.join(","), ...rows.map(row => row.join(","))].join("\n");
    const BOM = "\uFEFF";

    const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `class-size-grievances-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);

    toast({
      title: "Export successful",
      description: `Exported ${filteredRecords.length} record(s) to CSV.`,
    });
  };

  const clearFilters = () => {
    setSearchQuery("");
    setStatusFilter("all");
    setSchoolFilter("all");
  };

  const hasActiveFilters = searchQuery !== "" || statusFilter !== "all" || schoolFilter !== "all";

  if (isLoading) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <PageHeader 
          title="Class Size Grievances" 
          icon={<FileText className="text-primary-foreground" size={16} />}
        />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin" data-testid="loading-spinner" />
          </div>
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <PageHeader 
          title="Class Size Grievances" 
          icon={<FileText className="text-primary-foreground" size={16} />}
        />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-5 w-5" />
                <span>Failed to load records. The BTU component may not be enabled.</span>
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="bg-background text-foreground min-h-screen">
      <PageHeader 
        title="Class Size Grievances" 
        icon={<FileText className="text-primary-foreground" size={16} />}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={exportToCSV} data-testid="button-export-csv">
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
            <Link href="/sitespecific/btu/csgs/new">
              <Button size="sm" data-testid="button-new-csg">
                <Plus className="h-4 w-4 mr-2" />
                New Grievance
              </Button>
            </Link>
          </div>
        }
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, BPS ID, or school..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                  data-testid="input-search"
                />
              </div>
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]" data-testid="select-status-filter">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={schoolFilter} onValueChange={setSchoolFilter}>
              <SelectTrigger className="w-[200px]" data-testid="select-school-filter">
                <SelectValue placeholder="All Schools" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Schools</SelectItem>
                {uniqueSchools.map((school) => (
                  <SelectItem key={school} value={school}>
                    {school}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="button-clear-filters">
                <X className="h-4 w-4 mr-1" />
                Clear
              </Button>
            )}
          </div>
          <div className="text-sm text-muted-foreground mt-2">
            Showing {filteredRecords.length} of {records.length} records
          </div>
        </CardContent>
      </Card>

      {filteredRecords.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">
              {records.length === 0 
                ? 'No grievance records found. Click "New Grievance" to create one.'
                : "No records match the current filters."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>BPS ID</TableHead>
                <TableHead>School</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Class Type</TableHead>
                <TableHead>Students</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRecords.map((record) => (
                <TableRow key={record.id} data-testid={`row-csg-${record.id}`}>
                  <TableCell className="font-medium">
                    {record.firstName} {record.lastName}
                  </TableCell>
                  <TableCell>{record.bpsId || "-"}</TableCell>
                  <TableCell>{record.school || "-"}</TableCell>
                  <TableCell>{record.role || "-"}</TableCell>
                  <TableCell>{record.typeOfClass || "-"}</TableCell>
                  <TableCell>{record.numberOfStudents || "-"}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_COLORS[record.status] || "secondary"}>
                      {record.status.replace("_", " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Link href={`/sitespecific/btu/csg/${record.id}`}>
                        <Button variant="ghost" size="icon" data-testid={`button-view-${record.id}`}>
                          <Eye className="h-4 w-4" />
                        </Button>
                      </Link>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteId(record.id)}
                        data-testid={`button-delete-${record.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      </main>

      <Dialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Grievance Record</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this grievance record? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)} data-testid="button-cancel-delete">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
