import { useState, useEffect, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BulkMessageLayout, useBulkMessageLayout } from "@/components/layouts/BulkMessageLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import { Loader2, Save, Mail, MessageSquare, MapPin, Bell } from "lucide-react";
import { TokenStudioButton, type StudioField } from "@/components/template-studio/TokenStudio";
import { TokenText } from "@/components/template-studio/TokenText";
import { cn } from "@/lib/utils";
import { escapeHtml, htmlToPlainText } from "@shared/utils/html";
import { BULK_CHANNEL_FIELDS } from "@shared/delivery-fields";

/**
 * Bulk message content, one medium at a time.
 *
 * The template text of every medium is edited in the Template Studio and
 * nowhere else: this page shows what is saved (tokens as readable chips)
 * and opens the studio to change it. There is no second, weaker editor
 * with its own token picker, because two doors means two answers to
 * "what does this token do here" — and only the studio can preview
 * against a real record.
 *
 * Settings that are NOT template text — a postal template id, mail type,
 * the colour switches — stay here, where they belong.
 */

/** Bulk's token endpoints; the studio's own are gated differently. */
const bulkTokenCatalogUrl = (messageId: string) => `/api/bulk-tokens/${messageId}`;
const BULK_TOKEN_TREE_URL = "/api/bulk-tokens/tree";

// Field declarations are shared between the summary rows and the studio
// that edits them, so a field can never be editable but invisible (or
// the reverse). Character limits are the storing column's.
const EMAIL_FIELDS: StudioField[] = [
  { key: "subject", label: "Subject", mode: "line" },
  { key: "bodyHtml", label: "Body", mode: "html" },
];

const SMS_FIELDS: StudioField[] = [
  { key: "body", label: "Message body", mode: "multiline" },
];

const POSTAL_FIELDS: StudioField[] = [
  { key: "description", label: "Description", mode: "multiline" },
];

const INAPP_FIELDS: StudioField[] = [
  { key: "title", label: "Title", mode: "line", maxLength: 100 },
  {
    key: "bodyHtml",
    label: "Body",
    mode: "html",
    hint: "Displayed as plain text; formatting is flattened on send. The flattened text must stay under 500 characters.",
  },
  { key: "linkUrl", label: "Link URL", mode: "line", maxLength: 2048 },
  { key: "linkLabel", label: "Link label", mode: "line", maxLength: 50 },
];

/**
 * What is saved for one medium, as a sentence rather than a wall of
 * braces, with the single affordance that changes it.
 */
