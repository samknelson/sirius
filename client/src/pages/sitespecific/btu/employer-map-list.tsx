import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Plus, Trash2, Loader2, AlertTriangle, Download, Search, X, Map, Pencil, Upload, CheckCircle2, Lightbulb } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PageHeader } from "@/components/layout/PageHeader";
import { useForm } from "react-hook-form";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";

interface BtuEmployerMap {
  id: string;
  departmentId: string | null;
  departmentTitle: string | null;
  locationId: string | null;
  locationTitle: string | null;
  jobCode: string | null;
  jobTitle: string | null;
  employerName: string | null;
  secondaryEmployerName: string | null;
  bargainingUnitId: string | null;
  employmentStatusId: string | null;
}

interface EmploymentStatus {
  id: string;
  name: string;
  code: string;
  employed: boolean;
}

interface BargainingUnit {
  id: string;
  siriusId: string;
  name: string;
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
  secondaryEmployerName: string;
  bargainingUnitId: string;
  employmentStatusId: string;
}

interface ImportResult {
  success: boolean;
  imported: number;
  failed: number;
  total: number;
  errors: Array<{ row: number; error: string }>;
}

interface EmployerSuggestion {
  primary: string | null;
  alternates: string[];
}

interface SuggestionsData {
  byLocationId: Record<string, EmployerSuggestion>;
  byLocationTitle: Record<string, EmployerSuggestion>;
  secondaryByLocationId: Record<string, EmployerSuggestion>;
  secondaryByLocationTitle: Record<string, EmployerSuggestion>;
}

