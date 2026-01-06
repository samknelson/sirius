import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { Loader2, Save } from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";
import { dispatchJobStatusEnum, type Employer, type DispatchJobType, type JobTypeData } from "@shared/schema";
import { DispatchJobLayout, useDispatchJobLayout } from "@/components/layouts/DispatchJobLayout";
import { useEffect, useMemo } from "react";

type FormData = {
  title: string;
  description?: string;
  employerId: string;
  jobTypeId: string;
  status: typeof dispatchJobStatusEnum[number];
  startDate: string;
  workerCount: string;
};

function DispatchJobEditContent() {
  const { job } = useDispatchJobLayout();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: employers = [] } = useQuery<Employer[]>({
    queryKey: ["/api/employers"],
  });

  const { data: jobTypes = [] } = useQuery<DispatchJobType[]>({
    queryKey: ["/api/dispatch-job-types"],
  });

  const form = useForm<FormData>({
    defaultValues: {
      title: job.title,
      description: job.description || "",
      employerId: job.employerId,
      jobTypeId: job.jobTypeId || "",
      status: job.status as typeof dispatchJobStatusEnum[number],
      startDate: format(new Date(job.startDate), "yyyy-MM-dd"),
      workerCount: job.workerCount?.toString() || "",
    },
  });

  const watchedJobTypeId = form.watch("jobTypeId");

  const selectedJobType = useMemo(() => {
    return jobTypes.find(jt => jt.id === watchedJobTypeId);
  }, [jobTypes, watchedJobTypeId]);

  const jobTypeData = selectedJobType?.data as JobTypeData | undefined;
  const minWorkers = jobTypeData?.minWorkers;
  const maxWorkers = jobTypeData?.maxWorkers;
  const isFixedWorkerCount = minWorkers !== undefined && maxWorkers !== undefined && minWorkers === maxWorkers;

  useEffect(() => {
    if (isFixedWorkerCount && minWorkers !== undefined) {
      form.setValue("workerCount", minWorkers.toString());
    }
  }, [isFixedWorkerCount, minWorkers, form]);

  const updateMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const workerCountNum = data.workerCount ? parseInt(data.workerCount, 10) : null;
      return apiRequest("PUT", `/api/dispatch-jobs/${job.id}`, {
        ...data,
        jobTypeId: data.jobTypeId || null,
        startDate: new Date(data.startDate).toISOString(),
        workerCount: workerCountNum,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch-jobs", job.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch-jobs"] });
      toast({
        title: "Success",
        description: "Dispatch job updated successfully.",
      });
      navigate(`/dispatch/job/${job.id}`);
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
    if (!data.title.trim()) {
      toast({ title: "Error", description: "Title is required", variant: "destructive" });
      return;
    }
    if (!data.employerId) {
      toast({ title: "Error", description: "Employer is required", variant: "destructive" });
      return;
    }
    if (!data.jobTypeId) {
      toast({ title: "Error", description: "Job type is required", variant: "destructive" });
      return;
    }
    if (!data.startDate) {
      toast({ title: "Error", description: "Start date is required", variant: "destructive" });
      return;
    }

    const workerCountNum = data.workerCount ? parseInt(data.workerCount, 10) : null;
    
    if (workerCountNum === null) {
      toast({ title: "Error", description: "Worker count is required", variant: "destructive" });
      return;
    }

    if (minWorkers !== undefined && workerCountNum < minWorkers) {
      toast({ title: "Error", description: `Worker count must be at least ${minWorkers}`, variant: "destructive" });
      return;
    }

    if (maxWorkers !== undefined && workerCountNum > maxWorkers) {
      toast({ title: "Error", description: `Worker count must be at most ${maxWorkers}`, variant: "destructive" });
      return;
    }

    updateMutation.mutate(data);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle data-testid="title-edit">Edit Job</CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title *</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Job title" data-testid="input-title" />
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
                      {...field}
                      placeholder="Job description"
                      className="min-h-[100px]"
                      data-testid="input-description"
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
                        {...field}
                        type="date"
                        data-testid="input-startdate"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {!isFixedWorkerCount ? (
              <FormField
                control={form.control}
                name="workerCount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Worker Count *
                      {minWorkers !== undefined && maxWorkers !== undefined && (
                        <span className="text-muted-foreground ml-2 font-normal">
                          ({minWorkers} - {maxWorkers})
                        </span>
                      )}
                      {minWorkers !== undefined && maxWorkers === undefined && (
                        <span className="text-muted-foreground ml-2 font-normal">
                          (min: {minWorkers})
                        </span>
                      )}
                      {minWorkers === undefined && maxWorkers !== undefined && (
                        <span className="text-muted-foreground ml-2 font-normal">
                          (max: {maxWorkers})
                        </span>
                      )}
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        min={minWorkers ?? 1}
                        max={maxWorkers}
                        placeholder="Number of workers"
                        data-testid="input-workercount"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : (
              <input type="hidden" {...form.register("workerCount")} />
            )}

            <div className="flex items-center gap-2 pt-4">
              <Button
                type="submit"
                disabled={updateMutation.isPending}
                data-testid="button-save"
              >
                {updateMutation.isPending && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                <Save className="h-4 w-4 mr-2" />
                Save Changes
              </Button>
              <Link href={`/dispatch/job/${job.id}`}>
                <Button
                  type="button"
                  variant="outline"
                  data-testid="button-cancel"
                >
                  Cancel
                </Button>
              </Link>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

export default function DispatchJobEditPage() {
  return (
    <DispatchJobLayout activeTab="edit">
      <DispatchJobEditContent />
    </DispatchJobLayout>
  );
}
