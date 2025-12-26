import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Trash2, Loader2, AlertTriangle, Download, Search, X, Map, Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PageHeader } from "@/components/layout/PageHeader";
import { useForm } from "react-hook-form";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";

interface BtuEmployerMap {
  id: string;
  departmentId: string | null;
  departmentTitle: string | null;
  locationId: string | null;
  locationTitle: string | null;
  jobCode: string | null;
  jobTitle: string | null;
  employerName: string | null;
}

interface FilterOptions {
  departments: string[];
  locations: string[];
  employerNames: string[];
}

interface FormValues {
  departmentId: string;
  departmentTitle: string;
  locationId: string;
  locationTitle: string;
  jobCode: string;
  jobTitle: string;
  employerName: string;
}

export default function BtuEmployerMapListPage() {
  const { toast } = useToast();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editRecord, setEditRecord] = useState<BtuEmployerMap | null>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [employerFilter, setEmployerFilter] = useState("all");

  const { data: records = [], isLoading, error } = useQuery<BtuEmployerMap[]>({
    queryKey: ["/api/sitespecific/btu/employer-map"],
  });

  const { data: filterOptions } = useQuery<FilterOptions>({
    queryKey: ["/api/sitespecific/btu/employer-map/filters"],
  });

  const form = useForm<FormValues>({
    defaultValues: {
      departmentId: "",
      departmentTitle: "",
      locationId: "",
      locationTitle: "",
      jobCode: "",
      jobTitle: "",
      employerName: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: FormValues) => {
      return apiRequest("POST", "/api/sitespecific/btu/employer-map", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sitespecific/btu/employer-map"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sitespecific/btu/employer-map/filters"] });
      toast({
        title: "Record Created",
        description: "The employer map record has been created.",
      });
      setIsAddDialogOpen(false);
      form.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Create Failed",
        description: error?.message || "Failed to create record.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: FormValues }) => {
      return apiRequest("PATCH", `/api/sitespecific/btu/employer-map/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sitespecific/btu/employer-map"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sitespecific/btu/employer-map/filters"] });
      toast({
        title: "Record Updated",
        description: "The employer map record has been updated.",
      });
      setEditRecord(null);
      form.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error?.message || "Failed to update record.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/sitespecific/btu/employer-map/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sitespecific/btu/employer-map"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sitespecific/btu/employer-map/filters"] });
      toast({
        title: "Record Deleted",
        description: "The employer map record has been deleted.",
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

  const parsedDepartments = useMemo(() => {
    if (!filterOptions?.departments) return [];
    return filterOptions.departments.map(d => {
      try {
        return JSON.parse(d) as { id: string; title: string };
      } catch {
        return null;
      }
    }).filter((d): d is { id: string; title: string } => d !== null);
  }, [filterOptions?.departments]);

  const parsedLocations = useMemo(() => {
    if (!filterOptions?.locations) return [];
    return filterOptions.locations.map(l => {
      try {
        return JSON.parse(l) as { id: string; title: string };
      } catch {
        return null;
      }
    }).filter((l): l is { id: string; title: string } => l !== null);
  }, [filterOptions?.locations]);

  const filteredRecords = useMemo(() => {
    return records.filter(record => {
      const matchesSearch = searchQuery === "" || 
        record.departmentTitle?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        record.locationTitle?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        record.jobTitle?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        record.jobCode?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        record.employerName?.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesDepartment = departmentFilter === "all" || record.departmentId === departmentFilter;
      const matchesLocation = locationFilter === "all" || record.locationId === locationFilter;
      const matchesEmployer = employerFilter === "all" || record.employerName === employerFilter;

      return matchesSearch && matchesDepartment && matchesLocation && matchesEmployer;
    });
  }, [records, searchQuery, departmentFilter, locationFilter, employerFilter]);

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
      "Department ID",
      "Department Title",
      "Location ID",
      "Location Title",
      "Job Code",
      "Job Title",
      "Employer Name",
    ];

    const rows = filteredRecords.map((record) => [
      escapeCSV(record.id),
      escapeCSV(record.departmentId),
      escapeCSV(record.departmentTitle),
      escapeCSV(record.locationId),
      escapeCSV(record.locationTitle),
      escapeCSV(record.jobCode),
      escapeCSV(record.jobTitle),
      escapeCSV(record.employerName),
    ]);

    const csv = [headers.join(","), ...rows.map(row => row.join(","))].join("\n");
    const BOM = "\uFEFF";

    const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `employer-map-${new Date().toISOString().split("T")[0]}.csv`;
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
    setDepartmentFilter("all");
    setLocationFilter("all");
    setEmployerFilter("all");
  };

  const hasActiveFilters = searchQuery !== "" || departmentFilter !== "all" || locationFilter !== "all" || employerFilter !== "all";

  const openAddDialog = () => {
    form.reset({
      departmentId: "",
      departmentTitle: "",
      locationId: "",
      locationTitle: "",
      jobCode: "",
      jobTitle: "",
      employerName: "",
    });
    setIsAddDialogOpen(true);
  };

  const openEditDialog = (record: BtuEmployerMap) => {
    form.reset({
      departmentId: record.departmentId || "",
      departmentTitle: record.departmentTitle || "",
      locationId: record.locationId || "",
      locationTitle: record.locationTitle || "",
      jobCode: record.jobCode || "",
      jobTitle: record.jobTitle || "",
      employerName: record.employerName || "",
    });
    setEditRecord(record);
  };

  const onSubmit = (data: FormValues) => {
    const cleanedData = {
      departmentId: data.departmentId?.trim() || null,
      departmentTitle: data.departmentTitle?.trim() || null,
      locationId: data.locationId?.trim() || null,
      locationTitle: data.locationTitle?.trim() || null,
      jobCode: data.jobCode?.trim() || null,
      jobTitle: data.jobTitle?.trim() || null,
      employerName: data.employerName?.trim() || null,
    };
    
    if (editRecord) {
      updateMutation.mutate({ id: editRecord.id, data: cleanedData as FormValues });
    } else {
      createMutation.mutate(cleanedData as FormValues);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <PageHeader 
          title="Employer Map" 
          icon={<Map className="text-primary-foreground" size={16} />}
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
          title="Employer Map" 
          icon={<Map className="text-primary-foreground" size={16} />}
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
        title="Employer Map" 
        icon={<Map className="text-primary-foreground" size={16} />}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={exportToCSV} data-testid="button-export-csv">
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
            <Button size="sm" onClick={openAddDialog} data-testid="button-new-mapping">
              <Plus className="h-4 w-4 mr-2" />
              New Mapping
            </Button>
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
                  placeholder="Search by department, location, job, or employer..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                  data-testid="input-search"
                />
              </div>
            </div>
            <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
              <SelectTrigger className="w-[180px]" data-testid="select-department-filter">
                <SelectValue placeholder="All Departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {parsedDepartments.map((dept) => (
                  <SelectItem key={dept.id} value={dept.id}>
                    {dept.title || dept.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={locationFilter} onValueChange={setLocationFilter}>
              <SelectTrigger className="w-[180px]" data-testid="select-location-filter">
                <SelectValue placeholder="All Locations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Locations</SelectItem>
                {parsedLocations.map((loc) => (
                  <SelectItem key={loc.id} value={loc.id}>
                    {loc.title || loc.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={employerFilter} onValueChange={setEmployerFilter}>
              <SelectTrigger className="w-[180px]" data-testid="select-employer-filter">
                <SelectValue placeholder="All Employers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Employers</SelectItem>
                {filterOptions?.employerNames?.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
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
                ? 'No employer map records found. Click "New Mapping" to create one.'
                : "No records match the current filters."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Department</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Job Code</TableHead>
                <TableHead>Job Title</TableHead>
                <TableHead>Employer</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRecords.map((record) => (
                <TableRow key={record.id} data-testid={`row-employer-map-${record.id}`}>
                  <TableCell data-testid={`text-department-${record.id}`}>{record.departmentTitle || record.departmentId || "-"}</TableCell>
                  <TableCell data-testid={`text-location-${record.id}`}>{record.locationTitle || record.locationId || "-"}</TableCell>
                  <TableCell data-testid={`text-job-code-${record.id}`}>{record.jobCode || "-"}</TableCell>
                  <TableCell data-testid={`text-job-title-${record.id}`}>{record.jobTitle || "-"}</TableCell>
                  <TableCell className="font-medium" data-testid={`text-employer-${record.id}`}>{record.employerName || "-"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditDialog(record)}
                        data-testid={`button-edit-${record.id}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
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
            <DialogTitle>Delete Mapping</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this employer map record? This action cannot be undone.
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

      <Dialog open={isAddDialogOpen || !!editRecord} onOpenChange={(open) => {
        if (!open) {
          setIsAddDialogOpen(false);
          setEditRecord(null);
          form.reset();
        }
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editRecord ? "Edit Mapping" : "New Employer Mapping"}</DialogTitle>
            <DialogDescription>
              {editRecord ? "Update the employer mapping details." : "Create a new employer mapping record."}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="departmentId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Department ID</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g., DEPT001" data-testid="input-department-id" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="departmentTitle"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Department Title</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g., Human Resources" data-testid="input-department-title" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="locationId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Location ID</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g., LOC001" data-testid="input-location-id" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="locationTitle"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Location Title</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g., Main Campus" data-testid="input-location-title" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="jobCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Job Code</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g., JOB001" data-testid="input-job-code" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="jobTitle"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Job Title</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g., Teacher" data-testid="input-job-title" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="employerName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Employer Name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g., Boston Public Schools" data-testid="input-employer-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => {
                  setIsAddDialogOpen(false);
                  setEditRecord(null);
                  form.reset();
                }} data-testid="button-cancel-form">
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={createMutation.isPending || updateMutation.isPending}
                  data-testid="button-submit-form"
                >
                  {(createMutation.isPending || updateMutation.isPending) && (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  )}
                  {editRecord ? "Update" : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
