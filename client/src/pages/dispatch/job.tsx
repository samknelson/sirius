import { useState, Component, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { 
  Loader2, ArrowLeft, Save,
  Briefcase, Truck, HardHat, Wrench, Clock, Calendar,
  ClipboardList, Package, MapPin, Users,
  type LucideIcon
} from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";
import { dispatchJobStatusEnum, type Employer, type DispatchJobType } from "@shared/schema";
import type { DispatchJobWithRelations } from "../../../../server/storage/dispatch-jobs";

// Error boundary for catching render errors
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: { componentStack: string }) {
    console.error("[DispatchJobPage] Error caught by boundary:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="container mx-auto py-8">
          <Card>
            <CardContent className="py-12 text-center">
              <h2 className="text-xl font-semibold text-destructive mb-2">Something went wrong</h2>
              <p className="text-muted-foreground mb-4">
                {this.state.error?.message || "An unexpected error occurred"}
              </p>
              <pre className="text-left text-xs bg-muted p-4 rounded overflow-auto max-h-48">
                {this.state.error?.stack}
              </pre>
              <Link href="/dispatch/jobs">
                <Button variant="outline" className="mt-4">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to Jobs
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

const iconMap: Record<string, LucideIcon> = {
  Briefcase, Truck, HardHat, Wrench, Clock, Calendar,
  ClipboardList, Package, MapPin, Users,
};

const statusColors: Record<string, string> = {
  draft: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
  open: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  running: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  closed: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  archived: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300",
};

const formSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  employerId: z.string().min(1, "Employer is required"),
  jobTypeId: z.string().min(1, "Job type is required"),
  status: z.enum(dispatchJobStatusEnum),
  startDate: z.string().min(1, "Start date is required"),
});

type FormData = z.infer<typeof formSchema>;

