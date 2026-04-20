import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BulkMessageLayout, useBulkMessageLayout } from "@/components/layouts/BulkMessageLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Save, Mail, MessageSquare, MapPin, Bell, Eye, AlertTriangle } from "lucide-react";
import { TokenPicker } from "@/components/bulk/TokenPicker";
import { SlashTokenField } from "@/components/bulk/SlashTokenField";
import { SimpleHtmlEditor } from "@/components/ui/simple-html-editor";
import { cn } from "@/lib/utils";
import { findUnknownTokenIds, extractTokenIds, htmlToPlainText } from "@shared/bulk-tokens";

type TokenInsertTarget = HTMLInputElement | HTMLTextAreaElement;

function useTokenInserter() {
  const lastFocusedRef = useRef<{ key: string; el: TokenInsertTarget } | null>(null);
  const setValueRef = useRef<Record<string, (next: string) => void>>({});

  const registerField = useCallback((key: string, setValue: (next: string) => void) => {
    setValueRef.current[key] = setValue;
  }, []);

  const handleFocus = useCallback((key: string) => (e: React.FocusEvent<TokenInsertTarget>) => {
    lastFocusedRef.current = { key, el: e.currentTarget };
  }, []);

  const insertToken = useCallback((snippet: string) => {
    const focused = lastFocusedRef.current;
    if (!focused) return;
    const { key, el } = focused;
    const setValue = setValueRef.current[key];
    if (!setValue) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const before = el.value.slice(0, start);
    const after = el.value.slice(end);
    const next = `${before}${snippet}${after}`;
    setValue(next);
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + snippet.length;
      try { el.setSelectionRange(caret, caret); } catch { /* noop */ }
    });
  }, []);

  return { registerField, handleFocus, insertToken };
}

function TokenWarnings({ templates }: { templates: Array<string | null | undefined> }) {
  const combined = templates.filter(Boolean).join("\n");
  const unknown = findUnknownTokenIds(combined);
  const known = extractTokenIds(combined).filter((t) => !unknown.includes(t));
  if (unknown.length === 0 && known.length === 0) return null;
  return (
    <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-1" data-testid="text-token-summary">
      {known.length > 0 && (
        <div>
          <span className="font-medium">Tokens used:</span> {known.map((t) => `{{${t}}}`).join(", ")}
        </div>
      )}
      {unknown.length > 0 && (
        <div className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400" data-testid="text-token-unknown">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span><span className="font-medium">Unknown tokens:</span> {unknown.map((t) => `{{${t}}}`).join(", ")} — these will be replaced with "[unknown token: ...]" when sent.</span>
        </div>
      )}
    </div>
  );
}

interface PreviewResponse {
  sample: boolean;
  rendered: Record<string, { output: string; unknownTokens: string[]; missingValues: string[] }>;
}

interface ParticipantRow {
  id: string;
  contactId: string;
  contactDisplayName?: string | null;
  contactGiven?: string | null;
  contactFamily?: string | null;
}

