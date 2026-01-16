import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useState, useEffect } from "react";
import { Award, ArrowLeft, Save, Loader2 } from "lucide-react";
import { Link } from "wouter";
import type { WorkerCertification, OptionsCertification } from "@shared/schema";

interface WorkerCertificationWithDetails extends WorkerCertification {
  certification?: OptionsCertification | null;
}

interface WorkerCertificationViewProps {
  defaultTab?: "view" | "edit";
}

const statusColors: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  granted: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  revoked: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  expired: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
};

export default function WorkerCertificationView({ defaultTab = "view" }: WorkerCertificationViewProps) {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('staff');
  
  const [activeTab, setActiveTab] = useState(defaultTab);
  const [formStartDate, setFormStartDate] = useState<string>("");
  const [formEndDate, setFormEndDate] = useState<string>("");
  const [formStatus, setFormStatus] = useState<string>("pending");
  const [formMessage, setFormMessage] = useState<string>("");

  const { data: certification, isLoading, error } = useQuery<WorkerCertificationWithDetails>({
    queryKey: ["/api/worker-certifications", id],
  });

  useEffect(() => {
    if (certification) {
      setFormStartDate(certification.startDate || "");
      setFormEndDate(certification.endDate || "");
      setFormStatus(certification.status || "pending");
    }
  }, [certification]);

  const updateMutation = useMutation({
    mutationFn: async (data: { 
      startDate?: string | null;
      endDate?: string | null;
      status?: string;
      message?: string 
    }) => {
      return apiRequest("PATCH", `/api/worker-certifications/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-certifications", id] });
      if (certification?.workerId) {
        queryClient.invalidateQueries({ queryKey: ["/api/worker-certifications/worker", certification.workerId] });
      }
      toast({
        title: "Certification updated",
        description: "The certification has been updated successfully.",
      });
      setActiveTab("view");
      setFormMessage("");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update certification.",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    updateMutation.mutate({
      startDate: formStartDate || null,
      endDate: formEndDate || null,
      status: formStatus,
      message: formMessage || undefined,
    });
  };

  const formatDate = (date: string | null) => {
    if (!date) return "-";
    return new Date(date).toLocaleDateString();
  };

  if (isLoading) {
    return (
      <div className="container mx-auto py-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !certification) {
    return (
      <div className="container mx-auto py-6">
        <Card>
          <CardHeader>
            <CardTitle>Error</CardTitle>
            <CardDescription>
              {error instanceof Error ? error.message : "Certification not found"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => window.history.back()} data-testid="button-go-back">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Go Back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center gap-4">
        <Link href={`/workers/${certification.workerId}/certifications`}>
          <Button variant="ghost" size="icon" data-testid="button-back-to-worker">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Award className="h-6 w-6" />
            {certification.certification?.name || "Certification Details"}
          </h1>
          <p className="text-muted-foreground">View and manage certification details</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "view" | "edit")}>
            <TabsList data-testid="tabs-certification">
              <TabsTrigger value="view" data-testid="tab-view">View</TabsTrigger>
              {canEdit && <TabsTrigger value="edit" data-testid="tab-edit">Edit</TabsTrigger>}
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent>
          {activeTab === "view" ? (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <Label className="text-sm text-muted-foreground">Certification</Label>
                  <p className="text-lg font-medium" data-testid="text-certification-name">
                    {certification.certification?.name || "Unknown"}
                  </p>
                </div>
                <div>
                  <Label className="text-sm text-muted-foreground">Status</Label>
                  <div className="mt-1">
                    <Badge className={statusColors[certification.status] || ""} data-testid="text-certification-status">
                      {certification.status}
                    </Badge>
                  </div>
                </div>
                <div>
                  <Label className="text-sm text-muted-foreground">Start Date</Label>
                  <p className="text-lg font-medium" data-testid="text-start-date">
                    {formatDate(certification.startDate)}
                  </p>
                </div>
                <div>
                  <Label className="text-sm text-muted-foreground">End Date</Label>
                  <p className="text-lg font-medium" data-testid="text-end-date">
                    {formatDate(certification.endDate)}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="edit-startDate">Start Date</Label>
                  <Input
                    id="edit-startDate"
                    type="date"
                    value={formStartDate}
                    onChange={(e) => setFormStartDate(e.target.value)}
                    data-testid="input-edit-start-date"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-endDate">End Date</Label>
                  <Input
                    id="edit-endDate"
                    type="date"
                    value={formEndDate}
                    onChange={(e) => setFormEndDate(e.target.value)}
                    data-testid="input-edit-end-date"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-status">Status</Label>
                <Select value={formStatus} onValueChange={setFormStatus}>
                  <SelectTrigger data-testid="select-edit-status">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="granted">Granted</SelectItem>
                    <SelectItem value="revoked">Revoked</SelectItem>
                    <SelectItem value="expired">Expired</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-message">Update Message (optional)</Label>
                <Textarea
                  id="edit-message"
                  value={formMessage}
                  onChange={(e) => setFormMessage(e.target.value)}
                  placeholder="Explain why this certification is being updated..."
                  className="resize-none"
                  data-testid="input-edit-message"
                />
                <p className="text-xs text-muted-foreground">
                  This message will be included in the log entry
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setActiveTab("view");
                    if (certification) {
                      setFormStartDate(certification.startDate || "");
                      setFormEndDate(certification.endDate || "");
                      setFormStatus(certification.status || "pending");
                      setFormMessage("");
                    }
                  }}
                  data-testid="button-cancel-edit"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={updateMutation.isPending}
                  data-testid="button-save-edit"
                >
                  {updateMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-2" />
                      Save Changes
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
