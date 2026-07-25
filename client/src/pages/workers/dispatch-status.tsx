import { useQuery, useMutation } from "@tanstack/react-query";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest, ApiError } from "@/lib/queryClient";
import { useState } from "react";
import { format } from "date-fns";
import { Calendar, Truck, Edit, Save, X, ClipboardList, HardHat, ExternalLink, Clock, DollarSign, Building2 } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { formatYmd } from "@shared/utils/date";
import type { WorkerDispatchStatus } from "@shared/schema";
import type { DispatchWithRelations } from "../../../../server/storage/dispatch/dispatches";
import type { DispatchJobForeWithJob } from "../../../../server/storage/dispatch/fore";

interface ComponentConfig {
  componentId: string;
  enabled: boolean;
}

function formatTime12h(time: string): string {
  const [hStr, mStr] = time.split(":");
  let h = parseInt(hStr, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${mStr} ${ampm}`;
}

function AcceptedDispatchesSection({ workerId }: { workerId: string }) {
  const { data: componentConfigs = [] } = useQuery<{ componentId: string; enabled: boolean }[]>({
    queryKey: ["/api/components/config"],
  });

  const departmentComponentEnabled = componentConfigs.some(
    (c) => c.componentId === "dispatch.department" && c.enabled,
  );

  const { data: dispatches, isLoading } = useQuery<DispatchWithRelations[]>({
    queryKey: ["/api/dispatches/worker", workerId],
    queryFn: async () => {
      const response = await fetch(`/api/dispatches/worker/${workerId}`);
      if (!response.ok) {
        throw new Error("Failed to fetch dispatches");
      }
      return response.json();
    },
  });

  const accepted = (dispatches || [])
    .filter((d) => d.status === "accepted")
    .sort((a, b) => (a.isPrimary === b.isPrimary ? 0 : a.isPrimary ? -1 : 1));

  const acceptedJobIdsKey = Array.from(new Set(accepted.map((d) => d.job?.id).filter(Boolean))).join(",");
  const { data: jobDepartments = {} } = useQuery<Record<string, { departmentId: string; departmentName: string | null }>>({
    queryKey: ["/api/dispatch-job-departments", { jobIds: acceptedJobIdsKey }],
    queryFn: async () => {
      const res = await fetch(`/api/dispatch-job-departments?jobIds=${encodeURIComponent(acceptedJobIdsKey)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch job departments");
      return res.json();
    },
    enabled: departmentComponentEnabled && acceptedJobIdsKey.length > 0,
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5" />
          <CardTitle>Accepted Dispatches</CardTitle>
        </div>
        <CardDescription>
          Jobs this worker is currently dispatched to.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : accepted.length === 0 ? (
          <p className="text-muted-foreground text-sm" data-testid="text-no-accepted-dispatches">
            No accepted dispatches right now.
          </p>
        ) : (
          <div className="space-y-3" data-testid="list-accepted-dispatches">
            {accepted.map((dispatch) => (
              <div
                key={dispatch.id}
                className="border rounded-lg p-4 space-y-3"
                data-testid={`card-dispatch-${dispatch.id}`}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium" data-testid={`text-dispatch-job-title-${dispatch.id}`}>
                        {dispatch.job?.title || "Unknown Job"}
                      </span>
                      {dispatch.isPrimary && (
                        <Badge data-testid={`badge-primary-${dispatch.id}`}>Primary</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Building2 className="h-4 w-4" />
                      <span data-testid={`text-dispatch-employer-${dispatch.id}`}>
                        {dispatch.job?.employer?.name || "Unknown Employer"}
                      </span>
                    </div>
                  </div>
                  <Link
                    href={`/dispatch/${dispatch.id}`}
                    className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                    data-testid={`link-dispatch-${dispatch.id}`}
                  >
                    View Dispatch
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2 text-sm">
                  {dispatch.job?.startYmd && (
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Job Start:</span>
                      <span data-testid={`text-dispatch-job-start-${dispatch.id}`}>
                        {formatYmd(dispatch.job.startYmd, "long")}
                      </span>
                    </div>
                  )}
                  {(dispatch.job?.startTime || dispatch.job?.endTime) && (
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Hours:</span>
                      <span data-testid={`text-dispatch-hours-${dispatch.id}`}>
                        {dispatch.job?.startTime ? formatTime12h(dispatch.job.startTime) : "—"}
                        {" – "}
                        {dispatch.job?.endTime ? formatTime12h(dispatch.job.endTime) : "—"}
                      </span>
                    </div>
                  )}
                  {departmentComponentEnabled && dispatch.job?.id && jobDepartments[dispatch.job.id]?.departmentName && (
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Department:</span>
                      <span data-testid={`text-dispatch-department-${dispatch.id}`}>
                        {jobDepartments[dispatch.job.id]?.departmentName}
                      </span>
                    </div>
                  )}
                  {dispatch.job?.payRate != null && (
                    <div className="flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Pay Rate:</span>
                      <span data-testid={`text-dispatch-payrate-${dispatch.id}`}>
                        ${parseFloat(dispatch.job.payRate).toFixed(2)}
                      </span>
                    </div>
                  )}
                  {dispatch.startDate && (
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Dispatch Start:</span>
                      <span data-testid={`text-dispatch-start-${dispatch.id}`}>
                        {format(new Date(dispatch.startDate), "MMMM d, yyyy")}
                      </span>
                    </div>
                  )}
                  {dispatch.endDate && (
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Dispatch End:</span>
                      <span data-testid={`text-dispatch-end-${dispatch.id}`}>
                        {format(new Date(dispatch.endDate), "MMMM d, yyyy")}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ForepersonJobsSection({ workerId }: { workerId: string }) {
  const { data: foreJobs, isLoading } = useQuery<DispatchJobForeWithJob[]>({
    queryKey: ["/api/workers", workerId, "dispatch-fore"],
    queryFn: async () => {
      const response = await fetch(`/api/workers/${workerId}/dispatch-fore`);
      if (!response.ok) {
        throw new Error("Failed to fetch foreperson jobs");
      }
      return response.json();
    },
  });

  // Most workers are not forepersons: render nothing while loading and when
  // there are no rows, so the card only appears when there is something to show.
  if (isLoading || !foreJobs || foreJobs.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <HardHat className="h-5 w-5" />
          <CardTitle>Foreperson Jobs</CardTitle>
        </div>
        <CardDescription>
          Jobs where this worker is designated as a Foreperson.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2" data-testid="list-foreperson-jobs">
            {foreJobs.map((fore) => (
              <div
                key={fore.id}
                className="border rounded-lg p-3 flex items-center justify-between gap-3 flex-wrap"
                data-testid={`card-foreperson-job-${fore.id}`}
              >
                <div className="space-y-1">
                  <p className="font-medium" data-testid={`text-fore-job-title-${fore.id}`}>
                    {fore.job?.title || "Unknown Job"}
                  </p>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                    <span className="flex items-center gap-1.5">
                      <Building2 className="h-3.5 w-3.5" />
                      <span data-testid={`text-fore-employer-${fore.id}`}>
                        {fore.job?.employer?.name || "Unknown Employer"}
                      </span>
                    </span>
                    {fore.job?.startYmd && (
                      <span className="flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5" />
                        <span data-testid={`text-fore-job-start-${fore.id}`}>
                          {formatYmd(fore.job.startYmd, "long")}
                        </span>
                      </span>
                    )}
                  </div>
                </div>
                <Link
                  href={`/dispatch/job/${fore.jobId}`}
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                  data-testid={`link-fore-job-${fore.id}`}
                >
                  View Job
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function DispatchStatusContent() {
  const { worker } = useWorkerLayout();
  const { toast } = useToast();
  const { hasPermission } = useAuth();
  const isStaff = hasPermission("staff");

  const [isEditingStatus, setIsEditingStatus] = useState(false);
  const [isEditingSeniority, setIsEditingSeniority] = useState(false);
  const [editStatus, setEditStatus] = useState<string>("available");
  const [editSeniorityDate, setEditSeniorityDate] = useState<string>("");

  const { data: dispatchStatus, isLoading } = useQuery<WorkerDispatchStatus>({
    queryKey: ["/api/worker-dispatch-status/worker", worker.id],
    queryFn: async () => {
      const response = await fetch(`/api/worker-dispatch-status/worker/${worker.id}`);
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error("Failed to fetch dispatch status");
      }
      return response.json();
    },
  });

  const statusMutation = useMutation({
    mutationFn: async (status: string) => {
      return apiRequest("PUT", `/api/worker-dispatch-status/worker/${worker.id}/status`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-dispatch-status/worker", worker.id] });
      toast({ title: "Status updated", description: "Dispatch status has been saved." });
      setIsEditingStatus(false);
    },
    onError: (error) => {
      const serverMessage = error instanceof ApiError && typeof error.data?.error === "string" ? error.data.error : undefined;
      toast({
        title: serverMessage && error instanceof ApiError && error.status === 409 ? "Not allowed" : "Error",
        description: serverMessage || "Failed to update dispatch status.",
        variant: "destructive",
      });
    },
  });

  const seniorityMutation = useMutation({
    mutationFn: async (seniorityDate: string | null) => {
      return apiRequest("PUT", `/api/worker-dispatch-status/worker/${worker.id}/seniority-date`, { seniorityDate });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-dispatch-status/worker", worker.id] });
      toast({ title: "Seniority date updated", description: "The seniority date has been saved." });
      setIsEditingSeniority(false);
    },
    onError: (error) => {
      const serverMessage = error instanceof ApiError && typeof error.data?.error === "string" ? error.data.error : undefined;
      toast({
        title: serverMessage && error instanceof ApiError && error.status === 409 ? "Not allowed" : "Error",
        description: serverMessage || "Failed to update seniority date.",
        variant: "destructive",
      });
    },
  });

  const handleEditStatus = () => {
    setEditStatus(dispatchStatus?.status || "available");
    setIsEditingStatus(true);
  };

  const handleSaveStatus = () => {
    statusMutation.mutate(editStatus);
  };

  const handleEditSeniority = () => {
    setEditSeniorityDate(
      dispatchStatus?.seniorityDate
        ? format(new Date(dispatchStatus.seniorityDate), "yyyy-MM-dd'T'HH:mm:ss")
        : ""
    );
    setIsEditingSeniority(true);
  };

  const handleSaveSeniority = () => {
    if (!editSeniorityDate) {
      seniorityMutation.mutate(null);
      return;
    }
    const isoString = new Date(editSeniorityDate).toISOString();
    seniorityMutation.mutate(isoString);
  };

  const { data: componentConfigs = [] } = useQuery<ComponentConfig[]>({
    queryKey: ["/api/components/config"],
  });

  const foreComponentEnabled = componentConfigs.some(
    (c) => c.componentId === "dispatch.fore" && c.enabled
  );

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64 mt-2" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  const statusBadgeVariant = dispatchStatus?.status === "available" ? "default" : "secondary";

  return (
    <div className="space-y-6">
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Truck className="h-5 w-5" />
          <CardTitle>Dispatch Status</CardTitle>
        </div>
        <CardDescription>
          Manage dispatch availability and seniority date.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <Label className="text-muted-foreground text-sm">Status</Label>
            {!isEditingStatus && (
              <Button variant="outline" size="sm" onClick={handleEditStatus} data-testid="button-edit-status">
                <Edit className="h-4 w-4 mr-2" />
                Edit
              </Button>
            )}
          </div>
          {isEditingStatus ? (
            <div className="space-y-3">
              <Select value={editStatus} onValueChange={setEditStatus}>
                <SelectTrigger data-testid="select-dispatch-status">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="available">Available</SelectItem>
                  <SelectItem value="not_available">Not Available</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSaveStatus} disabled={statusMutation.isPending} data-testid="button-save-status">
                  <Save className="h-4 w-4 mr-2" />
                  {statusMutation.isPending ? "Saving..." : "Save"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setIsEditingStatus(false)} disabled={statusMutation.isPending} data-testid="button-cancel-status">
                  <X className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div>
              {dispatchStatus ? (
                <Badge variant={statusBadgeVariant} data-testid="badge-dispatch-status">
                  {dispatchStatus.status === "available" ? "Available" : "Not Available"}
                </Badge>
              ) : (
                <span className="text-muted-foreground" data-testid="text-no-status">Not set</span>
              )}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <Label className="text-muted-foreground text-sm">Last Offer Date</Label>
            {!isEditingSeniority && isStaff && (
              <Button variant="outline" size="sm" onClick={handleEditSeniority} data-testid="button-edit-seniority">
                <Edit className="h-4 w-4 mr-2" />
                Edit
              </Button>
            )}
          </div>
          {isEditingSeniority ? (
            <div className="space-y-3">
              <Input
                type="datetime-local"
                step="1"
                value={editSeniorityDate}
                onChange={(e) => setEditSeniorityDate(e.target.value)}
                data-testid="input-seniority-date"
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSaveSeniority} disabled={seniorityMutation.isPending} data-testid="button-save-seniority">
                  <Save className="h-4 w-4 mr-2" />
                  {seniorityMutation.isPending ? "Saving..." : "Save"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setIsEditingSeniority(false)} disabled={seniorityMutation.isPending} data-testid="button-cancel-seniority">
                  <X className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2" data-testid="text-seniority-date">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              {dispatchStatus?.seniorityDate ? (
                <span>{format(new Date(dispatchStatus.seniorityDate), "MMMM d, yyyy h:mm:ss a")}</span>
              ) : (
                <span className="text-muted-foreground">Not set</span>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>

    <AcceptedDispatchesSection workerId={worker.id} />

    {foreComponentEnabled && <ForepersonJobsSection workerId={worker.id} />}
    </div>
  );
}

export default function WorkerDispatchStatusPage() {
  return (
    <WorkerLayout activeTab="dispatch-status">
      <DispatchStatusContent />
    </WorkerLayout>
  );
}