function TemplateCard({
  fields,
  values,
  action,
  counts,
  footnote,
  testId,
}: {
  fields: StudioField[];
  values: Record<string, string>;
  action: ReactNode;
  counts?: Record<string, ReactNode>;
  footnote?: string;
  testId: string;
}) {
  return (
    <div className="rounded-md border" data-testid={testId}>
      <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
        <p className="text-sm font-medium">Message content</p>
        {action}
      </div>
      <div className="divide-y">
        {fields.map((f) => {
          const text = values[f.key] ?? "";
          return (
            <div key={f.key} className="flex items-baseline gap-3 px-3 py-2">
              <span className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {f.label}
              </span>
              {text.trim() ? (
                <TokenText
                  text={text}
                  html={f.mode === "html"}
                  className="min-w-0 flex-1 truncate text-sm"
                  data-testid={`text-summary-${f.key}`}
                />
              ) : (
                <span className="min-w-0 flex-1 text-sm italic text-muted-foreground" data-testid={`text-summary-${f.key}`}>
                  Not set
                </span>
              )}
              {counts?.[f.key] && <span className="shrink-0 text-xs">{counts[f.key]}</span>}
            </div>
          );
        })}
      </div>
      {footnote && (
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">{footnote}</p>
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
  /**
   * This message's own token catalog — the studio previews against the
   * recipients of THIS message, so the catalog is per message.
   */
  catalogUrl: string;
}

function SaveButton({
  onClick,
  isPending,
  disabled,
  label,
  testId,
}: {
  onClick: () => void;
  isPending: boolean;
  disabled?: boolean;
  label: string;
  testId: string;
}) {
  return (
    <div className="flex justify-end pt-2">
      <Button onClick={onClick} disabled={isPending || disabled} data-testid={testId}>
        {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
        {label}
      </Button>
    </div>
  );
}

function EmailForm({ record, onSave, isPending, catalogUrl }: FormProps) {
  const [form, setForm] = useState({ subject: "", bodyHtml: "" });

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
      <TemplateCard
        testId="card-email-template"
        fields={EMAIL_FIELDS}
        values={form}
        footnote="A plain-text version is generated automatically for recipients whose mail client can't display HTML."
        action={
          <TokenStudioButton
            label="Edit in Template Studio"
            testId="button-open-studio-email"
            title="Email message"
            channel="email"
            fieldSpecs={BULK_CHANNEL_FIELDS.email}
            catalogUrl={catalogUrl}
            treeBaseUrl={BULK_TOKEN_TREE_URL}
            fields={EMAIL_FIELDS}
            values={form}
            onValueChange={(key, value) => setForm((p) => ({ ...p, [key]: value }))}
          />
        }
      />
      <SaveButton
        onClick={() => onSave({ subject: form.subject, bodyHtml: form.bodyHtml })}
        isPending={isPending}
        label="Save Email Content"
        testId="button-save-email-message"
      />
    </div>
  );
}

function SmsForm({ record, onSave, isPending, catalogUrl }: FormProps) {
  const [body, setBody] = useState("");

  useEffect(() => {
    if (record) {
      setBody((record.body as string) || "");
    }
  }, [record]);

  return (
    <div className="space-y-4">
      <TemplateCard
        testId="card-sms-template"
        fields={SMS_FIELDS}
        values={{ body }}
        counts={{
          body: (
            <span className="text-muted-foreground" data-testid="text-sms-body-count">
              {body.length} characters
            </span>
          ),
        }}
        action={
          <TokenStudioButton
            label="Edit in Template Studio"
            testId="button-open-studio-sms"
            title="SMS message"
            channel="sms"
            fieldSpecs={BULK_CHANNEL_FIELDS.sms}
            catalogUrl={catalogUrl}
            treeBaseUrl={BULK_TOKEN_TREE_URL}
            fields={SMS_FIELDS}
            values={{ body }}
            onValueChange={(_key, value) => setBody(value)}
          />
        }
      />
      <SaveButton
        onClick={() => onSave({ body })}
        isPending={isPending}
        label="Save SMS Content"
        testId="button-save-sms-message"
      />
    </div>
  );
}

function PostalForm({ record, onSave, isPending, catalogUrl }: FormProps) {
  const [form, setForm] = useState({
    description: "",
    templateId: "",
    color: false,
    doubleSided: false,
    mailType: "usps_first_class",
  });

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
      <TemplateCard
        testId="card-postal-template"
        fields={POSTAL_FIELDS}
        values={{ description: form.description }}
        action={
          <TokenStudioButton
            label="Edit in Template Studio"
            testId="button-open-studio-postal"
            title="Postal letter"
            channel="postal"
            fieldSpecs={BULK_CHANNEL_FIELDS.postal}
            catalogUrl={catalogUrl}
            treeBaseUrl={BULK_TOKEN_TREE_URL}
            fields={POSTAL_FIELDS}
            values={{ description: form.description }}
            onValueChange={(_key, value) => setForm((p) => ({ ...p, description: value }))}
          />
        }
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="postalTemplateId">Template ID</Label>
          <Input id="postalTemplateId" value={form.templateId} onChange={(e) => setForm((p) => ({ ...p, templateId: e.target.value }))} placeholder="Optional template ID" data-testid="input-postal-template-id" />
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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex items-center space-x-2">
          <Switch id="postalColor" checked={form.color} onCheckedChange={(checked) => setForm((p) => ({ ...p, color: checked }))} data-testid="switch-postal-color" />
          <Label htmlFor="postalColor">Color</Label>
        </div>
        <div className="flex items-center space-x-2">
          <Switch id="postalDoubleSided" checked={form.doubleSided} onCheckedChange={(checked) => setForm((p) => ({ ...p, doubleSided: checked }))} data-testid="switch-postal-double-sided" />
          <Label htmlFor="postalDoubleSided">Double Sided</Label>
        </div>
      </div>
      <SaveButton
        onClick={() => onSave({ ...form })}
        isPending={isPending}
        label="Save Postal Content"
        testId="button-save-postal-message"
      />
    </div>
  );
}

function InappForm({ record, onSave, isPending, catalogUrl }: FormProps) {
  const [form, setForm] = useState({
    title: "",
    bodyHtml: "",
    linkUrl: "",
    linkLabel: "",
  });

  useEffect(() => {
    if (record) {
      const existing = (record.body as string) || "";
      // Treat already-stored plain text as plain text by escaping any HTML
      // metacharacters before turning newlines into <br>, so legacy bodies
      // containing "<" or "&" aren't reinterpreted as markup by the editor.
      const escaped = escapeHtml(existing).replace(/\n/g, "<br>");
      setForm({
        title: (record.title as string) || "",
        bodyHtml: escaped,
        linkUrl: (record.linkUrl as string) || "",
        linkLabel: (record.linkLabel as string) || "",
      });
    }
  }, [record]);

  // Delivery sends the FLATTENED text, so that is what the 500-character
  // column limit applies to — not the rich-text the editor holds.
  const derivedBody = htmlToPlainText(form.bodyHtml);
  const overLimit = derivedBody.length > 500;

  return (
    <div className="space-y-4">
      <TemplateCard
        testId="card-inapp-template"
        fields={INAPP_FIELDS}
        values={form}
        counts={{
          title: (
            <span className={cn(form.title.length > 100 ? "text-destructive" : "text-muted-foreground")} data-testid="text-inapp-title-count">
              {form.title.length} / 100
            </span>
          ),
          bodyHtml: (
            <span className={cn(overLimit ? "text-destructive" : "text-muted-foreground")} data-testid="text-inapp-body-count">
              {derivedBody.length} / 500
            </span>
          ),
          linkLabel: (
            <span className={cn(form.linkLabel.length > 50 ? "text-destructive" : "text-muted-foreground")} data-testid="text-inapp-link-label-count">
              {form.linkLabel.length} / 50
            </span>
          ),
        }}
        footnote="In-app notifications display as plain text; formatting will be flattened on send."
        action={
          <TokenStudioButton
            label="Edit in Template Studio"
            testId="button-open-studio-inapp"
            title="In-app notification"
            channel="inapp"
            fieldSpecs={BULK_CHANNEL_FIELDS.inapp}
            catalogUrl={catalogUrl}
            treeBaseUrl={BULK_TOKEN_TREE_URL}
            fields={INAPP_FIELDS}
            values={form}
            // Delivery sends a flattened plain-text `body`, not the
            // rich-text `bodyHtml` the editor holds — flatten it here so
            // the preview renders what is actually sent.
            templateValues={{
              title: form.title,
              body: derivedBody,
              linkUrl: form.linkUrl,
              linkLabel: form.linkLabel,
            }}
            onValueChange={(key, value) => setForm((p) => ({ ...p, [key]: value }))}
          />
        }
      />
      <SaveButton
        onClick={() => onSave({
          title: form.title,
          body: derivedBody,
          linkUrl: form.linkUrl,
          linkLabel: form.linkLabel,
        })}
        isPending={isPending}
        disabled={overLimit}
        label="Save In-App Content"
        testId="button-save-inapp-message"
      />
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
      toast({ title: "Failed to save", description: getApiErrorMessage(error, "An error occurred"), variant: "destructive" });
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
              catalogUrl={bulkTokenCatalogUrl(bulkMessage.id)}
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
