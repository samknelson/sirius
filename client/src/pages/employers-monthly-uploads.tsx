import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Calendar, FileText, Upload, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { useForm } from "react-hook-form";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

interface WizardType {
  name: string;
  displayName: string;
  description?: string;
  isMonthly?: boolean;
}

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

const filterSchema = z.object({
  year: z.coerce.number().int().min(1900).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  wizardType: z.string().min(1, "Please select an upload type"),
});

type FilterFormData = z.infer<typeof filterSchema>;

export default function EmployersMonthlyUploads() {
  const [, setLocation] = useLocation();
  const [filters, setFilters] = useState<FilterFormData | null>(null);

  const { data: wizardTypes = [] } = useQuery<WizardType[]>({
    queryKey: ["/api/wizard-types"],
  });

  const monthlyWizardTypes = wizardTypes.filter(wt => wt.isMonthly === true);
  
  const form = useForm<FilterFormData>({
    resolver: zodResolver(filterSchema),
    mode: "onChange",
    defaultValues: {
      year: new Date().getFullYear(),
      month: new Date().getMonth() + 1,
      wizardType: "",
    },
  });

  useEffect(() => {
    if (monthlyWizardTypes.length > 0 && !form.getValues('wizardType')) {
      form.setValue('wizardType', monthlyWizardTypes[0].name, { 
        shouldValidate: true 
      });
    }
  }, [monthlyWizardTypes.length]);

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
  };

  const yearOptions = generateYearOptions();
  const monthOptions = generateMonthOptions();

  const selectedWizardType = wizardTypes.find(wt => wt.name === filters?.wizardType);

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2" data-testid="text-page-title">
          Monthly Uploads
        </h1>
        <p className="text-muted-foreground" data-testid="text-page-description">
          View all employers and their monthly wizard uploads for a specific period
        </p>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Select Period and Upload Type</CardTitle>
          <CardDescription>Choose a year, month, and wizard type to view all employers with their uploads</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleApplyFilters)} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
              All Employers - {selectedWizardType?.displayName} ({format(new Date(filters.year, filters.month - 1), 'MMMM yyyy')})
            </CardTitle>
            <CardDescription>
              Showing all employers with their upload status for the selected period
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
            ) : employersWithUploads.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground" data-testid="text-no-employers">
                <Building2 className="h-12 w-12 mx-auto mb-2 opacity-20" />
                <p>No employers found</p>
              </div>
            ) : (
              <div className="space-y-3">
                {employersWithUploads.map(({ employer, uploads }) => (
                  <Card key={employer.id} data-testid={`employer-card-${employer.id}`}>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle 
                          className="text-lg cursor-pointer hover:underline"
                          onClick={() => setLocation(`/employers/${employer.id}`)}
                          data-testid={`text-employer-name-${employer.id}`}
                        >
                          {employer.name}
                        </CardTitle>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground" data-testid={`text-sirius-id-${employer.id}`}>
                            ID: {employer.siriusId}
                          </span>
                          {!employer.isActive && (
                            <span className="text-xs px-2 py-1 rounded bg-muted text-muted-foreground">
                              Inactive
                            </span>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {uploads.length === 0 ? (
                        <div className="text-sm text-muted-foreground py-2" data-testid={`text-no-uploads-${employer.id}`}>
                          <Upload className="h-8 w-8 mx-auto mb-1 opacity-20" />
                          <p className="text-center">No uploads for this period</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {uploads.map((upload) => (
                            <div
                              key={upload.id}
                              className="flex items-center justify-between p-3 border border-border rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                              onClick={() => setLocation(`/wizards/${upload.id}`)}
                              data-testid={`upload-item-${upload.id}`}
                            >
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <FileText className="h-4 w-4 text-muted-foreground" />
                                  <span className="text-sm font-medium" data-testid={`text-upload-id-${upload.id}`}>
                                    Upload ID: {upload.id.slice(0, 8)}...
                                  </span>
                                  <span 
                                    className="text-xs px-2 py-1 rounded bg-muted text-muted-foreground"
                                    data-testid={`text-status-${upload.id}`}
                                  >
                                    {upload.status}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                                  {upload.currentStep && (
                                    <>
                                      <span data-testid={`text-step-${upload.id}`}>
                                        Step: {upload.currentStep}
                                      </span>
                                      <span>•</span>
                                    </>
                                  )}
                                  <span data-testid={`text-created-${upload.id}`}>
                                    Created: {format(new Date(upload.createdAt), 'PPp')}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
