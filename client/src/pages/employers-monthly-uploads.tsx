import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { useForm } from "react-hook-form";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { WizardType } from "@/lib/wizard-types";

interface Upload {
  wizardId: string;
  employerId: string;
  year: number;
  month: number;
  id: string;
  type: string;
  status: string;
  currentStep: string | null;
  entityId: string | null;
  data: any;
  createdAt: string;
}

interface Employer {
  id: string;
  name: string;
  siriusId: number;
  isActive: boolean;
}

interface EmployerWithUploads {
  employer: Employer;
  uploads: Upload[];
}

interface MonthPeriod {
  year: number;
  month: number;
  label: string;
}

function generateYearOptions() {
  const currentYear = new Date().getFullYear();
  const years = [];
  for (let i = 0; i < 5; i++) {
    years.push(currentYear - i);
  }
  return years;
}

function generateMonthOptions() {
  return [
    { value: 1, label: "January" },
    { value: 2, label: "February" },
    { value: 3, label: "March" },
    { value: 4, label: "April" },
    { value: 5, label: "May" },
    { value: 6, label: "June" },
    { value: 7, label: "July" },
    { value: 8, label: "August" },
    { value: 9, label: "September" },
    { value: 10, label: "October" },
    { value: 11, label: "November" },
    { value: 12, label: "December" },
  ];
}

function calculateMonthPeriods(year: number, month: number): MonthPeriod[] {
  const periods: MonthPeriod[] = [];
  
  for (let i = 4; i >= 0; i--) {
    const targetDate = new Date(year, month - 1 - i, 1);
    periods.push({
      year: targetDate.getFullYear(),
      month: targetDate.getMonth() + 1,
      label: format(targetDate, 'MMM yyyy')
    });
  }
  
  return periods;
}

const filterSchema = z.object({
  year: z.coerce.number().int().min(1900).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  wizardType: z.string().min(1, "Please select an upload type"),
  status: z.string().optional(),
});

type FilterFormData = z.infer<typeof filterSchema>;

