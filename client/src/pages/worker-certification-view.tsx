import { useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useState, useEffect } from "react";
import { Save, Loader2 } from "lucide-react";
import { useLocation } from "wouter";
import { WorkerCertificationLayout, useWorkerCertificationLayout } from "@/components/layouts/WorkerCertificationLayout";

const statusColors: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  granted: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  revoked: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  expired: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
};

function ViewContent() {
  const { certification } = useWorkerCertificationLayout();

  const formatDate = (date: string | null) => {
    if (!date) return "-";
    return new Date(date).toLocaleDateString();
  };

  return (
    <Card>
      <CardContent className="pt-6">
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
              <Label className="text-sm text-muted-foreground">Active</Label>
              <div className="mt-1">
                <Badge 
                  className={certification.denormActive 
                    ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" 
                    : "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200"
                  } 
                  data-testid="text-certification-active"
                >
                  {certification.denormActive ? "Active" : "Inactive"}
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
      </CardContent>
    </Card>
  );
}

function EditContent() {
  const { certification } = useWorkerCertificationLayout();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [formStartDate, setFormStartDate] = useState<string>("");
  const [formEndDate, setFormEndDate] = useState<string>("");
  const [formStatus, setFormStatus] = useState<string>("pending");
  const [formMessage, setFormMessage] = useState<string>("");

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
      return apiRequest("PATCH", `/api/worker-certifications/${certification.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-certifications", certification.id] });
      if (certification?.workerId) {
        queryClient.invalidateQueries({ queryKey: ["/api/worker-certifications/worker", certification.workerId] });
      }
      toast({
        title: "Certification updated",
        description: "The certification has been updated successfully.",
      });
      setLocation(`/worker-certification/${certification.id}`);
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

  const handleCancel = () => {
    setLocation(`/worker-certification/${certification.id}`);
  };

  return (
    <Card>
      <CardContent className="pt-6">
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
              onClick={handleCancel}
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
      </CardContent>
    </Card>
  );
}

interface WorkerCertificationViewProps {
  defaultTab?: "view" | "edit";
}

export default function WorkerCertificationView({ defaultTab = "view" }: WorkerCertificationViewProps) {
  return (
    <WorkerCertificationLayout activeTab={defaultTab}>
      {defaultTab === "view" ? <ViewContent /> : <EditContent />}
    </WorkerCertificationLayout>
  );
}
