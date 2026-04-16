import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import type { DispatchJobGroup } from "@shared/schema";

export default function DispatchJobGroupNewPage() {
  usePageTitle("New Job Group");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [formData, setFormData] = useState({
    name: "",
    startYmd: "",
    endYmd: "",
    siriusId: "",
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const payload = {
        name: data.name,
        startYmd: data.startYmd,
        endYmd: data.endYmd,
        siriusId: data.siriusId || null,
      };
      return apiRequest("POST", "/api/dispatch-job-groups", payload);
    },
    onSuccess: async (response) => {
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch-job-groups"] });
      const group = response as DispatchJobGroup;
      toast({ title: "Job group created", description: "The job group has been created." });
      setLocation(`/dispatch/job_group/${group.id}`);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create", description: error?.message || "An error occurred", variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.startYmd || !formData.endYmd) {
      toast({ title: "Validation error", description: "Name, start date, and end date are required.", variant: "destructive" });
      return;
    }
    createMutation.mutate(formData);
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold" data-testid="heading-new-job-group">New Job Group</h1>
        <Link href="/dispatch/job_groups">
          <Button variant="ghost" size="sm" data-testid="button-back">
            <ArrowLeft size={16} className="mr-2" />
            Back to Job Groups
          </Button>
        </Link>
      </div>

      <Card data-testid="card-create">
        <CardHeader>
          <CardTitle>Create Job Group</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                data-testid="input-create-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="siriusId">Sirius ID</Label>
              <Input
                id="siriusId"
                value={formData.siriusId}
                onChange={(e) => setFormData((prev) => ({ ...prev, siriusId: e.target.value }))}
                placeholder="Optional external identifier"
                data-testid="input-create-sirius-id"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="startYmd">Start Date</Label>
                <Input
                  id="startYmd"
                  type="date"
                  value={formData.startYmd}
                  onChange={(e) => setFormData((prev) => ({ ...prev, startYmd: e.target.value }))}
                  data-testid="input-create-start-ymd"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="endYmd">End Date</Label>
                <Input
                  id="endYmd"
                  type="date"
                  value={formData.endYmd}
                  onChange={(e) => setFormData((prev) => ({ ...prev, endYmd: e.target.value }))}
                  data-testid="input-create-end-ymd"
                />
              </div>
            </div>
            <div className="flex gap-3 pt-4">
              <Button
                type="submit"
                disabled={createMutation.isPending || !formData.name}
                data-testid="button-create"
              >
                {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create Job Group
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setLocation("/dispatch/job_groups")}
                data-testid="button-cancel-create"
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
