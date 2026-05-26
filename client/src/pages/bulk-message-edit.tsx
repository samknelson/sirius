import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { BulkMessageLayout, useBulkMessageLayout } from "@/components/layouts/BulkMessageLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CommTagPicker } from "@/components/comm/CommTagPicker";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, AlertTriangle } from "lucide-react";

const mediumLabels: Record<string, string> = {
  email: "Email",
  sms: "SMS",
  postal: "Postal",
  inapp: "In-App",
};

const ALL_MEDIA = ["email", "sms", "postal", "inapp"] as const;
type CommMedium = (typeof ALL_MEDIA)[number];

function BulkMessageEditContent() {
  const { bulkMessage } = useBulkMessageLayout();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [formData, setFormData] = useState({
    name: "",
    medium: [] as string[],
    status: "draft" as string,
    sendDate: "",
    tagIds: [] as string[],
    offline: false,
  });

  const deliveryStarted = (bulkMessage as { deliveryStarted?: boolean }).deliveryStarted === true;

  useEffect(() => {
    if (bulkMessage) {
      const media = Array.isArray(bulkMessage.medium) ? bulkMessage.medium : [bulkMessage.medium];
      const existingData = (bulkMessage.data ?? {}) as Record<string, unknown>;
      const existingTagIds = Array.isArray(existingData.tagIds)
        ? (existingData.tagIds as string[]).filter((id) => typeof id === "string")
        : [];
      setFormData({
        name: bulkMessage.name,
        medium: media,
        status: bulkMessage.status,
        sendDate: bulkMessage.sendDate
          ? new Date(bulkMessage.sendDate).toISOString().slice(0, 16)
          : "",
        tagIds: existingTagIds,
        offline: existingData.offline === true,
      });
    }
  }, [bulkMessage]);

  const updateMutation = useMutation({
    mutationFn: (data: typeof formData) => {
      const existingData = (bulkMessage.data ?? {}) as Record<string, unknown>;
      const payload: Record<string, unknown> = {
        name: data.name,
        medium: data.medium,
        status: data.status,
        data: { ...existingData, tagIds: data.tagIds, offline: data.offline },
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
    if (formData.medium.length === 0) {
      toast({ title: "Validation error", description: "At least one medium is required.", variant: "destructive" });
      return;
    }
    updateMutation.mutate(formData);
  };

  const toggleMedium = (m: string) => {
    setFormData((prev) => {
      const has = prev.medium.includes(m);
      const next = has ? prev.medium.filter((x) => x !== m) : [...prev.medium, m];
      return { ...prev, medium: next };
    });
  };

  return (
    <div className="space-y-6">
      {formData.offline && (
        <Alert variant="destructive" data-testid="alert-bulk-offline-warning">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            This message will <strong>NOT</strong> be sent through the system — it will be recorded as
            delivered manually for each recipient. In-app messages, if selected, still send normally.
          </AlertDescription>
        </Alert>
      )}
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
                <Label>Media</Label>
                <div className="flex flex-wrap gap-4 pt-1">
                  {ALL_MEDIA.map((m) => (
                    <label key={m} className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={formData.medium.includes(m)}
                        onCheckedChange={() => toggleMedium(m)}
                        data-testid={`checkbox-edit-medium-${m}`}
                      />
                      <span className="text-sm">{mediumLabels[m]}</span>
                    </label>
                  ))}
                </div>
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
            <CommTagPicker
              mediums={formData.medium as CommMedium[]}
              value={formData.tagIds}
              onChange={(ids) => setFormData((prev) => ({ ...prev, tagIds: ids }))}
            />
            <div className="space-y-2 rounded-md border border-border p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <Label htmlFor="offline-switch" className="text-sm font-medium">
                    Deliver offline (manual)
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    The system will record each recipient as delivered without actually sending
                    email, SMS, or postal mail. Use this for messages you'll hand off, mail
                    yourself, or read out by phone.
                  </p>
                  <p className="text-xs text-muted-foreground italic">
                    In-app messages always send through the system.
                  </p>
                  {deliveryStarted && (
                    <p className="text-xs text-muted-foreground" data-testid="text-offline-locked">
                      Locked — delivery has started for at least one recipient.
                    </p>
                  )}
                </div>
                <Switch
                  id="offline-switch"
                  checked={formData.offline}
                  disabled={deliveryStarted}
                  onCheckedChange={(checked) =>
                    setFormData((prev) => ({ ...prev, offline: checked === true }))
                  }
                  data-testid="switch-bulk-offline"
                />
              </div>
            </div>
            <div className="flex gap-3 pt-4">
              <Button
                type="submit"
                disabled={updateMutation.isPending || !formData.name || formData.medium.length === 0}
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