export default function EmployersMonthlyUploads() {
  const [location, setLocation] = useLocation();
  const [filters, setFilters] = useState<FilterFormData | null>(null);
  const [hasAutoLoaded, setHasAutoLoaded] = useState(false);

  const { data: wizardTypes = [] } = useQuery<WizardType[]>({
    queryKey: ["/api/wizard-types"],
  });

  const monthlyWizardTypes = wizardTypes.filter(wt => wt.isMonthly === true);
  
  // Parse URL search params - use window.location.search since wouter's location doesn't include query string
  const searchParams = new URLSearchParams(window.location.search);
  const urlYear = searchParams.get('year');
  const urlMonth = searchParams.get('month');
  const urlWizardType = searchParams.get('wizardType');
  const urlStatus = searchParams.get('status');
  
  const form = useForm<FilterFormData>({
    resolver: zodResolver(filterSchema),
    mode: "onChange",
    defaultValues: {
      year: urlYear ? Number(urlYear) : new Date().getFullYear(),
      month: urlMonth ? Number(urlMonth) : new Date().getMonth() + 1,
      wizardType: urlWizardType || "",
      status: urlStatus || "",
    },
  });

  // Reset hasAutoLoaded when URL changes
  useEffect(() => {
    setHasAutoLoaded(false);
  }, [window.location.search]);

  // Initialize from URL params or set default wizard type when wizard types are loaded
  useEffect(() => {
    if (monthlyWizardTypes.length === 0) return;

    // Check if we have URL params with a valid wizard type - auto-load data
    if (urlYear && urlMonth && urlWizardType && !hasAutoLoaded) {
      const isValidWizardType = monthlyWizardTypes.some(wt => wt.name === urlWizardType);
      
      if (isValidWizardType) {
        // Auto-submit with URL params
        const data: FilterFormData = {
          year: Number(urlYear),
          month: Number(urlMonth),
          wizardType: urlWizardType,
          status: urlStatus || undefined,
        };
        setFilters(data);
        setHasAutoLoaded(true);
        return;
      }
    }
    
    // No URL params - just set default wizard type in form if empty
    if (!hasAutoLoaded) {
      const currentWizardType = form.getValues('wizardType');
      if (!currentWizardType && monthlyWizardTypes.length > 0) {
        form.setValue('wizardType', monthlyWizardTypes[0].name);
      }
      setHasAutoLoaded(true);
    }
  }, [monthlyWizardTypes.length, urlYear, urlMonth, urlWizardType, urlStatus, hasAutoLoaded, filters, form]);

  const { data: employersWithUploads = [], isLoading, error } = useQuery<EmployerWithUploads[]>({
    queryKey: ["/api/wizards/employer-monthly/employers", filters],
    queryFn: async () => {
      if (!filters) return [];
      const params = new URLSearchParams({
        year: filters.year.toString(),
        month: filters.month.toString(),
        wizardType: filters.wizardType,
      });
      const response = await fetch(`/api/wizards/employer-monthly/employers?${params}`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
        throw new Error(errorData.message || `Failed to fetch employers (${response.status})`);
      }
      return response.json();
    },
    enabled: filters !== null,
  });

  const handleApplyFilters = (data: FilterFormData) => {
    setFilters(data);
    // Update URL with filter params
    const params = new URLSearchParams({
      year: data.year.toString(),
      month: data.month.toString(),
      wizardType: data.wizardType,
    });
    if (data.status) {
      params.set('status', data.status);
    }
    setLocation(`/employers/monthly-uploads?${params.toString()}`);
  };

  const yearOptions = generateYearOptions();
  const monthOptions = generateMonthOptions();

  const selectedWizardType = wizardTypes.find(wt => wt.name === filters?.wizardType);
  const monthPeriods = filters ? calculateMonthPeriods(filters.year, filters.month) : [];

  // Apply client-side status filtering
  const filteredEmployersWithUploads = filters?.status 
    ? employersWithUploads.filter(emp => {
        if (filters.status === 'no_upload') {
          // For no_upload, show employers with no uploads
          return emp.uploads.length === 0;
        }
        // For other statuses, check if any upload has that status
        return emp.uploads.some(upload => upload.status === filters.status);
      })
    : employersWithUploads;

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2" data-testid="text-page-title">
          Monthly Uploads
        </h1>
        <p className="text-muted-foreground" data-testid="text-page-description">
          View all employers and their monthly wizard uploads across a 5-month period
        </p>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Select Period and Upload Type</CardTitle>
          <CardDescription>Choose a year, month, and wizard type to view uploads for the 5-month period</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleApplyFilters)} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <FormField
                  control={form.control}
                  name="year"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Year</FormLabel>
                      <Select 
                        value={field.value?.toString()} 
                        onValueChange={(value) => field.onChange(Number(value))}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-year">
                            <SelectValue placeholder="Select year" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {yearOptions.map((year) => (
                            <SelectItem key={year} value={year.toString()} data-testid={`select-option-year-${year}`}>
                              {year}
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
                  name="month"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Month</FormLabel>
                      <Select 
                        value={field.value?.toString()} 
                        onValueChange={(value) => field.onChange(Number(value))}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-month">
                            <SelectValue placeholder="Select month" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {monthOptions.map((month) => (
                            <SelectItem key={month.value} value={month.value.toString()} data-testid={`select-option-month-${month.value}`}>
                              {month.label}
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
                  name="wizardType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Upload Type</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger data-testid="select-wizard-type">
                            <SelectValue placeholder="Select wizard type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {monthlyWizardTypes.map((wizardType) => (
                            <SelectItem 
                              key={wizardType.name} 
                              value={wizardType.name}
                              data-testid={`select-option-${wizardType.name}`}
                            >
                              {wizardType.displayName}
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
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status (Optional)</FormLabel>
                      <Select 
                        value={field.value || "all"} 
                        onValueChange={(value) => field.onChange(value === "all" ? undefined : value)}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-status">
                            <SelectValue placeholder="All statuses" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="all" data-testid="select-option-all-statuses">
                            All statuses
                          </SelectItem>
                          <SelectItem value="completed" data-testid="select-option-completed">
                            Completed
                          </SelectItem>
                          <SelectItem value="in_progress" data-testid="select-option-in-progress">
                            In Progress
                          </SelectItem>
                          <SelectItem value="draft" data-testid="select-option-draft">
                            Draft
                          </SelectItem>
                          <SelectItem value="no_upload" data-testid="select-option-no-upload">
                            No Upload
                          </SelectItem>
                          <SelectItem value="error" data-testid="select-option-error">
                            Error
                          </SelectItem>
                          <SelectItem value="cancelled" data-testid="select-option-cancelled">
                            Cancelled
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <Button 
                type="submit" 
                data-testid="button-apply-filters"
                disabled={!form.watch('wizardType') || monthlyWizardTypes.length === 0}
              >
                View Uploads
              </Button>
              {monthlyWizardTypes.length === 0 && (
                <p className="text-sm text-muted-foreground mt-2">
                  No monthly wizard types available
                </p>
              )}
            </form>
          </Form>
        </CardContent>
      </Card>

      {filters && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-muted-foreground" />
              {selectedWizardType?.displayName} - 5-Month View
            </CardTitle>
            <CardDescription>
              Showing uploads from {monthPeriods[0]?.label} to {monthPeriods[4]?.label}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error ? (
              <div className="text-center py-8 text-destructive" data-testid="text-error">
                <p className="font-medium">Error loading data</p>
                <p className="text-sm mt-1">{error instanceof Error ? error.message : 'Unknown error occurred'}</p>
              </div>
            ) : isLoading ? (
              <div className="text-center py-8 text-muted-foreground" data-testid="text-loading">
                Loading employers and uploads...
              </div>
            ) : filteredEmployersWithUploads.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground" data-testid="text-no-employers">
                <Building2 className="h-12 w-12 mx-auto mb-2 opacity-20" />
                <p>No employers found{filters?.status ? ` with status "${filters.status}"` : ''}</p>
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[250px] font-semibold" data-testid="table-header-employer">
                        Employer
                      </TableHead>
                      {monthPeriods.map((period, idx) => (
                        <TableHead 
                          key={`${period.year}-${period.month}`} 
                          className="text-center font-semibold"
                          data-testid={`table-header-month-${idx}`}
                        >
                          {period.label}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredEmployersWithUploads.map(({ employer, uploads }) => (
                      <TableRow key={employer.id} data-testid={`table-row-${employer.id}`}>
                        <TableCell className="font-medium">
                          <div 
                            className="cursor-pointer hover:underline"
                            onClick={() => setLocation(`/employers/${employer.id}`)}
                            data-testid={`text-employer-name-${employer.id}`}
                          >
                            {employer.name}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            ID: {employer.siriusId}
                            {!employer.isActive && <span className="ml-2">(Inactive)</span>}
                          </div>
                        </TableCell>
                        {monthPeriods.map((period) => {
                          const monthUploads = uploads.filter(
                            u => u.year === period.year && u.month === period.month
                          );
                          
                          return (
                            <TableCell 
                              key={`${employer.id}-${period.year}-${period.month}`}
                              className="text-center align-top p-2"
                              data-testid={`table-cell-${employer.id}-${period.year}-${period.month}`}
                            >
                              {monthUploads.length === 0 ? (
                                <span className="text-xs text-muted-foreground">—</span>
                              ) : (
                                <div className="space-y-1">
                                  {monthUploads.map((upload) => (
                                    <div
                                      key={upload.id}
                                      className="text-xs cursor-pointer hover:underline p-1 rounded hover:bg-muted"
                                      onClick={() => setLocation(`/wizards/${upload.id}`)}
                                      data-testid={`upload-link-${upload.id}`}
                                    >
                                      <div className="font-medium">{upload.status}</div>
                                      {upload.currentStep && (
                                        <div className="text-muted-foreground">{upload.currentStep}</div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
