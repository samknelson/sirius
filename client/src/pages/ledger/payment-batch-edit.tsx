import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { PaymentBatchLayout, usePaymentBatchLayout } from "@/components/layouts/PaymentBatchLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Paperclip, X, Download } from "lucide-react";
import type { File as FileRecord } from "@shared/schema";

function BatchEditContent() {
  const { batch } = usePaymentBatchLayout();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [name, setName] = useState("");
  const [batchTotal, setBatchTotal] = useState("");
  const [expectedPaymentCount, setExpectedPaymentCount] = useState("");
  const [attachmentFileId, setAttachmentFileId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (batch) {
      setName(batch.name);
      setBatchTotal(batch.batchTotal ?? "");
      setExpectedPaymentCount(
        batch.expectedPaymentCount != null ? String(batch.expectedPaymentCount) : "",
      );
      setAttachmentFileId(batch.attachmentFileId ?? null);
    }
  }, [batch]);

  const { data: attachment } = useQuery<FileRecord>({
    queryKey: ["/api/files", attachmentFileId],
    queryFn: () => apiRequest("GET", `/api/files/${attachmentFileId}`),
    enabled: !!attachmentFileId,
  });

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiRequest("PATCH", `/api/ledger-payment-batches/${batch.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ledger-payment-batches"] });
      queryClient.invalidateQueries({ queryKey: [`/api/ledger-payment-batches/${batch.id}`] });
      toast({ title: "Batch updated", description: "The payment batch has been updated." });
      setLocation(`/ledger/payment-batch/${batch.id}`);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update batch", description: error.message, variant: "destructive" });
    },
  });

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("entityType", "ledger_payment_batch");
      fd.append("entityId", batch.id);
      fd.append("accessLevel", "private");

      const res = await fetch("/api/files", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Upload failed");
      }
      const created = (await res.json()) as FileRecord;
      setAttachmentFileId(created.id);
      toast({ title: "Attachment uploaded", description: file.name });
    } catch (err) {
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast({ title: "Validation error", description: "Name is required.", variant: "destructive" });
      return;
    }

    const payload: Record<string, unknown> = {
      name: name.trim(),
      batchTotal: batchTotal.trim() === "" ? null : batchTotal.trim(),
      expectedPaymentCount:
        expectedPaymentCount.trim() === "" ? null : parseInt(expectedPaymentCount, 10),
      attachmentFileId: attachmentFileId,
    };
    updateMutation.mutate(payload);
  };

  return (
    <div className="space-y-6">
      <Card data-testid="card-batch-edit">
        <CardHeader>
          <CardTitle>Edit Payment Batch</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                data-testid="input-batch-name"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="batchTotal">Batch Total (optional)</Label>
                <Input
                  id="batchTotal"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={batchTotal}
                  onChange={(e) => setBatchTotal(e.target.value)}
                  data-testid="input-batch-total"
                />
                <p className="text-xs text-muted-foreground">
                  Used to reconcile against the sum of payments in this batch.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="expectedPaymentCount">Expected Payments (optional)</Label>
                <Input
                  id="expectedPaymentCount"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="0"
                  value={expectedPaymentCount}
                  onChange={(e) => setExpectedPaymentCount(e.target.value)}
                  data-testid="input-expected-count"
                />
                <p className="text-xs text-muted-foreground">
                  How many individual payments you expect to record.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Attachment (image or PDF)</Label>
              <div className="flex items-center gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={handleFileSelect}
                  data-testid="input-batch-attachment"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  data-testid="button-upload-attachment"
                >
                  {uploading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Paperclip className="h-4 w-4 mr-2" />
                  )}
                  {attachmentFileId ? "Replace Attachment" : "Upload Attachment"}
                </Button>
                {attachmentFileId && (
                  <>
                    <a
                      href={`/api/files/${attachmentFileId}/download`}
                      className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                      data-testid="link-attachment-download"
                    >
                      <Download className="h-4 w-4" />
                      {attachment?.fileName || "Download"}
                    </a>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setAttachmentFileId(null)}
                      data-testid="button-remove-attachment"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
              {attachmentFileId && attachment?.mimeType?.startsWith("image/") && (
                <a
                  href={`/api/files/${attachmentFileId}/download`}
                  target="_blank"
                  rel="noreferrer"
                  className="block mt-2"
                  data-testid="link-attachment-image-preview"
                >
                  <img
                    src={`/api/files/${attachmentFileId}/download`}
                    alt={attachment?.fileName || "Batch attachment"}
                    className="max-h-64 max-w-full rounded border bg-muted object-contain"
                    data-testid="img-attachment-preview"
                  />
                </a>
              )}
              {attachmentFileId && attachment?.mimeType === "application/pdf" && (
                <object
                  data={`/api/files/${attachmentFileId}/download`}
                  type="application/pdf"
                  className="w-full h-96 mt-2 rounded border"
                  data-testid="embed-attachment-pdf-preview"
                >
                  <p className="text-sm text-muted-foreground p-4">
                    PDF preview not available in this browser.
                  </p>
                </object>
              )}
            </div>

            <div className="flex gap-3 pt-4">
              <Button
                type="submit"
                disabled={updateMutation.isPending || !name.trim()}
                data-testid="button-batch-save"
              >
                {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save Changes
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setLocation(`/ledger/payment-batch/${batch.id}`)}
                data-testid="button-batch-cancel-edit"
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

export default function PaymentBatchEditPage() {
  return (
    <PaymentBatchLayout activeTab="edit">
      <BatchEditContent />
    </PaymentBatchLayout>
  );
}
