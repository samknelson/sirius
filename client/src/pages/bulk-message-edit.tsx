import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { BulkMessageLayout, useBulkMessageLayout } from "@/components/layouts/BulkMessageLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2 } from "lucide-react";

function BulkMessageEditContent() {
  const { bulkMessage } = useBulkMessageLayout();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [formData, setFormData] = useState({
    name: "",
    medium: "email" as string,
    status: "draft" as string,
    sendDate: "",
  });

  useEffect(() => {
    if (bulkMessage) {
      setFormData({
        name: bulkMessage.name,
        medium: bulkMessage.medium,
        status: bulkMessage.status,
        sendDate: bulkMessage.sendDate
          ? new Date(bulkMessage.sendDate).toISOString().slice(0, 16)
          : "",
      });
    }
  }, [bulkMessage]);

  const updateMutation = useMutation({
    mutationFn: (data: typeof formData) => {
      const payload: Record<string, unknown> = {
        name: data.name,
        medium: data.medium,
        status: data.status,
      };
      payload.sendDate = data.sendDate ? new Date(data.sendDate).toISOString() : null;
      return apiRequest("PATCH", `/api/bulk-messages/${bulkMessage.id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bulk-messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bulk-messages", bulkMessage.id] });
      toast({ title: "Bulk message updated", description: "The bulk message has been updated." });
      setLocation(`/bulk/${bulkMessage.id}`);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update", description: error.message || "An error occurred", variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) {
      toast({ title: "Validation error", description: "Name is required.", variant: "destructive" });
      return;
    }
    updateMutation.mutate(formData);
  };

  return (
    <div className="space-y-6">
      <Card data-testid="card-bulk-edit">
        <CardHeader>
          <CardTitle>Edit Bulk Message</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                data-testid="input-bulk-edit-name"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="medium">Medium</Label>
                <Select
                  value={formData.medium}
                  onValueChange={(value) => setFormData((prev) => ({ ...prev, medium: value }))}
                >
                  <SelectTrigger data-testid="select-bulk-edit-medium">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="sms">SMS</SelectItem>
                    <SelectItem value="postal">Postal</SelectItem>
                    <SelectItem value="inapp">In-App</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Select
                  value={formData.status}
                  onValueChange={(value) => setFormData((prev) => ({ ...prev, status: value }))}
                >
                  <SelectTrigger data-testid="select-bulk-edit-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="queued">Queued</SelectItem>
                    <SelectItem value="sent">Sent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sendDate">Send Date</Label>
              <Input
                id="sendDate"
                type="datetime-local"
                value={formData.sendDate}
                onChange={(e) => setFormData((prev) => ({ ...prev, sendDate: e.target.value }))}
                data-testid="input-bulk-edit-send-date"
              />
            </div>
            <div className="flex gap-3 pt-4">
              <Button
                type="submit"
                disabled={updateMutation.isPending || !formData.name}
                data-testid="button-bulk-save"
              >
                {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save Changes
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setLocation(`/bulk/${bulkMessage.id}`)}
                data-testid="button-bulk-cancel-edit"
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

export default function BulkMessageEditPage() {
  return (
    <BulkMessageLayout activeTab="edit">
      <BulkMessageEditContent />
    </BulkMessageLayout>
  );
}
