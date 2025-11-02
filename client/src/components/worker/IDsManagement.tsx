import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Worker, formatSSN, unformatSSN } from "@shared/schema";
import { Loader2, Save, CreditCard } from "lucide-react";

interface IDsManagementProps {
  workerId: string;
}

export default function IDsManagement({ workerId }: IDsManagementProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editedSSN, setEditedSSN] = useState<string>("");
  const [isEditing, setIsEditing] = useState(false);

  // Fetch worker information
  const { data: worker, isLoading } = useQuery<Worker>({
    queryKey: ["/api/workers", workerId],
    queryFn: async () => {
      const response = await fetch(`/api/workers/${workerId}`);
      if (!response.ok) {
        throw new Error("Failed to fetch worker");
      }
      return response.json();
    },
    enabled: !!workerId,
  });

  // Update SSN mutation
  const updateSSNMutation = useMutation({
    mutationFn: async (ssn: string) => {
      // Unformat SSN before sending to backend
      const unformattedSSN = unformatSSN(ssn);
      return apiRequest("PUT", `/api/workers/${workerId}`, { ssn: unformattedSSN });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/workers", workerId] });
      setIsEditing(false);
      toast({
        title: "Success",
        description: "SSN updated successfully!",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update SSN. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleEdit = () => {
    setEditedSSN(formatSSN(worker?.ssn) || "");
    setIsEditing(true);
  };

  const handleSave = () => {
    const unformatted = unformatSSN(editedSSN);
    // Validate SSN format (9 digits)
    if (unformatted.length === 9 && /^\d{9}$/.test(unformatted)) {
      updateSSNMutation.mutate(editedSSN);
    } else if (unformatted.length === 0) {
      // Allow clearing the SSN
      updateSSNMutation.mutate("");
    } else {
      toast({
        title: "Invalid SSN",
        description: "SSN must be 9 digits (e.g., 123-45-6789)",
        variant: "destructive",
      });
    }
  };

  const handleCancel = () => {
    setEditedSSN("");
    setIsEditing(false);
  };

  const handleSSNChange = (value: string) => {
    // Auto-format as user types
    const digits = value.replace(/\D/g, '');
    if (digits.length <= 9) {
      let formatted = digits;
      if (digits.length > 3) {
        formatted = `${digits.slice(0, 3)}-${digits.slice(3)}`;
      }
      if (digits.length > 5) {
        formatted = `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
      }
      setEditedSSN(formatted);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Worker IDs</CardTitle>
          <CardDescription>Manage worker identification numbers</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Worker IDs</CardTitle>
        <CardDescription>Manage worker identification numbers</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!isEditing ? (
          <div className="space-y-4">
            <div className="flex items-center space-x-4 p-4 bg-muted/30 rounded-lg border border-border">
              <div className="w-12 h-12 bg-primary/10 text-primary rounded-full flex items-center justify-center">
                <CreditCard size={20} />
              </div>
              <div className="flex-1">
                <Label className="text-sm text-muted-foreground">Social Security Number</Label>
                <p className="text-lg font-semibold text-foreground font-mono" data-testid="text-worker-ssn">
                  {worker?.ssn ? formatSSN(worker.ssn) : "Not set"}
                </p>
              </div>
              <Button
                onClick={handleEdit}
                variant="outline"
                size="sm"
                data-testid="button-edit-ssn"
              >
                Edit
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ssn">Social Security Number</Label>
              <Input
                id="ssn"
                value={editedSSN}
                onChange={(e) => handleSSNChange(e.target.value)}
                placeholder="123-45-6789"
                maxLength={11}
                autoFocus
                data-testid="input-ssn"
              />
              <p className="text-xs text-muted-foreground">Format: XXX-XX-XXXX (9 digits)</p>
            </div>
            <div className="flex justify-end space-x-2">
              <Button
                variant="outline"
                onClick={handleCancel}
                disabled={updateSSNMutation.isPending}
                data-testid="button-cancel-edit"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={updateSSNMutation.isPending}
                data-testid="button-save-ssn"
              >
                {updateSSNMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Save
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