function PreviewPanel({ messageId, fields, escapeHtmlFields = [] }: { messageId: string; fields: Record<string, string>; escapeHtmlFields?: string[] }) {
  const [data, setData] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contactId, setContactId] = useState<string>("__sample__");

  const { data: participantsData } = useQuery<ParticipantRow[]>({
    queryKey: ["/api/bulk-messages", messageId, "participants"],
  });
  const seen = new Set<string>();
  const participants = (participantsData || []).filter((p) => {
    if (!p.contactId || seen.has(p.contactId)) return false;
    seen.add(p.contactId);
    return true;
  });

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = { fields, escapeHtmlFields };
      if (contactId !== "__sample__") payload.contactId = contactId;
      const result = await apiRequest("POST", `/api/bulk-messages/${messageId}/preview`, payload);
      setData(result as PreviewResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={contactId}
          onChange={(e) => setContactId(e.target.value)}
          data-testid="select-preview-recipient"
        >
          <option value="__sample__">Sample data</option>
          {participants.map((p) => {
            const label = p.contactDisplayName
              || `${p.contactGiven || ""} ${p.contactFamily || ""}`.trim()
              || p.contactId;
            return (
              <option key={p.id} value={p.contactId}>{label}</option>
            );
          })}
        </select>
        <Button type="button" size="sm" variant="outline" onClick={run} disabled={loading} data-testid="button-render-preview">
          {loading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Eye className="h-4 w-4 mr-1.5" />}
          {contactId === "__sample__" ? "Preview with sample data" : "Preview as recipient"}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive" data-testid="text-preview-error">{error}</p>}
      {data && (
        <div className="rounded-md border p-3 space-y-3 bg-background" data-testid="panel-preview">
          {Object.entries(data.rendered).map(([field, r]) => (
            <div key={field}>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">{field}</div>
              <pre className="text-sm whitespace-pre-wrap break-words font-sans" data-testid={`text-preview-${field}`}>{r.output || <span className="text-muted-foreground italic">(empty)</span>}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface MultiMediumResponse {
  media: string[];
  records: Record<string, Record<string, unknown> | null>;
}

interface FormProps {
  record: Record<string, unknown> | null;
  onSave: (data: Record<string, unknown>) => void;
  isPending: boolean;
  messageId: string;
}

function EmailForm({ record, onSave, isPending, messageId }: FormProps) {
  const [form, setForm] = useState({ subject: "", bodyHtml: "" });
  const inserter = useTokenInserter();
  inserter.registerField("subject", (next) => setForm((p) => ({ ...p, subject: next })));

  useEffect(() => {
    if (record) {
      setForm({
        subject: (record.subject as string) || "",
        bodyHtml: (record.bodyHtml as string) || "",
      });
    }
  }, [record]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <TokenPicker onInsert={inserter.insertToken} messageId={messageId} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="subject">Subject</Label>
        <SlashTokenField as="input" messageId={messageId} id="subject" value={form.subject} onFocus={inserter.handleFocus("subject")} onChange={(next) => setForm((p) => ({ ...p, subject: next }))} placeholder="Email subject — type / to insert a token" data-testid="input-email-subject" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="bodyHtml">Body</Label>
        <SimpleHtmlEditor
          value={form.bodyHtml}
          onChange={(next) => setForm((p) => ({ ...p, bodyHtml: next }))}
          enableTokens
          minHeight={200}
          placeholder="Type your email — use the toolbar to format and / to insert a token"
          data-testid="editor-email-body"
        />
        <p className="text-xs text-muted-foreground">A plain-text version is generated automatically for recipients whose mail client can't display HTML.</p>
      </div>
      <TokenWarnings templates={[form.subject, form.bodyHtml]} />
      <PreviewPanel messageId={messageId} fields={{ subject: form.subject, bodyHtml: form.bodyHtml }} escapeHtmlFields={["bodyHtml"]} />
      <div className="flex justify-end pt-2">
        <Button onClick={() => onSave({ subject: form.subject, bodyHtml: form.bodyHtml })} disabled={isPending} data-testid="button-save-email-message">
          {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Save Email Content
        </Button>
      </div>
    </div>
  );
}

function SmsForm({ record, onSave, isPending, messageId }: FormProps) {
  const [body, setBody] = useState("");
  const inserter = useTokenInserter();
  inserter.registerField("body", setBody);

  useEffect(() => {
    if (record) {
      setBody((record.body as string) || "");
    }
  }, [record]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <TokenPicker onInsert={inserter.insertToken} messageId={messageId} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="smsBody">Message Body</Label>
        <SlashTokenField as="textarea" messageId={messageId} id="smsBody" value={body} onFocus={inserter.handleFocus("body")} onChange={setBody} rows={6} placeholder="SMS message content — type / to insert a token" data-testid="textarea-sms-body" />
        <div className="flex justify-end">
          <span className="text-xs text-muted-foreground">{body.length} characters</span>
        </div>
      </div>
      <TokenWarnings templates={[body]} />
      <PreviewPanel messageId={messageId} fields={{ body }} />
      <div className="flex justify-end pt-2">
        <Button onClick={() => onSave({ body })} disabled={isPending} data-testid="button-save-sms-message">
          {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Save SMS Content
        </Button>
      </div>
    </div>
  );
}

function PostalForm({ record, onSave, isPending, messageId }: FormProps) {
  const [form, setForm] = useState({
    description: "",
    templateId: "",
    color: false,
    doubleSided: false,
    mailType: "usps_first_class",
  });
  const inserter = useTokenInserter();
  inserter.registerField("description", (next) => setForm((p) => ({ ...p, description: next })));

  useEffect(() => {
    if (record) {
      setForm({
        description: (record.description as string) || "",
        templateId: (record.templateId as string) || "",
        color: (record.color as boolean) || false,
        doubleSided: (record.doubleSided as boolean) || false,
        mailType: (record.mailType as string) || "usps_first_class",
      });
    }
  }, [record]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <TokenPicker onInsert={inserter.insertToken} messageId={messageId} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="postalDescription">Description</Label>
          <SlashTokenField as="textarea" messageId={messageId} id="postalDescription" value={form.description} onFocus={inserter.handleFocus("description")} onChange={(next) => setForm((p) => ({ ...p, description: next }))} rows={3} placeholder="Type / to insert a token" data-testid="textarea-postal-description" />
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
      <TokenWarnings templates={[form.description]} />
      <PreviewPanel messageId={messageId} fields={{ description: form.description }} />
      <div className="flex justify-end pt-2">
        <Button onClick={() => onSave({ ...form })} disabled={isPending} data-testid="button-save-postal-message">
          {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Save Postal Content
        </Button>
      </div>
    </div>
  );
}

function InappForm({ record, onSave, isPending, messageId }: FormProps) {
  const [form, setForm] = useState({
    title: "",
    bodyHtml: "",
    linkUrl: "",
    linkLabel: "",
  });
  const inserter = useTokenInserter();
  inserter.registerField("title", (next) => setForm((p) => ({ ...p, title: next })));
  inserter.registerField("linkLabel", (next) => setForm((p) => ({ ...p, linkLabel: next })));

  useEffect(() => {
    if (record) {
      const existing = (record.body as string) || "";
      // Treat already-stored plain text as plain text by escaping/wrapping
      // so the editor can show it; new edits are stored as plain text again.
      const looksLikeHtml = /<[a-z][^>]*>/i.test(existing);
      setForm({
        title: (record.title as string) || "",
        bodyHtml: looksLikeHtml ? existing : existing.replace(/\n/g, "<br>"),
        linkUrl: (record.linkUrl as string) || "",
        linkLabel: (record.linkLabel as string) || "",
      });
    }
  }, [record]);

  const derivedBody = htmlToPlainText(form.bodyHtml);
  const overLimit = derivedBody.length > 500;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <TokenPicker onInsert={inserter.insertToken} messageId={messageId} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="inappTitle">Title</Label>
        <SlashTokenField as="input" messageId={messageId} id="inappTitle" value={form.title} onFocus={inserter.handleFocus("title")} onChange={(next) => setForm((p) => ({ ...p, title: next }))} maxLength={100} placeholder="Notification title — type / to insert a token" data-testid="input-inapp-title" />
        <div className="flex justify-end"><span className="text-xs text-muted-foreground">{form.title.length} / 100</span></div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="inappBody">Body</Label>
        <SimpleHtmlEditor
          value={form.bodyHtml}
          onChange={(next) => setForm((p) => ({ ...p, bodyHtml: next }))}
          enableTokens
          minHeight={140}
          placeholder="Notification body — use / to insert a token"
          data-testid="editor-inapp-body"
        />
        <div className="flex justify-end">
          <span className={cn("text-xs", overLimit ? "text-destructive" : "text-muted-foreground")} data-testid="text-inapp-body-count">
            {derivedBody.length} / 500
          </span>
        </div>
        <p className="text-xs text-muted-foreground">In-app notifications display as plain text; formatting will be flattened on send.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="inappLinkUrl">Link URL</Label>
          <Input id="inappLinkUrl" value={form.linkUrl} onChange={(e) => setForm((p) => ({ ...p, linkUrl: e.target.value }))} maxLength={2048} placeholder="https://..." data-testid="input-inapp-link-url" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="inappLinkLabel">Link Label</Label>
          <SlashTokenField as="input" messageId={messageId} id="inappLinkLabel" value={form.linkLabel} onFocus={inserter.handleFocus("linkLabel")} onChange={(next) => setForm((p) => ({ ...p, linkLabel: next }))} maxLength={50} placeholder="Click here — type / to insert a token" data-testid="input-inapp-link-label" />
        </div>
      </div>
      <TokenWarnings templates={[form.title, form.bodyHtml, form.linkLabel]} />
      <PreviewPanel messageId={messageId} fields={{ title: form.title, body: derivedBody, linkLabel: form.linkLabel }} />
      <div className="flex justify-end pt-2">
        <Button
          onClick={() => onSave({
            title: form.title,
            body: derivedBody,
            linkUrl: form.linkUrl,
            linkLabel: form.linkLabel,
          })}
          disabled={isPending || overLimit}
          data-testid="button-save-inapp-message"
        >
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

const FORM_COMPONENTS: Record<string, typeof EmailForm> = {
  email: EmailForm,
  sms: SmsForm,
  postal: PostalForm,
  inapp: InappForm,
};

function BulkMessageMessageContent() {
  const { bulkMessage } = useBulkMessageLayout();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const media = Array.isArray(bulkMessage.medium) ? bulkMessage.medium : [bulkMessage.medium];
  const [activeMedium, setActiveMedium] = useState(media[0]);

  useEffect(() => {
    if (!media.includes(activeMedium)) {
      setActiveMedium(media[0]);
    }
  }, [media, activeMedium]);

  const { data: allData, isLoading } = useQuery<MultiMediumResponse>({
    queryKey: ["/api/bulk-messages", bulkMessage.id, "message"],
    queryFn: async () => {
      const response = await fetch(`/api/bulk-messages/${bulkMessage.id}/message`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch message content");
      return response.json();
    },
  });

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => {
      return apiRequest("PUT", `/api/bulk-messages/${bulkMessage.id}/message?medium=${activeMedium}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bulk-messages", bulkMessage.id, "message"] });
      toast({ title: "Message content saved", description: `${mediumLabels[activeMedium] || activeMedium} content saved successfully.` });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save", description: error.message || "An error occurred", variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" data-testid="loader-message-content" />
      </div>
    );
  }

  const records = allData?.records || {};
  const record = records[activeMedium] || null;
  const ActiveIcon = mediumIcons[activeMedium] || Mail;
  const FormComponent = FORM_COMPONENTS[activeMedium];

  return (
    <div className="space-y-4">
      {media.length > 1 && (
        <div className="flex gap-2 border-b pb-2" data-testid="nav-medium-tabs">
          {media.map((m) => {
            const Icon = mediumIcons[m] || Mail;
            const isActive = m === activeMedium;
            return (
              <Button
                key={m}
                variant={isActive ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setActiveMedium(m)}
                data-testid={`tab-medium-${m}`}
              >
                <Icon className="h-4 w-4 mr-1.5" />
                {mediumLabels[m] || m}
              </Button>
            );
          })}
        </div>
      )}

      <Card data-testid="card-bulk-message-content">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ActiveIcon className="h-5 w-5" />
            {mediumLabels[activeMedium] || activeMedium} Message Content
          </CardTitle>
        </CardHeader>
        <CardContent>
          {FormComponent && (
            <FormComponent
              record={record}
              onSave={(data) => saveMutation.mutate(data)}
              isPending={saveMutation.isPending}
              messageId={bulkMessage.id}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function BulkMessageMessagePage() {
  return (
    <BulkMessageLayout activeTab="message">
      <BulkMessageMessageContent />
    </BulkMessageLayout>
  );
}
