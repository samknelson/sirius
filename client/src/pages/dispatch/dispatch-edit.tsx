import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { DispatchLayout, useDispatchLayout } from "@/components/layouts/DispatchLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Save, Loader2 } from "lucide-react";

function DispatchEditContent() {
  const { dispatch } = useDispatchLayout();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const formatDateForInput = (date: string | Date | null): string => {
    if (!date) return "";
    if (typeof date === "string") return date.split("T")[0];
    return date.toISOString().split("T")[0];
  };
  const [startDate, setStartDate] = useState(formatDateForInput(dispatch.startDate));
  const [endDate, setEndDate] = useState(formatDateForInput(dispatch.endDate));

  const updateMutation = useMutation({
    mutationFn: async (data: { startDate: string | null; endDate: string | null }) => {
      return apiRequest("PUT", `/api/dispatches/${dispatch.id}`, data);
    },
    onSuccess: () => {
      toast({
        title: "Dispatch Updated",
        description: "The dispatch has been updated successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/dispatches", dispatch.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/dispatches/job", dispatch.jobId] });
      setLocation(`/dispatch/${dispatch.id}`);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update the dispatch. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate({
      startDate: startDate || null,
      endDate: endDate || null,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle data-testid="title-edit-dispatch">Edit Dispatch</CardTitle>
        <CardDescription data-testid="text-edit-description">
          Update the dispatch dates
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="startDate">Start Date</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                data-testid="input-start-date"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endDate">End Date</Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                data-testid="input-end-date"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setLocation(`/dispatch/${dispatch.id}`)}
              data-testid="button-cancel"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={updateMutation.isPending} data-testid="button-save">
              {updateMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save Changes
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export default function DispatchEditPage() {
  return (
    <DispatchLayout activeTab="edit">
      <DispatchEditContent />
    </DispatchLayout>
  );
}
