import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BulkMessageLayout, useBulkMessageLayout } from "@/components/layouts/BulkMessageLayout";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Save, Mail, MessageSquare, MapPin, Bell } from "lucide-react";

interface MediumResponse {
  medium: string;
  record: Record<string, unknown> | null;
}

function formatJsonForEdit(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

function parseJsonField(value: string): unknown {
  if (!value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function EmailForm({ record, onSave, isPending }: { record: Record<string, unknown> | null; onSave: (data: Record<string, unknown>) => void; isPending: boolean }) {
  const [form, setForm] = useState({
    fromAddress: "",
    fromName: "",
    replyTo: "",
    subject: "",
    bodyText: "",
    bodyHtml: "",
    data: "",
  });

  useEffect(() => {
    if (record) {
      setForm({
        fromAddress: (record.fromAddress as string) || "",
        fromName: (record.fromName as string) || "",
        replyTo: (record.replyTo as string) || "",
        subject: (record.subject as string) || "",
        bodyText: (record.bodyText as string) || "",
        bodyHtml: (record.bodyHtml as string) || "",
        data: formatJsonForEdit(record.data),
      });
    }
  }, [record]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="fromAddress">From Address</Label>
          <Input id="fromAddress" type="email" value={form.fromAddress} onChange={(e) => setForm((p) => ({ ...p, fromAddress: e.target.value }))} placeholder="sender@example.com" data-testid="input-email-from-address" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fromName">From Name</Label>
          <Input id="fromName" value={form.fromName} onChange={(e) => setForm((p) => ({ ...p, fromName: e.target.value }))} placeholder="Sender Name" data-testid="input-email-from-name" />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="replyTo">Reply To</Label>
          <Input id="replyTo" type="email" value={form.replyTo} onChange={(e) => setForm((p) => ({ ...p, replyTo: e.target.value }))} placeholder="reply@example.com" data-testid="input-email-reply-to" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="subject">Subject</Label>
          <Input id="subject" value={form.subject} onChange={(e) => setForm((p) => ({ ...p, subject: e.target.value }))} placeholder="Email subject" data-testid="input-email-subject" />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="bodyText">Body (Plain Text)</Label>
        <Textarea id="bodyText" value={form.bodyText} onChange={(e) => setForm((p) => ({ ...p, bodyText: e.target.value }))} rows={6} placeholder="Plain text version of the email" data-testid="textarea-email-body-text" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="bodyHtml">Body (HTML)</Label>
        <Textarea id="bodyHtml" value={form.bodyHtml} onChange={(e) => setForm((p) => ({ ...p, bodyHtml: e.target.value }))} rows={6} className="font-mono text-sm" placeholder="<html>...</html>" data-testid="textarea-email-body-html" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="emailData">Data (JSON)</Label>
        <Textarea id="emailData" value={form.data} onChange={(e) => setForm((p) => ({ ...p, data: e.target.value }))} rows={4} className="font-mono text-sm" placeholder='{"key": "value"}' data-testid="textarea-email-data" />
      </div>
      <div className="flex justify-end pt-2">
        <Button onClick={() => onSave({ ...form, data: parseJsonField(form.data) })} disabled={isPending} data-testid="button-save-email-message">
          {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Save Email Content
        </Button>
      </div>
    </div>
  );
}

function SmsForm({ record, onSave, isPending }: { record: Record<string, unknown> | null; onSave: (data: Record<string, unknown>) => void; isPending: boolean }) {
  const [body, setBody] = useState("");
  const [dataField, setDataField] = useState("");

  useEffect(() => {
    if (record) {
      setBody((record.body as string) || "");
      setDataField(formatJsonForEdit(record.data));
    }
  }, [record]);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="smsBody">Message Body</Label>
        <Textarea id="smsBody" value={body} onChange={(e) => setBody(e.target.value)} rows={6} placeholder="SMS message content..." data-testid="textarea-sms-body" />
        <div className="flex justify-end">
          <span className="text-xs text-muted-foreground">{body.length} characters</span>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="smsData">Data (JSON)</Label>
        <Textarea id="smsData" value={dataField} onChange={(e) => setDataField(e.target.value)} rows={4} className="font-mono text-sm" placeholder='{"key": "value"}' data-testid="textarea-sms-data" />
      </div>
      <div className="flex justify-end pt-2">
        <Button onClick={() => onSave({ body, data: parseJsonField(dataField) })} disabled={isPending} data-testid="button-save-sms-message">
          {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Save SMS Content
        </Button>
      </div>
    </div>
  );
}

function PostalForm({ record, onSave, isPending }: { record: Record<string, unknown> | null; onSave: (data: Record<string, unknown>) => void; isPending: boolean }) {
  const [form, setForm] = useState({
    fromName: "",
    fromCompany: "",
    fromAddressLine1: "",
    fromAddressLine2: "",
    fromCity: "",
    fromState: "",
    fromZip: "",
    fromCountry: "US",
    description: "",
    templateId: "",
    color: false,
    doubleSided: false,
    mailType: "usps_first_class",
    data: "",
  });

  useEffect(() => {
    if (record) {
      setForm({
        fromName: (record.fromName as string) || "",
        fromCompany: (record.fromCompany as string) || "",
        fromAddressLine1: (record.fromAddressLine1 as string) || "",
        fromAddressLine2: (record.fromAddressLine2 as string) || "",
        fromCity: (record.fromCity as string) || "",
        fromState: (record.fromState as string) || "",
        fromZip: (record.fromZip as string) || "",
        fromCountry: (record.fromCountry as string) || "US",
        description: (record.description as string) || "",
        templateId: (record.templateId as string) || "",
        color: (record.color as boolean) || false,
        doubleSided: (record.doubleSided as boolean) || false,
        mailType: (record.mailType as string) || "usps_first_class",
        data: formatJsonForEdit(record.data),
      });
    }
  }, [record]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="postalFromName">From Name</Label>
          <Input id="postalFromName" value={form.fromName} onChange={(e) => setForm((p) => ({ ...p, fromName: e.target.value }))} data-testid="input-postal-from-name" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="postalFromCompany">From Company</Label>
          <Input id="postalFromCompany" value={form.fromCompany} onChange={(e) => setForm((p) => ({ ...p, fromCompany: e.target.value }))} data-testid="input-postal-from-company" />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="postalAddr1">Address Line 1</Label>
        <Input id="postalAddr1" value={form.fromAddressLine1} onChange={(e) => setForm((p) => ({ ...p, fromAddressLine1: e.target.value }))} data-testid="input-postal-addr1" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="postalAddr2">Address Line 2</Label>
        <Input id="postalAddr2" value={form.fromAddressLine2} onChange={(e) => setForm((p) => ({ ...p, fromAddressLine2: e.target.value }))} data-testid="input-postal-addr2" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="space-y-2">
          <Label htmlFor="postalCity">City</Label>
          <Input id="postalCity" value={form.fromCity} onChange={(e) => setForm((p) => ({ ...p, fromCity: e.target.value }))} data-testid="input-postal-city" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="postalState">State</Label>
          <Input id="postalState" value={form.fromState} onChange={(e) => setForm((p) => ({ ...p, fromState: e.target.value }))} data-testid="input-postal-state" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="postalZip">ZIP</Label>
          <Input id="postalZip" value={form.fromZip} onChange={(e) => setForm((p) => ({ ...p, fromZip: e.target.value }))} data-testid="input-postal-zip" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="postalCountry">Country</Label>
          <Input id="postalCountry" value={form.fromCountry} onChange={(e) => setForm((p) => ({ ...p, fromCountry: e.target.value }))} data-testid="input-postal-country" />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="postalDescription">Description</Label>
          <Textarea id="postalDescription" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} rows={3} data-testid="textarea-postal-description" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="postalTemplateId">Template ID</Label>
          <Input id="postalTemplateId" value={form.templateId} onChange={(e) => setForm((p) => ({ ...p, templateId: e.target.value }))} placeholder="Optional template ID" data-testid="input-postal-template-id" />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="flex items-center space-x-2">
          <Switch id="postalColor" checked={form.color} onCheckedChange={(checked) => setForm((p) => ({ ...p, color: checked }))} data-testid="switch-postal-color" />
          <Label htmlFor="postalColor">Color</Label>
        </div>
        <div className="flex items-center space-x-2">
          <Switch id="postalDoubleSided" checked={form.doubleSided} onCheckedChange={(checked) => setForm((p) => ({ ...p, doubleSided: checked }))} data-testid="switch-postal-double-sided" />
          <Label htmlFor="postalDoubleSided">Double Sided</Label>
        </div>
        <div className="space-y-2">
          <Label htmlFor="postalMailType">Mail Type</Label>
          <Select value={form.mailType} onValueChange={(value) => setForm((p) => ({ ...p, mailType: value }))}>
            <SelectTrigger data-testid="select-postal-mail-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="usps_first_class">USPS First Class</SelectItem>
              <SelectItem value="usps_standard">USPS Standard</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="postalData">Data (JSON)</Label>
        <Textarea id="postalData" value={form.data} onChange={(e) => setForm((p) => ({ ...p, data: e.target.value }))} rows={4} className="font-mono text-sm" placeholder='{"key": "value"}' data-testid="textarea-postal-data" />
      </div>
      <div className="flex justify-end pt-2">
        <Button onClick={() => onSave({ ...form, data: parseJsonField(form.data) })} disabled={isPending} data-testid="button-save-postal-message">
          {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Save Postal Content
        </Button>
      </div>
    </div>
  );
}

function InappForm({ record, onSave, isPending }: { record: Record<string, unknown> | null; onSave: (data: Record<string, unknown>) => void; isPending: boolean }) {
  const [form, setForm] = useState({
    title: "",
    body: "",
    linkUrl: "",
    linkLabel: "",
    data: "",
  });

  useEffect(() => {
    if (record) {
      setForm({
        title: (record.title as string) || "",
        body: (record.body as string) || "",
        linkUrl: (record.linkUrl as string) || "",
        linkLabel: (record.linkLabel as string) || "",
        data: formatJsonForEdit(record.data),
      });
    }
  }, [record]);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="inappTitle">Title</Label>
        <Input id="inappTitle" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} maxLength={100} placeholder="Notification title" data-testid="input-inapp-title" />
        <div className="flex justify-end"><span className="text-xs text-muted-foreground">{form.title.length} / 100</span></div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="inappBody">Body</Label>
        <Textarea id="inappBody" value={form.body} onChange={(e) => setForm((p) => ({ ...p, body: e.target.value }))} rows={4} maxLength={500} placeholder="Notification body text" data-testid="textarea-inapp-body" />
        <div className="flex justify-end"><span className="text-xs text-muted-foreground">{form.body.length} / 500</span></div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="inappLinkUrl">Link URL</Label>
          <Input id="inappLinkUrl" value={form.linkUrl} onChange={(e) => setForm((p) => ({ ...p, linkUrl: e.target.value }))} maxLength={2048} placeholder="https://..." data-testid="input-inapp-link-url" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="inappLinkLabel">Link Label</Label>
          <Input id="inappLinkLabel" value={form.linkLabel} onChange={(e) => setForm((p) => ({ ...p, linkLabel: e.target.value }))} maxLength={50} placeholder="Click here" data-testid="input-inapp-link-label" />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="inappData">Data (JSON)</Label>
        <Textarea id="inappData" value={form.data} onChange={(e) => setForm((p) => ({ ...p, data: e.target.value }))} rows={4} className="font-mono text-sm" placeholder='{"key": "value"}' data-testid="textarea-inapp-data" />
      </div>
      <div className="flex justify-end pt-2">
        <Button onClick={() => onSave({ ...form, data: parseJsonField(form.data) })} disabled={isPending} data-testid="button-save-inapp-message">
          {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Save In-App Content
        </Button>
      </div>
    </div>
  );
}

const mediumIcons: Record<string, typeof Mail> = {
  email: Mail,
  sms: MessageSquare,
  postal: MapPin,
  inapp: Bell,
};

const mediumLabels: Record<string, string> = {
  email: "Email",
  sms: "SMS",
  postal: "Postal",
  inapp: "In-App",
};

function BulkMessageMessageContent() {
  const { bulkMessage } = useBulkMessageLayout();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: mediumData, isLoading } = useQuery<MediumResponse>({
    queryKey: ["/api/bulk-messages", bulkMessage.id, "message"],
    queryFn: async () => {
      const response = await fetch(`/api/bulk-messages/${bulkMessage.id}/message`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch message content");
      return response.json();
    },
  });

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => {
      return apiRequest("PUT", `/api/bulk-messages/${bulkMessage.id}/message`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bulk-messages", bulkMessage.id, "message"] });
      toast({ title: "Message content saved", description: "The message content has been saved successfully." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save", description: error.message || "An error occurred", variant: "destructive" });
    },
  });

  const MediumIcon = mediumIcons[bulkMessage.medium] || Mail;
  const mediumLabel = mediumLabels[bulkMessage.medium] || bulkMessage.medium;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" data-testid="loader-message-content" />
      </div>
    );
  }

  const record = mediumData?.record || null;

  return (
    <Card data-testid="card-bulk-message-content">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MediumIcon className="h-5 w-5" />
          {mediumLabel} Message Content
        </CardTitle>
      </CardHeader>
      <CardContent>
        {bulkMessage.medium === "email" && (
          <EmailForm record={record} onSave={(data) => saveMutation.mutate(data)} isPending={saveMutation.isPending} />
        )}
        {bulkMessage.medium === "sms" && (
          <SmsForm record={record} onSave={(data) => saveMutation.mutate(data)} isPending={saveMutation.isPending} />
        )}
        {bulkMessage.medium === "postal" && (
          <PostalForm record={record} onSave={(data) => saveMutation.mutate(data)} isPending={saveMutation.isPending} />
        )}
        {bulkMessage.medium === "inapp" && (
          <InappForm record={record} onSave={(data) => saveMutation.mutate(data)} isPending={saveMutation.isPending} />
        )}
      </CardContent>
    </Card>
  );
}

export default function BulkMessageMessagePage() {
  return (
    <BulkMessageLayout activeTab="message">
      <BulkMessageMessageContent />
    </BulkMessageLayout>
  );
}
