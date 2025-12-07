import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PolicyLayout, usePolicyLayout } from "@/components/layouts/PolicyLayout";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

function PolicyEditContent() {
  const { policy } = usePolicyLayout();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const [editSiriusId, setEditSiriusId] = useState(policy.siriusId);
  const [editName, setEditName] = useState(policy.name || "");
  const [editData, setEditData] = useState(policy.data ? JSON.stringify(policy.data, null, 2) : "");

  const updateMutation = useMutation({
    mutationFn: async (data: { siriusId?: string; name?: string; data?: any }) => {
      return await apiRequest("PUT", `/api/policies/${policy.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies", policy.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/policies"] });
      toast({
        title: "Success",
        description: "Policy updated successfully!",
      });
      setLocation(`/policies/${policy.id}`);
    },
    onError: (error: any) => {
      const message = error.message || "Failed to update policy. Please try again.";
      toast({
        title: "Error",
        description: message,
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    if (!editSiriusId.trim()) {
      toast({
        title: "Validation Error",
        description: "Sirius ID is required.",
        variant: "destructive",
      });
      return;
    }

    let parsedData: any = undefined;
    if (editData.trim()) {
      try {
        parsedData = JSON.parse(editData);
      } catch (e) {
        toast({
          title: "Validation Error",
          description: "Data must be valid JSON.",
          variant: "destructive",
        });
        return;
      }
    }

    updateMutation.mutate({
      siriusId: editSiriusId.trim(),
      name: editName.trim() || undefined,
      data: parsedData,
    });
  };

  return (
    <Card>
      <CardContent className="space-y-6 pt-6">
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-3">Edit Policy</h3>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-sirius-id" className="text-sm font-medium text-foreground">
                Sirius ID *
              </Label>
              <Input
                id="edit-sirius-id"
                type="text"
                placeholder="Enter Sirius ID..."
                value={editSiriusId}
                onChange={(e) => setEditSiriusId(e.target.value)}
                className="w-full"
                data-testid="input-edit-sirius-id"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-name" className="text-sm font-medium text-foreground">
                Name
              </Label>
              <Input
                id="edit-name"
                type="text"
                placeholder="Enter policy name..."
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full"
                data-testid="input-edit-name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-data" className="text-sm font-medium text-foreground">
                Data (JSON)
              </Label>
              <Textarea
                id="edit-data"
                placeholder='{"key": "value"}'
                value={editData}
                onChange={(e) => setEditData(e.target.value)}
                rows={8}
                className="font-mono text-sm"
                data-testid="input-edit-data"
              />
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-border">
          <div className="flex items-center space-x-3 flex-wrap gap-2">
            <Link href={`/policies/${policy.id}`}>
              <Button variant="outline" data-testid="button-cancel-edit">
                Cancel
              </Button>
            </Link>
            <Button
              onClick={handleSave}
              disabled={updateMutation.isPending}
              data-testid="button-save-policy"
            >
              {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function PolicyEdit() {
  return (
    <PolicyLayout activeTab="edit">
      <PolicyEditContent />
    </PolicyLayout>
  );
}
