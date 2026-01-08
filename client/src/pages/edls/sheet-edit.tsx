import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Save, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { EdlsSheetLayout, useEdlsSheetLayout } from "@/components/layouts/EdlsSheetLayout";
import type { InsertEdlsSheet } from "@shared/schema";

interface Employer {
  id: string;
  name: string;
}

function EdlsSheetEditContent() {
  const { sheet } = useEdlsSheetLayout();
  const { toast } = useToast();
  const [editData, setEditData] = useState<Partial<InsertEdlsSheet>>({
    title: sheet.title,
    date: sheet.date,
    workerCount: sheet.workerCount,
    employerId: sheet.employerId,
  });

  const { data: employers = [] } = useQuery<Employer[]>({
    queryKey: ["/api/employers"],
  });

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<InsertEdlsSheet>) => {
      return apiRequest("PUT", `/api/edls/sheets/${sheet.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/edls/sheets", sheet.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/edls/sheets"] });
      toast({
        title: "Sheet Updated",
        description: "The sheet has been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update sheet",
        variant: "destructive",
      });
    },
  });

  const handleReset = () => {
    setEditData({
      title: sheet.title,
      date: sheet.date,
      workerCount: sheet.workerCount,
      employerId: sheet.employerId,
    });
  };

  const handleSave = () => {
    if (!editData.title || !editData.employerId || !editData.date) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }
    updateMutation.mutate(editData);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Edit Sheet</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-title">Title</Label>
            <Input
              id="edit-title"
              data-testid="input-edit-title"
              value={editData.title || ""}
              onChange={(e) =>
                setEditData({ ...editData, title: e.target.value })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-employer">Employer</Label>
            <Select
              value={editData.employerId}
              onValueChange={(value) =>
                setEditData({ ...editData, employerId: value })
              }
            >
              <SelectTrigger data-testid="select-edit-employer">
                <SelectValue placeholder="Select an employer" />
              </SelectTrigger>
              <SelectContent>
                {employers.map((employer) => (
                  <SelectItem key={employer.id} value={employer.id}>
                    {employer.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-date">Date</Label>
            <Input
              id="edit-date"
              type="date"
              data-testid="input-edit-date"
              value={editData.date as string}
              onChange={(e) =>
                setEditData({ ...editData, date: e.target.value })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-worker-count">Worker Count</Label>
            <Input
              id="edit-worker-count"
              type="number"
              data-testid="input-edit-worker-count"
              value={editData.workerCount || 0}
              onChange={(e) =>
                setEditData({
                  ...editData,
                  workerCount: parseInt(e.target.value) || 0,
                })
              }
              min={0}
            />
          </div>
          <div className="flex gap-2 pt-4">
            <Button
              onClick={handleSave}
              disabled={updateMutation.isPending}
              data-testid="button-save"
            >
              <Save className="h-4 w-4 mr-2" />
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
            <Button
              variant="outline"
              onClick={handleReset}
              data-testid="button-reset"
            >
              <X className="h-4 w-4 mr-2" />
              Reset
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function EdlsSheetEditPage() {
  return (
    <EdlsSheetLayout activeTab="edit">
      <EdlsSheetEditContent />
    </EdlsSheetLayout>
  );
}