export default function BtuEmployerMapListPage() {
  const { toast } = useToast();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editRecord, setEditRecord] = useState<BtuEmployerMap | null>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [clearExisting, setClearExisting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [employerFilter, setEmployerFilter] = useState("all");
  const [employerExistsFilter, setEmployerExistsFilter] = useState("all");

  const { data: records = [], isLoading, error } = useQuery<BtuEmployerMap[]>({
    queryKey: ["/api/sitespecific/btu/employer-map"],
  });

  const { data: filterOptions } = useQuery<FilterOptions>({
    queryKey: ["/api/sitespecific/btu/employer-map/filters"],
  });

  const { data: bargainingUnits = [] } = useQuery<BargainingUnit[]>({
    queryKey: ["/api/bargaining-units"],
  });

  const { data: employmentStatuses = [] } = useQuery<EmploymentStatus[]>({
    queryKey: ["/api/settings/employment-statuses"],
  });

  const { data: systemEmployersData, isSuccess: systemEmployersLoaded } = useQuery<{ employerNames: string[] }>({
    queryKey: ["/api/sitespecific/btu/employer-map/system-employers"],
  });

  const { data: suggestionsData } = useQuery<SuggestionsData>({
    queryKey: ["/api/sitespecific/btu/employer-map/suggestions"],
  });

  const systemEmployerNames = useMemo(() => {
    return new Set(systemEmployersData?.employerNames || []);
  }, [systemEmployersData]);

  // Normalized employer name index: maps lowercase/trimmed names to original names
  const normalizedEmployerIndex = useMemo(() => {
    const index: Record<string, string> = {};
    for (const name of systemEmployersData?.employerNames || []) {
      const normalized = name.toLowerCase().trim();
      index[normalized] = name;
    }
    return index;
  }, [systemEmployersData]);

  // Helper to find an employer name match from a given text
  const findEmployerNameMatch = (text: string | null | undefined): string | null => {
    if (!text) return null;
    const normalized = text.toLowerCase().trim();
    return normalizedEmployerIndex[normalized] || null;
  };

  // Helper to get employer suggestion for a record
  // Priority: 1) Location title matches employer name, 2) Dept title matches, 
  // 3) Job title matches, 4) Frequency-based location suggestions
  const getSuggestionForRecord = (record: BtuEmployerMap): string | null => {
    // PRIORITY 1: Check if locationTitle directly matches an employer name
    const locationNameMatch = findEmployerNameMatch(record.locationTitle);
    if (locationNameMatch) {
      return locationNameMatch;
    }
    
    // PRIORITY 2: Check if departmentTitle matches an employer name
    const deptNameMatch = findEmployerNameMatch(record.departmentTitle);
    if (deptNameMatch) {
      return deptNameMatch;
    }
    
    // PRIORITY 3: Check if jobTitle matches an employer name
    const jobNameMatch = findEmployerNameMatch(record.jobTitle);
    if (jobNameMatch) {
      return jobNameMatch;
    }
    
    // PRIORITY 4: Fall back to frequency-based suggestions
    if (!suggestionsData) return null;
    
    // Try by locationId
    if (record.locationId && suggestionsData.byLocationId[record.locationId]) {
      return suggestionsData.byLocationId[record.locationId].primary;
    }
    
    // Fallback to location title (normalized)
    if (record.locationTitle) {
      const normalizedTitle = record.locationTitle.toLowerCase().trim();
      if (suggestionsData.byLocationTitle[normalizedTitle]) {
        return suggestionsData.byLocationTitle[normalizedTitle].primary;
      }
    }
    
    return null;
  };

  // Helper to get secondary employer suggestion for a record
  // Returns a suggestion for secondary employer based on location mapping
  // Only returns null if the suggestion matches the current primary employer (to avoid duplicates)
  const getSecondarySuggestionForRecord = (record: BtuEmployerMap): string | null => {
    if (!suggestionsData) return null;
    
    let secondarySuggestion: string | null = null;
    
    // First try by locationId
    if (record.locationId && suggestionsData.secondaryByLocationId?.[record.locationId]) {
      secondarySuggestion = suggestionsData.secondaryByLocationId[record.locationId].primary;
    }
    
    // Fallback to location title (normalized)
    if (!secondarySuggestion && record.locationTitle) {
      const normalizedTitle = record.locationTitle.toLowerCase().trim();
      if (suggestionsData.secondaryByLocationTitle?.[normalizedTitle]) {
        secondarySuggestion = suggestionsData.secondaryByLocationTitle[normalizedTitle].primary;
      }
    }
    
    // Only suppress the suggestion if it exactly matches the current primary employer
    // (to avoid suggesting the same employer for both primary and secondary)
    if (secondarySuggestion && secondarySuggestion === record.employerName) {
      return null;
    }
    
    return secondarySuggestion;
  };

  const form = useForm<FormValues>({
    defaultValues: {
      departmentId: "",
      departmentTitle: "",
      locationId: "",
      locationTitle: "",
      jobCode: "",
      jobTitle: "",
      employerName: "",
      secondaryEmployerName: "",
      bargainingUnitId: "",
      employmentStatusId: "",
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

  const importMutation = useMutation({
    mutationFn: async (data: { records: any[]; clearExisting: boolean }) => {
      return await apiRequest("POST", "/api/sitespecific/btu/employer-map/import", data);
    },
    onSuccess: (result: ImportResult) => {
      setImportResult(result);
      queryClient.invalidateQueries({ queryKey: ["/api/sitespecific/btu/employer-map"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sitespecific/btu/employer-map/filters"] });
      if (result.failed === 0) {
        toast({
          title: "Import Successful",
          description: `Successfully imported ${result.imported} records.`,
        });
      } else {
        toast({
          title: "Import Completed with Errors",
          description: `Imported ${result.imported} records, ${result.failed} failed.`,
          variant: "destructive",
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Import Failed",
        description: error?.message || "Failed to import records.",
        variant: "destructive",
      });
    },
  });

  const parseCSV = (text: string): any[] => {
    if (!text || text.length === 0) return [];
    
    // Strip UTF-8 BOM if present
    const cleanText = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
    
    const lines = cleanText.split(/\r?\n/).filter(line => line.trim() !== "");
    if (lines.length < 2) return [];
    
    const headers = lines[0].split(",").map(h => h.trim());
    const records: any[] = [];
    
    for (let i = 1; i < lines.length; i++) {
      const values: string[] = [];
      let current = "";
      let inQuotes = false;
      
      for (const char of lines[i]) {
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === "," && !inQuotes) {
          values.push(current.trim());
          current = "";
        } else {
          current += char;
        }
      }
      values.push(current.trim());
      
      const record: any = {};
      headers.forEach((header, idx) => {
        const value = values[idx] || "";
        const normalizedHeader = header.toLowerCase().replace(/\s+/g, "");
        
        if (normalizedHeader === "deptid" || normalizedHeader === "departmentid") {
          record.departmentId = value || null;
        } else if (normalizedHeader === "depttitle" || normalizedHeader === "departmenttitle") {
          record.departmentTitle = value || null;
        } else if (normalizedHeader === "locationid") {
          record.locationId = value || null;
        } else if (normalizedHeader === "locationtitle") {
          record.locationTitle = value || null;
        } else if (normalizedHeader === "jobid" || normalizedHeader === "jobcode") {
          record.jobCode = value || null;
        } else if (normalizedHeader === "jobtitle") {
          record.jobTitle = value || null;
        } else if (normalizedHeader === "employername" || normalizedHeader === "employer") {
          record.employerName = value || null;
        } else if (normalizedHeader === "secondaryemployername" || normalizedHeader === "secondaryemployer" || normalizedHeader === "secondary") {
          record.secondaryEmployerName = value || null;
        } else if (normalizedHeader === "bargainingunit" || normalizedHeader === "bargaining" || normalizedHeader === "bu" || normalizedHeader === "unit") {
          record.bargainingUnitName = value || null;
        }
      });
      
      records.push(record);
    }
    
    return records;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImportFile(file);
      setImportResult(null);
    }
  };

  const handleImport = async () => {
    if (!importFile) return;
    
    const text = await importFile.text();
    const records = parseCSV(text);
    
    if (records.length === 0) {
      toast({
        title: "No Records Found",
        description: "The CSV file appears to be empty or invalid.",
        variant: "destructive",
      });
      return;
    }
    
    importMutation.mutate({ records, clearExisting });
  };

  const closeImportDialog = () => {
    setIsImportDialogOpen(false);
    setImportFile(null);
    setClearExisting(false);
    setImportResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

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

      // Employer exists filter - only apply when system employers have loaded
      let matchesEmployerExists = true;
      if (systemEmployersLoaded && employerExistsFilter !== "all") {
        const primaryExists = record.employerName ? systemEmployerNames.has(record.employerName) : false;
        const secondaryExists = record.secondaryEmployerName ? systemEmployerNames.has(record.secondaryEmployerName) : true;
        const allExist = primaryExists && secondaryExists;
        
        if (employerExistsFilter === "exists") {
          matchesEmployerExists = allExist;
        } else if (employerExistsFilter === "missing") {
          matchesEmployerExists = !allExist;
        }
      }

      return matchesSearch && matchesDepartment && matchesLocation && matchesEmployer && matchesEmployerExists;
    });
  }, [records, searchQuery, departmentFilter, locationFilter, employerFilter, employerExistsFilter, systemEmployersLoaded, systemEmployerNames]);

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
      "Secondary Employer Name",
      "Bargaining Unit",
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
      escapeCSV(record.secondaryEmployerName),
      escapeCSV(bargainingUnits.find(bu => bu.id === record.bargainingUnitId)?.siriusId),
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
    setEmployerExistsFilter("all");
  };

  const hasActiveFilters = searchQuery !== "" || departmentFilter !== "all" || locationFilter !== "all" || employerFilter !== "all" || employerExistsFilter !== "all";

  const openAddDialog = () => {
    form.reset({
      departmentId: "",
      departmentTitle: "",
      locationId: "",
      locationTitle: "",
      jobCode: "",
      jobTitle: "",
      employerName: "",
      secondaryEmployerName: "",
      bargainingUnitId: "",
      employmentStatusId: "",
    });
    setIsAddDialogOpen(true);
  };

  const openEditDialog = (record: BtuEmployerMap) => {
    // Pre-fill employer with suggestion if employer is missing or doesn't exist
    let employerNameValue = record.employerName || "";
    if (!record.employerName || (systemEmployersLoaded && !systemEmployerNames.has(record.employerName))) {
      const suggestion = getSuggestionForRecord(record);
      if (suggestion && !record.employerName) {
        employerNameValue = suggestion;
      }
    }
    
    form.reset({
      departmentId: record.departmentId || "",
      departmentTitle: record.departmentTitle || "",
      locationId: record.locationId || "",
      locationTitle: record.locationTitle || "",
      jobCode: record.jobCode || "",
      jobTitle: record.jobTitle || "",
      employerName: employerNameValue,
      secondaryEmployerName: record.secondaryEmployerName || "",
      bargainingUnitId: record.bargainingUnitId || "",
      employmentStatusId: record.employmentStatusId || "",
    });
    setEditRecord(record);
  };

  const handleApplySuggestion = (recordId: string, suggestedEmployer: string) => {
    const record = records.find(r => r.id === recordId);
    if (!record) return;
    
    const cleanedData = {
      departmentId: record.departmentId || null,
      departmentTitle: record.departmentTitle || null,
      locationId: record.locationId || null,
      locationTitle: record.locationTitle || null,
      jobCode: record.jobCode || null,
      jobTitle: record.jobTitle || null,
      employerName: suggestedEmployer,
      secondaryEmployerName: record.secondaryEmployerName || null,
      bargainingUnitId: record.bargainingUnitId || null,
      employmentStatusId: record.employmentStatusId || null,
    };
    
    updateMutation.mutate({ 
      id: recordId, 
      data: cleanedData as FormValues
    }, {
      onSuccess: () => {
        toast({
          title: "Suggestion Applied",
          description: `Employer set to "${suggestedEmployer}"`,
        });
      }
    });
  };

  const handleApplySecondarySuggestion = (recordId: string, suggestedEmployer: string) => {
    const record = records.find(r => r.id === recordId);
    if (!record) return;
    
    const cleanedData = {
      departmentId: record.departmentId || null,
      departmentTitle: record.departmentTitle || null,
      locationId: record.locationId || null,
      locationTitle: record.locationTitle || null,
      jobCode: record.jobCode || null,
      jobTitle: record.jobTitle || null,
      employerName: record.employerName || null,
      secondaryEmployerName: suggestedEmployer,
      bargainingUnitId: record.bargainingUnitId || null,
      employmentStatusId: record.employmentStatusId || null,
    };
    
    updateMutation.mutate({ 
      id: recordId, 
      data: cleanedData as FormValues
    }, {
      onSuccess: () => {
        toast({
          title: "Suggestion Applied",
          description: `Secondary employer set to "${suggestedEmployer}"`,
        });
      }
    });
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
      secondaryEmployerName: data.secondaryEmployerName?.trim() || null,
      bargainingUnitId: data.bargainingUnitId || null,
      employmentStatusId: data.employmentStatusId || null,
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
            <Button variant="outline" size="sm" onClick={() => setIsImportDialogOpen(true)} data-testid="button-import-csv">
              <Upload className="h-4 w-4 mr-2" />
              Import CSV
            </Button>
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
            <Select value={employerExistsFilter} onValueChange={setEmployerExistsFilter} disabled={!systemEmployersLoaded}>
              <SelectTrigger className="w-[180px]" data-testid="select-employer-exists-filter">
                <SelectValue placeholder="Employer Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="exists">Exists in System</SelectItem>
                <SelectItem value="missing">Missing from System</SelectItem>
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
                <TableHead>Secondary Employer</TableHead>
                <TableHead>Bargaining Unit</TableHead>
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
                  <TableCell className="font-medium" data-testid={`text-employer-${record.id}`}>
                    {record.employerName ? (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {systemEmployersLoaded && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              {systemEmployerNames.has(record.employerName) ? (
                                <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-500 flex-shrink-0 cursor-help" />
                              ) : (
                                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500 flex-shrink-0 cursor-help" />
                              )}
                            </TooltipTrigger>
                            <TooltipContent>
                              {systemEmployerNames.has(record.employerName) 
                                ? "Employer exists in system" 
                                : "Employer not found in system"}
                            </TooltipContent>
                          </Tooltip>
                        )}
                        <span>{record.employerName}</span>
                        {systemEmployersLoaded && !systemEmployerNames.has(record.employerName) && (() => {
                          const suggestion = getSuggestionForRecord(record);
                          if (suggestion) {
                            return (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge 
                                    variant="secondary" 
                                    className="cursor-pointer text-xs gap-1"
                                    onClick={() => handleApplySuggestion(record.id, suggestion)}
                                    data-testid={`badge-suggestion-${record.id}`}
                                  >
                                    <Lightbulb className="h-3 w-3" />
                                    {suggestion}
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>
                                  Click to apply suggested employer based on location
                                </TooltipContent>
                              </Tooltip>
                            );
                          }
                          return null;
                        })()}
                      </div>
                    ) : (() => {
                      const suggestion = getSuggestionForRecord(record);
                      if (suggestion) {
                        return (
                          <div className="flex items-center gap-1.5">
                            <span className="text-muted-foreground">-</span>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge 
                                  variant="secondary" 
                                  className="cursor-pointer text-xs gap-1"
                                  onClick={() => handleApplySuggestion(record.id, suggestion)}
                                  data-testid={`badge-suggestion-${record.id}`}
                                >
                                  <Lightbulb className="h-3 w-3" />
                                  {suggestion}
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>
                                Click to apply suggested employer based on location
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        );
                      }
                      return "-";
                    })()}
                  </TableCell>
                  <TableCell data-testid={`text-secondary-employer-${record.id}`}>
                    {record.secondaryEmployerName ? (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {systemEmployersLoaded && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              {systemEmployerNames.has(record.secondaryEmployerName) ? (
                                <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-500 flex-shrink-0 cursor-help" />
                              ) : (
                                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500 flex-shrink-0 cursor-help" />
                              )}
                            </TooltipTrigger>
                            <TooltipContent>
                              {systemEmployerNames.has(record.secondaryEmployerName) 
                                ? "Employer exists in system" 
                                : "Employer not found in system"}
                            </TooltipContent>
                          </Tooltip>
                        )}
                        <span>{record.secondaryEmployerName}</span>
                        {systemEmployersLoaded && !systemEmployerNames.has(record.secondaryEmployerName) && (() => {
                          const suggestion = getSecondarySuggestionForRecord(record);
                          if (suggestion) {
                            return (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge 
                                    variant="secondary" 
                                    className="cursor-pointer text-xs gap-1"
                                    onClick={() => handleApplySecondarySuggestion(record.id, suggestion)}
                                    data-testid={`badge-secondary-suggestion-${record.id}`}
                                  >
                                    <Lightbulb className="h-3 w-3" />
                                    {suggestion}
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>
                                  Click to apply suggested secondary employer based on location
                                </TooltipContent>
                              </Tooltip>
                            );
                          }
                          return null;
                        })()}
                      </div>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                  <TableCell data-testid={`text-bargaining-unit-${record.id}`}>
                    {bargainingUnits.find(bu => bu.id === record.bargainingUnitId)?.siriusId || "-"}
                  </TableCell>
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
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="employerName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Employer Name</FormLabel>
                      <Select 
                        onValueChange={(val) => field.onChange(val === "__none__" ? "" : val)} 
                        value={field.value || "__none__"}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-employer-name">
                            <SelectValue placeholder="Select an employer" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="__none__">None</SelectItem>
                          {systemEmployersData?.employerNames?.map((name) => (
                            <SelectItem key={name} value={name}>
                              {name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="secondaryEmployerName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Secondary Employer Name</FormLabel>
                      <Select 
                        onValueChange={(val) => field.onChange(val === "__none__" ? "" : val)} 
                        value={field.value || "__none__"}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-secondary-employer-name">
                            <SelectValue placeholder="Select a secondary employer (optional)" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="__none__">None</SelectItem>
                          {systemEmployersData?.employerNames?.map((name) => (
                            <SelectItem key={name} value={name}>
                              {name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="bargainingUnitId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bargaining Unit</FormLabel>
                      <Select 
                        onValueChange={(val) => field.onChange(val === "__none__" ? null : val)} 
                        value={field.value || "__none__"}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-bargaining-unit">
                            <SelectValue placeholder="Select a bargaining unit" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="__none__">None</SelectItem>
                          {bargainingUnits.map((unit) => (
                            <SelectItem key={unit.id} value={unit.id}>
                              {unit.siriusId} - {unit.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="employmentStatusId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Employment Status</FormLabel>
                      <Select 
                        onValueChange={(val) => field.onChange(val === "__none__" ? "" : val)} 
                        value={field.value || "__none__"}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-employment-status">
                            <SelectValue placeholder="Select an employment status" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="__none__">None</SelectItem>
                          {employmentStatuses.map((status) => (
                            <SelectItem key={status.id} value={status.id}>
                              {status.code} - {status.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
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

      <Dialog open={isImportDialogOpen} onOpenChange={(open) => !open && closeImportDialog()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import Employer Map from CSV</DialogTitle>
            <DialogDescription>
              Upload a CSV file with columns: Dept ID, Dept Title, Location ID, Location Title, Job Code/ID, Job Title, Employer Name, Secondary Employer, Bargaining Unit
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="csv-file">CSV File</Label>
              <Input
                id="csv-file"
                type="file"
                accept=".csv"
                ref={fileInputRef}
                onChange={handleFileChange}
                data-testid="input-import-file"
              />
            </div>
            {importFile && (
              <p className="text-sm text-muted-foreground">
                Selected: {importFile.name}
              </p>
            )}
            <div className="flex items-center space-x-2">
              <Checkbox
                id="clear-existing"
                checked={clearExisting}
                onCheckedChange={(checked) => setClearExisting(checked === true)}
                data-testid="checkbox-clear-existing"
              />
              <Label htmlFor="clear-existing" className="text-sm font-normal">
                Clear all existing records before importing
              </Label>
            </div>
            {importResult && (
              <div className="p-4 bg-muted rounded-md space-y-2">
                <p className="font-medium">Import Results:</p>
                <p className="text-sm">Total records: {importResult.total}</p>
                <p className="text-sm text-green-600 dark:text-green-400">Successfully imported: {importResult.imported}</p>
                {importResult.failed > 0 && (
                  <>
                    <p className="text-sm text-destructive">Failed: {importResult.failed}</p>
                    {importResult.errors.length > 0 && (
                      <div className="text-sm text-destructive">
                        <p>First errors:</p>
                        <ul className="list-disc list-inside">
                          {importResult.errors.map((err, idx) => (
                            <li key={idx}>Row {err.row}: {err.error}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeImportDialog} data-testid="button-cancel-import">
              {importResult ? "Close" : "Cancel"}
            </Button>
            {!importResult && (
              <Button 
                onClick={handleImport} 
                disabled={!importFile || importMutation.isPending}
                data-testid="button-submit-import"
              >
                {importMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Import
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