function DispatchJobPageInner() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const isNew = !id || id === "new";
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<string>("view");
  
  console.log("[DispatchJobPage] Rendering with id:", id, "isNew:", isNew);

  const { data: employers = [] } = useQuery<Employer[]>({
    queryKey: ["/api/employers"],
  });

  const { data: jobTypes = [] } = useQuery<DispatchJobType[]>({
    queryKey: ["/api/dispatch-job-types"],
  });

  const { data: job, isLoading } = useQuery<DispatchJobWithRelations>({
    queryKey: ["/api/dispatch-jobs", id],
    enabled: !isNew,
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      description: "",
      employerId: "",
      jobTypeId: "",
      status: "draft",
      startDate: format(new Date(), "yyyy-MM-dd"),
    },
    values: job ? {
      title: job.title,
      description: job.description || "",
      employerId: job.employerId,
      jobTypeId: job.jobTypeId || "",
      status: job.status as typeof dispatchJobStatusEnum[number],
      startDate: format(new Date(job.startDate), "yyyy-MM-dd"),
    } : undefined,
  });

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      return apiRequest("POST", "/api/dispatch-jobs", {
        ...data,
        jobTypeId: data.jobTypeId || null,
        startDate: new Date(data.startDate).toISOString(),
      });
    },
    onSuccess: (newJob) => {
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch-jobs"] });
      toast({
        title: "Success",
        description: "Dispatch job created successfully.",
      });
      navigate(`/dispatch/job/${newJob.id}`);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create dispatch job.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: FormData) => {
      return apiRequest("PUT", `/api/dispatch-jobs/${id}`, {
        ...data,
        jobTypeId: data.jobTypeId || null,
        startDate: new Date(data.startDate).toISOString(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch-jobs", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch-jobs"] });
      toast({
        title: "Success",
        description: "Dispatch job updated successfully.",
      });
      setActiveTab("view");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update dispatch job.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: FormData) => {
    if (isNew) {
      createMutation.mutate(data);
    } else {
      updateMutation.mutate(data);
    }
  };

  if (!isNew && isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" data-testid="loading-spinner" />
      </div>
    );
  }

  if (!isNew && !job) {
    return (
      <div className="container mx-auto py-8">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground" data-testid="text-not-found">
              Dispatch job not found.
            </p>
            <Link href="/dispatch/jobs">
              <Button variant="outline" className="mt-4" data-testid="button-back">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Jobs
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const jobTypeData = job?.jobType?.data as { icon?: string } | null;
  const IconComponent = jobTypeData?.icon ? iconMap[jobTypeData.icon] || Briefcase : Briefcase;

  const renderForm = () => (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Title *</FormLabel>
              <FormControl>
                <Input
                  placeholder="Job title"
                  data-testid="input-title"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Job description"
                  rows={4}
                  data-testid="input-description"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="employerId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Employer *</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger data-testid="select-employer">
                      <SelectValue placeholder="Select employer" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {employers.map((employer) => (
                      <SelectItem key={employer.id} value={employer.id}>
                        {employer.name}
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
            name="jobTypeId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Job Type *</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger data-testid="select-jobtype">
                      <SelectValue placeholder="Select job type" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {jobTypes.map((type) => (
                      <SelectItem key={type.id} value={type.id}>
                        {type.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="status"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Status *</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger data-testid="select-status">
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {dispatchJobStatusEnum.map((status) => (
                      <SelectItem key={status} value={status}>
                        <span className="capitalize">{status}</span>
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
            name="startDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Start Date *</FormLabel>
                <FormControl>
                  <Input
                    type="date"
                    data-testid="input-start-date"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="flex gap-2">
          <Button
            type="submit"
            disabled={createMutation.isPending || updateMutation.isPending}
            data-testid="button-save"
          >
            {(createMutation.isPending || updateMutation.isPending) && (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            )}
            <Save className="h-4 w-4 mr-2" />
            {isNew ? "Create Job" : "Save Changes"}
          </Button>
          {!isNew && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setActiveTab("view")}
              data-testid="button-cancel"
            >
              Cancel
            </Button>
          )}
        </div>
      </form>
    </Form>
  );

  const renderView = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-muted-foreground">Title</label>
            <p className="text-lg" data-testid="view-title">{job?.title}</p>
          </div>
          
          <div>
            <label className="text-sm font-medium text-muted-foreground">Description</label>
            <p data-testid="view-description">{job?.description || "—"}</p>
          </div>
          
          <div>
            <label className="text-sm font-medium text-muted-foreground">Employer</label>
            <p data-testid="view-employer">
              {job?.employer ? (
                <Link href={`/employers/${job.employer.id}`}>
                  <span className="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer">
                    {job.employer.name}
                  </span>
                </Link>
              ) : "—"}
            </p>
          </div>
        </div>
        
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-muted-foreground">Job Type</label>
            <p data-testid="view-jobtype">
              {job?.jobType ? (
                <span className="flex items-center gap-2">
                  <IconComponent className="h-4 w-4 text-muted-foreground" />
                  {job.jobType.name}
                </span>
              ) : "—"}
            </p>
          </div>
          
          <div>
            <label className="text-sm font-medium text-muted-foreground">Status</label>
            <p data-testid="view-status">
              <Badge 
                variant="secondary"
                className={statusColors[job?.status || "draft"] || ""}
              >
                <span className="capitalize">{job?.status}</span>
              </Badge>
            </p>
          </div>
          
          <div>
            <label className="text-sm font-medium text-muted-foreground">Start Date</label>
            <p data-testid="view-start-date">
              {job?.startDate ? format(new Date(job.startDate), "MMMM d, yyyy") : "—"}
            </p>
          </div>
          
          <div>
            <label className="text-sm font-medium text-muted-foreground">Created</label>
            <p data-testid="view-created">
              {job?.createdAt ? format(new Date(job.createdAt), "MMMM d, yyyy 'at' h:mm a") : "—"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="container mx-auto py-8">
      <div className="mb-4">
        <Link href="/dispatch/jobs">
          <Button variant="ghost" size="sm" data-testid="button-back">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Jobs
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle data-testid="title-page">
            {isNew ? "New Dispatch Job" : job?.title}
          </CardTitle>
          {!isNew && (
            <CardDescription>
              View and manage dispatch job details
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {isNew ? (
            renderForm()
          ) : (
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList>
                <TabsTrigger value="view" data-testid="tab-view">View</TabsTrigger>
                <TabsTrigger value="edit" data-testid="tab-edit">Edit</TabsTrigger>
              </TabsList>
              <TabsContent value="view" className="pt-4">
                {renderView()}
              </TabsContent>
              <TabsContent value="edit" className="pt-4">
                {renderForm()}
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function DispatchJobPage() {
  return (
    <ErrorBoundary>
      <DispatchJobPageInner />
    </ErrorBoundary>
  );
}
