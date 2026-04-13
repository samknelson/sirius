import { useState, useEffect, useMemo } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { apiRequest } from "@/lib/queryClient";
import {
  ArrowLeft,
  Loader2,
  Mail,
  MessageSquare,
  MapPin,
  Bell,
  Megaphone,
  Save,
  Users,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Play,
  Square,
  Send,
  Search,
  Download,
  User,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { BulkCampaign } from "@shared/schema/bulk/schema";

interface CampaignDetail extends BulkCampaign {
  creatorName?: string;
  messages?: Array<{ id: string; medium: string; status: string; name: string }>;
  channelContent?: Record<string, Record<string, unknown> | null>;
}

interface ReadinessData {
  channels: Record<string, { ready: number; missing: number; total: number }>;
  totalContacts: number;
}

interface CampaignStats {
  channelStats: Record<string, Record<string, number>>;
  totals: { pending: number; sent: number; failed: number };
  overallProgress: number;
}

interface CampaignError {
  contactDisplayName: string;
  medium: string;
  errorMessage: string;
}

interface TokenInfo {
  token: string;
  description: string;
  example: string;
}

interface CampaignParticipant {
  id: string;
  contactId: string;
  contactDisplayName: string;
  medium: string;
  status: string;
}

interface ImportResult {
  totalCreated: number;
  totalSkipped: number;
  channelCount: number;
}

interface TestSendChannelResult {
  medium: string;
  success: boolean;
  error?: string;
  commId?: string;
}

interface TestSendResult {
  success: boolean;
  error?: string;
  medium?: string;
  channels?: TestSendChannelResult[];
}

interface SearchContact {
  id: string;
  displayName: string;
  email?: string;
  phone?: string;
}

interface TestSendPayload {
  contactId: string;
  medium?: string;
}

const statusVariants: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "secondary",
  queued: "outline",
  processing: "default",
  completed: "default",
  failed: "destructive",
  aborted: "secondary",
};

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
  inapp: "Internal Log",
};

function OverviewTab({ campaign, onRefresh }: { campaign: CampaignDetail; onRefresh: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: stats } = useQuery<CampaignStats>({
    queryKey: ["/api/bulk-campaigns", campaign.id, "stats"],
  });

  const { data: readiness } = useQuery<ReadinessData>({
    queryKey: ["/api/bulk-campaigns", campaign.id, "readiness"],
    enabled: campaign.status === "draft",
  });

  const queueMutation = useMutation({
    mutationFn: (scheduledAt?: string) =>
      apiRequest("POST", `/api/bulk-campaigns/${campaign.id}/queue`, scheduledAt ? { scheduledAt } : {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bulk-campaigns"] });
      onRefresh();
      toast({ title: "Campaign queued", description: "The campaign has been queued for delivery." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to queue campaign", description: error.message, variant: "destructive" });
    },
  });

  const abortMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/bulk-campaigns/${campaign.id}/abort`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bulk-campaigns"] });
      onRefresh();
      toast({ title: "Campaign aborted" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to abort", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6">
      <Card data-testid="card-campaign-overview">
        <CardHeader>
          <CardTitle>Campaign Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Status</dt>
              <dd className="mt-1">
                <Badge variant={statusVariants[campaign.status]} data-testid="badge-campaign-status">
                  {campaign.status}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Audience Type</dt>
              <dd className="mt-1 text-sm" data-testid="text-audience-type">
                {campaign.audienceType === "worker" ? "Workers" : "Employer Contacts"}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Channels</dt>
              <dd className="mt-1 flex flex-wrap gap-1">
                {campaign.channels?.map((ch) => {
                  const Icon = mediumIcons[ch] || Mail;
                  return (
                    <Badge key={ch} variant="outline" className="gap-1">
                      <Icon className="h-3 w-3" />
                      {mediumLabels[ch] || ch}
                    </Badge>
                  );
                })}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Created</dt>
              <dd className="mt-1 text-sm">{new Date(campaign.createdAt).toLocaleString()}</dd>
            </div>
            {campaign.scheduledAt && (
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Scheduled</dt>
                <dd className="mt-1 text-sm">{new Date(campaign.scheduledAt).toLocaleString()}</dd>
              </div>
            )}
            {campaign.creatorName && (
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Created By</dt>
                <dd className="mt-1 text-sm">{campaign.creatorName}</dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      {stats && (
        <Card data-testid="card-campaign-stats">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Delivery Progress
              <Button variant="ghost" size="sm" onClick={onRefresh} data-testid="button-refresh-stats">
                <RefreshCw className="h-4 w-4" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <Progress value={stats.overallProgress} className="flex-1" />
              <span className="text-sm font-medium">{Math.round(stats.overallProgress)}%</span>
            </div>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="p-3 rounded-lg bg-green-50 dark:bg-green-950/30">
                <p className="text-2xl font-bold text-green-600" data-testid="text-sent-count">{stats.totals.sent}</p>
                <p className="text-xs text-muted-foreground">Sent</p>
              </div>
              <div className="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-950/30">
                <p className="text-2xl font-bold text-yellow-600" data-testid="text-pending-count">{stats.totals.pending}</p>
                <p className="text-xs text-muted-foreground">Pending</p>
              </div>
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30">
                <p className="text-2xl font-bold text-red-600" data-testid="text-failed-count">{stats.totals.failed}</p>
                <p className="text-xs text-muted-foreground">Failed</p>
              </div>
            </div>
            {Object.entries(stats.channelStats).length > 0 && (
              <div className="space-y-2 pt-2">
                <p className="text-sm font-medium text-muted-foreground">Per-Channel Breakdown</p>
                {Object.entries(stats.channelStats).map(([medium, statuses]) => {
                  const Icon = mediumIcons[medium] || Mail;
                  return (
                    <div key={medium} className="flex items-center gap-2 text-sm">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium w-16">{mediumLabels[medium] || medium}</span>
                      <div className="flex gap-2 flex-wrap">
                        {Object.entries(statuses)
                          .filter(([, value]) => typeof value === "number")
                          .map(([status, count]) => (
                          <Badge key={status} variant="outline" className="text-xs">
                            {status}: {count}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {readiness && campaign.status === "draft" && (
        <Card data-testid="card-campaign-readiness">
          <CardHeader>
            <CardTitle>Channel Readiness</CardTitle>
            <CardDescription>Indicates how many recipients have valid contact info per channel.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Object.entries(readiness.channels).map(([medium, info]) => {
                const Icon = mediumIcons[medium] || Mail;
                const allReady = info.missing === 0 && info.total > 0;
                return (
                  <div key={medium} className="flex items-center gap-3 p-3 rounded-lg border" data-testid={`readiness-${medium}`}>
                    <Icon className="h-5 w-5 text-muted-foreground" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{mediumLabels[medium] || medium}</span>
                        {allReady ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                        ) : info.total === 0 ? (
                          <AlertTriangle className="h-4 w-4 text-yellow-600" />
                        ) : (
                          <AlertTriangle className="h-4 w-4 text-yellow-600" />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {info.ready} ready, {info.missing} missing of {info.total} total
                      </p>
                    </div>
                    {info.total > 0 && (
                      <Progress value={(info.ready / info.total) * 100} className="w-24 h-1.5" />
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Actions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {campaign.status === "draft" && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button data-testid="button-queue-campaign">
                  <Play className="h-4 w-4 mr-2" />
                  Queue for Delivery
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Queue Campaign</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will queue all channel messages for delivery. The campaign will begin sending when the next delivery cycle runs.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => queueMutation.mutate(undefined)}
                    data-testid="button-confirm-queue"
                  >
                    {queueMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Queue Now"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {(campaign.status === "queued" || campaign.status === "processing") && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" data-testid="button-abort-campaign">
                  <Square className="h-4 w-4 mr-2" />
                  Abort Campaign
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Abort Campaign</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will stop the campaign. Messages already sent cannot be recalled.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => abortMutation.mutate()}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    data-testid="button-confirm-abort"
                  >
                    {abortMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Abort"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ChannelsTab({ campaign }: { campaign: CampaignDetail }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeChannel, setActiveChannel] = useState<string>(campaign.channels?.[0] || "email");

  const { data: tokens } = useQuery<TokenInfo[]>({
    queryKey: ["/api/bulk-campaigns/tokens/available"],
  });

  const saveMutation = useMutation({
    mutationFn: ({ medium, data }: { medium: string; data: Record<string, unknown> }) =>
      apiRequest("PUT", `/api/bulk-campaigns/${campaign.id}/messages/${medium}`, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bulk-campaigns", campaign.id] });
      toast({ title: `${mediumLabels[variables.medium] || variables.medium} content saved` });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save", description: error.message, variant: "destructive" });
    },
  });

  const isDraft = campaign.status === "draft";
  const content = campaign.channelContent || {};

  return (
    <div className="space-y-4">
      {tokens && tokens.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Available Tokens</CardTitle>
          </CardHeader>
          <CardContent className="py-2">
            <div className="flex flex-wrap gap-2">
              {tokens.map((t) => (
                <Badge
                  key={t.token}
                  variant="outline"
                  className="cursor-pointer hover:bg-primary/10 text-xs"
                  title={`${t.description} — e.g. ${t.example}`}
                  onClick={() => navigator.clipboard.writeText(t.token).then(() =>
                    toast({ title: "Copied", description: `${t.token} copied to clipboard` })
                  )}
                  data-testid={`token-badge-${t.token}`}
                >
                  {t.token}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">Click a token to copy it. Tokens are replaced with recipient data at delivery time.</p>
          </CardContent>
        </Card>
      )}

      <Tabs value={activeChannel} onValueChange={setActiveChannel}>
        <TabsList className="w-full justify-start">
          {campaign.channels?.map((ch) => {
            const Icon = mediumIcons[ch] || Mail;
            return (
              <TabsTrigger key={ch} value={ch} className="gap-1" data-testid={`tab-channel-${ch}`}>
                <Icon className="h-4 w-4" />
                {mediumLabels[ch] || ch}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {campaign.channels?.map((ch) => (
          <TabsContent key={ch} value={ch}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {(() => { const Icon = mediumIcons[ch] || Mail; return <Icon className="h-5 w-5" />; })()}
                  {mediumLabels[ch] || ch} Content
                </CardTitle>
              </CardHeader>
              <CardContent>
                {ch === "email" && (
                  <EmailChannelForm
                    record={content[ch] || null}
                    onSave={(data) => saveMutation.mutate({ medium: ch, data })}
                    isPending={saveMutation.isPending}
                    disabled={!isDraft}
                  />
                )}
                {ch === "sms" && (
                  <SmsChannelForm
                    record={content[ch] || null}
                    onSave={(data) => saveMutation.mutate({ medium: ch, data })}
                    isPending={saveMutation.isPending}
                    disabled={!isDraft}
                  />
                )}
                {ch === "postal" && (
                  <PostalChannelForm
                    record={content[ch] || null}
                    onSave={(data) => saveMutation.mutate({ medium: ch, data })}
                    isPending={saveMutation.isPending}
                    disabled={!isDraft}
                  />
                )}
                {ch === "inapp" && (
                  <InappChannelForm
                    record={content[ch] || null}
                    onSave={(data) => saveMutation.mutate({ medium: ch, data })}
                    isPending={saveMutation.isPending}
                    disabled={!isDraft}
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function EmailChannelForm({ record, onSave, isPending, disabled }: {
  record: Record<string, unknown> | null;
  onSave: (data: Record<string, unknown>) => void;
  isPending: boolean;
  disabled: boolean;
}) {
  const [form, setForm] = useState({ subject: "", bodyText: "", bodyHtml: "" });

  useEffect(() => {
    if (record) {
      setForm({
        subject: (record.subject as string) || "",
        bodyText: (record.bodyText as string) || (record.body_text as string) || "",
        bodyHtml: (record.bodyHtml as string) || (record.body_html as string) || "",
      });
    }
  }, [record]);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Subject</Label>
        <Input value={form.subject} onChange={(e) => setForm(p => ({ ...p, subject: e.target.value }))} disabled={disabled} placeholder="Email subject" data-testid="input-campaign-email-subject" />
      </div>
      <div className="space-y-2">
        <Label>Body (Plain Text)</Label>
        <Textarea value={form.bodyText} onChange={(e) => setForm(p => ({ ...p, bodyText: e.target.value }))} rows={6} disabled={disabled} placeholder="Plain text email body" data-testid="textarea-campaign-email-body-text" />
      </div>
      <div className="space-y-2">
        <Label>Body (HTML)</Label>
        <Textarea value={form.bodyHtml} onChange={(e) => setForm(p => ({ ...p, bodyHtml: e.target.value }))} rows={6} disabled={disabled} className="font-mono text-sm" placeholder="<html>...</html>" data-testid="textarea-campaign-email-body-html" />
      </div>
      {!disabled && (
        <div className="flex justify-end">
          <Button onClick={() => onSave(form)} disabled={isPending} data-testid="button-save-campaign-email">
            {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Save Email Content
          </Button>
        </div>
      )}
    </div>
  );
}

function SmsChannelForm({ record, onSave, isPending, disabled }: {
  record: Record<string, unknown> | null;
  onSave: (data: Record<string, unknown>) => void;
  isPending: boolean;
  disabled: boolean;
}) {
  const [body, setBody] = useState("");

  useEffect(() => {
    if (record) setBody((record.body as string) || "");
  }, [record]);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Message Body</Label>
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} disabled={disabled} placeholder="SMS message" data-testid="textarea-campaign-sms-body" />
        <div className="flex justify-end"><span className="text-xs text-muted-foreground">{body.length} characters</span></div>
      </div>
      {!disabled && (
        <div className="flex justify-end">
          <Button onClick={() => onSave({ body })} disabled={isPending} data-testid="button-save-campaign-sms">
            {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Save SMS Content
          </Button>
        </div>
      )}
    </div>
  );
}

function PostalChannelForm({ record, onSave, isPending, disabled }: {
  record: Record<string, unknown> | null;
  onSave: (data: Record<string, unknown>) => void;
  isPending: boolean;
  disabled: boolean;
}) {
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
        templateId: (record.templateId as string) || (record.template_id as string) || "",
        color: (record.color as boolean) || false,
        doubleSided: (record.doubleSided as boolean) || (record.double_sided as boolean) || false,
        mailType: (record.mailType as string) || (record.mail_type as string) || "usps_first_class",
      });
    }
  }, [record]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Description</Label>
          <Textarea value={form.description} onChange={(e) => setForm(p => ({ ...p, description: e.target.value }))} rows={3} disabled={disabled} data-testid="textarea-campaign-postal-description" />
        </div>
        <div className="space-y-2">
          <Label>Template ID</Label>
          <Input value={form.templateId} onChange={(e) => setForm(p => ({ ...p, templateId: e.target.value }))} disabled={disabled} placeholder="Optional template ID" data-testid="input-campaign-postal-template" />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="flex items-center space-x-2">
          <Switch checked={form.color} onCheckedChange={(c) => setForm(p => ({ ...p, color: c }))} disabled={disabled} data-testid="switch-campaign-postal-color" />
          <Label>Color</Label>
        </div>
        <div className="flex items-center space-x-2">
          <Switch checked={form.doubleSided} onCheckedChange={(c) => setForm(p => ({ ...p, doubleSided: c }))} disabled={disabled} data-testid="switch-campaign-postal-double-sided" />
          <Label>Double Sided</Label>
        </div>
        <div className="space-y-2">
          <Label>Mail Type</Label>
          <Select value={form.mailType} onValueChange={(v) => setForm(p => ({ ...p, mailType: v }))} disabled={disabled}>
            <SelectTrigger data-testid="select-campaign-postal-mail-type"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="usps_first_class">USPS First Class</SelectItem>
              <SelectItem value="usps_standard">USPS Standard</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {!disabled && (
        <div className="flex justify-end">
          <Button onClick={() => onSave(form)} disabled={isPending} data-testid="button-save-campaign-postal">
            {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Save Postal Content
          </Button>
        </div>
      )}
    </div>
  );
}

function InappChannelForm({ record, onSave, isPending, disabled }: {
  record: Record<string, unknown> | null;
  onSave: (data: Record<string, unknown>) => void;
  isPending: boolean;
  disabled: boolean;
}) {
  const [form, setForm] = useState({ title: "", body: "", linkUrl: "", linkLabel: "" });

  useEffect(() => {
    if (record) {
      setForm({
        title: (record.title as string) || "",
        body: (record.body as string) || "",
        linkUrl: (record.linkUrl as string) || (record.link_url as string) || "",
        linkLabel: (record.linkLabel as string) || (record.link_label as string) || "",
      });
    }
  }, [record]);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Title</Label>
        <Input value={form.title} onChange={(e) => setForm(p => ({ ...p, title: e.target.value }))} disabled={disabled} maxLength={100} placeholder="Notification title" data-testid="input-campaign-inapp-title" />
        <div className="flex justify-end"><span className="text-xs text-muted-foreground">{form.title.length}/100</span></div>
      </div>
      <div className="space-y-2">
        <Label>Body</Label>
        <Textarea value={form.body} onChange={(e) => setForm(p => ({ ...p, body: e.target.value }))} rows={4} disabled={disabled} maxLength={500} placeholder="Notification body" data-testid="textarea-campaign-inapp-body" />
        <div className="flex justify-end"><span className="text-xs text-muted-foreground">{form.body.length}/500</span></div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Link URL</Label>
          <Input value={form.linkUrl} onChange={(e) => setForm(p => ({ ...p, linkUrl: e.target.value }))} disabled={disabled} maxLength={2048} placeholder="https://..." data-testid="input-campaign-inapp-link-url" />
        </div>
        <div className="space-y-2">
          <Label>Link Label</Label>
          <Input value={form.linkLabel} onChange={(e) => setForm(p => ({ ...p, linkLabel: e.target.value }))} disabled={disabled} maxLength={50} placeholder="Click here" data-testid="input-campaign-inapp-link-label" />
        </div>
      </div>
      {!disabled && (
        <div className="flex justify-end">
          <Button onClick={() => onSave(form)} disabled={isPending} data-testid="button-save-campaign-inapp">
            {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Save In-App Content
          </Button>
        </div>
      )}
    </div>
  );
}

function AudienceTab({ campaign }: { campaign: CampaignDetail }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");

  const { data: participants = [], isLoading: participantsLoading } = useQuery<CampaignParticipant[]>({
    queryKey: ["/api/bulk-campaigns", campaign.id, "participants"],
  });

  const importMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/bulk-campaigns/${campaign.id}/import-audience`, {
        audienceType: campaign.audienceType,
        filters: campaign.audienceFilters || {},
      }),
    onSuccess: (result: ImportResult) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bulk-campaigns", campaign.id, "participants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bulk-campaigns", campaign.id, "readiness"] });
      toast({
        title: "Audience imported",
        description: `${result.totalCreated} recipients added across ${result.channelCount} channels. ${result.totalSkipped} skipped.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Import failed", description: error.message, variant: "destructive" });
    },
  });

  const filtered = participants.filter((p: CampaignParticipant) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return p.contactDisplayName?.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-4">
      {campaign.status === "draft" && (
        <Card>
          <CardHeader>
            <CardTitle>Import Audience</CardTitle>
            <CardDescription>
              Import {campaign.audienceType === "worker" ? "workers" : "employer contacts"} as recipients for all enabled channels.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button data-testid="button-import-audience">
                  {importMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  Import Audience
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Import Audience</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will import all matching {campaign.audienceType === "worker" ? "workers" : "employer contacts"} as recipients for each channel. Existing recipients will be skipped.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => importMutation.mutate()} data-testid="button-confirm-import">
                    Import
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      )}

      <Card data-testid="card-campaign-participants">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-3">
            <CardTitle>Recipients</CardTitle>
            <Badge variant="secondary">{participants.length}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Filter recipients..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                data-testid="input-filter-campaign-recipients"
              />
            </div>
          </div>

          {participantsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : participants.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Users className="h-12 w-12 text-muted-foreground/50 mb-3" />
              <p className="text-muted-foreground">No recipients yet.</p>
              <p className="text-sm text-muted-foreground mt-1">Use the Import Audience button above to add recipients.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full" data-testid="table-campaign-participants">
                <thead className="bg-muted/20">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Name</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Channel</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((p: CampaignParticipant) => {
                    const Icon = mediumIcons[p.medium] || Mail;
                    return (
                      <tr key={p.id} className="hover:bg-muted/30 transition-colors" data-testid={`row-campaign-participant-${p.id}`}>
                        <td className="px-4 py-3 text-sm font-medium">{p.contactDisplayName || "—"}</td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className="text-xs gap-1">
                            <Icon className="h-3 w-3" />
                            {mediumLabels[p.medium] || p.medium}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={p.status === "send_failed" ? "destructive" : "secondary"} className="text-xs">
                            {p.status || "pending"}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filtered.length === 0 && search.trim() && (
                <p className="py-8 text-center text-sm text-muted-foreground">No recipients match "{search}".</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ErrorsTab({ campaign }: { campaign: CampaignDetail }) {
  const { data: errors = [], isLoading } = useQuery<CampaignError[]>({
    queryKey: ["/api/bulk-campaigns", campaign.id, "errors"],
  });

  return (
    <Card data-testid="card-campaign-errors">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <XCircle className="h-5 w-5 text-destructive" />
          Delivery Errors
          {errors.length > 0 && <Badge variant="destructive">{errors.length}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : errors.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <CheckCircle2 className="h-12 w-12 text-green-500/50 mb-3" />
            <p className="text-muted-foreground">No delivery errors found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted/20">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Recipient</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Channel</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {errors.map((err, i) => {
                  const Icon = mediumIcons[err.medium] || Mail;
                  return (
                    <tr key={i} className="hover:bg-muted/30 transition-colors" data-testid={`row-error-${i}`}>
                      <td className="px-4 py-3 text-sm font-medium">{err.contactDisplayName}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="text-xs gap-1">
                          <Icon className="h-3 w-3" />
                          {mediumLabels[err.medium] || err.medium}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-sm text-destructive">{err.errorMessage}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TestSendTab({ campaign }: { campaign: CampaignDetail }) {
  const { toast } = useToast();
  const [contactSearch, setContactSearch] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedContact, setSelectedContact] = useState<SearchContact | null>(null);
  const [selectedMedium, setSelectedMedium] = useState<string>("all");
  const [lastResult, setLastResult] = useState<TestSendResult | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(contactSearch), 300);
    return () => clearTimeout(timer);
  }, [contactSearch]);

  const { data: searchResults = [], isFetching: isSearching } = useQuery<SearchContact[]>({
    queryKey: ["/api/contacts/search", debouncedQuery],
    queryFn: () => apiRequest("GET", `/api/contacts/search?q=${encodeURIComponent(debouncedQuery)}`),
    enabled: debouncedQuery.trim().length >= 2 && !selectedContact,
  });

  const testMutation = useMutation({
    mutationFn: (data: { contactId: string; medium?: string }) =>
      apiRequest("POST", `/api/bulk-campaigns/${campaign.id}/test-send`, data),
    onSuccess: (result: TestSendResult) => {
      setLastResult(result);
      if (result.success) {
        toast({ title: "Test sent successfully" });
      } else if (result.channels) {
        const succeeded = result.channels.filter(c => c.success).length;
        const failed = result.channels.filter(c => !c.success).length;
        if (succeeded > 0) {
          toast({ title: `Test partially sent`, description: `${succeeded} channel(s) sent, ${failed} failed. See results below.` });
        } else {
          toast({ title: "Test send failed", description: "All channels failed. See results below.", variant: "destructive" });
        }
      } else {
        toast({ title: "Test send failed", description: result.error || "Check results below", variant: "destructive" });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Test send failed", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6">
      <Card data-testid="card-campaign-test-send">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            Test Send
          </CardTitle>
          <CardDescription>Send a test message to a specific contact to verify content before delivery.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Search for a contact</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Type a name or email..."
                className="pl-9"
                value={contactSearch}
                onChange={(e) => {
                  setContactSearch(e.target.value);
                  if (selectedContact) { setSelectedContact(null); setLastResult(null); }
                }}
                data-testid="input-campaign-test-contact-search"
              />
            </div>
          </div>

          {debouncedQuery.trim().length >= 2 && !selectedContact && (
            <div className="border rounded-md max-h-60 overflow-y-auto">
              {searchResults.length === 0 && !isSearching && (
                <p className="p-4 text-sm text-muted-foreground text-center">No contacts found</p>
              )}
              {searchResults.map((c: SearchContact) => (
                <div
                  key={c.id}
                  className="px-4 py-3 hover:bg-accent transition-colors cursor-pointer border-b last:border-b-0 flex items-center gap-3"
                  onClick={() => { setSelectedContact(c); setContactSearch(c.displayName || ""); }}
                  data-testid={`button-test-select-contact-${c.id}`}
                >
                  <User className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{c.displayName}</p>
                    {c.email && <p className="text-xs text-muted-foreground">{c.email}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {selectedContact && (
            <div className="border rounded-md p-4 bg-accent/30 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <User className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium">{selectedContact.displayName}</p>
                  {selectedContact.email && <p className="text-xs text-muted-foreground">{selectedContact.email}</p>}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setSelectedContact(null); setContactSearch(""); setLastResult(null); }}>
                Clear
              </Button>
            </div>
          )}

          {campaign.channels && campaign.channels.length > 1 && (
            <div className="space-y-2">
              <Label>Channel</Label>
              <Select value={selectedMedium} onValueChange={setSelectedMedium}>
                <SelectTrigger data-testid="select-test-medium"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Channels</SelectItem>
                  {campaign.channels.map((ch) => (
                    <SelectItem key={ch} value={ch}>{mediumLabels[ch] || ch}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <Button
            onClick={() => {
              if (selectedContact) {
                const payload: TestSendPayload = { contactId: selectedContact.id };
                if (selectedMedium !== "all") payload.medium = selectedMedium;
                testMutation.mutate(payload);
              }
            }}
            disabled={!selectedContact || testMutation.isPending}
            className="w-full"
            data-testid="button-send-campaign-test"
          >
            {testMutation.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sending...</>
            ) : (
              <><Send className="h-4 w-4 mr-2" />Send Test</>
            )}
          </Button>
        </CardContent>
      </Card>

      {lastResult && (
        <Card data-testid="card-campaign-test-result">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {lastResult.success ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : <AlertTriangle className="h-5 w-5 text-yellow-600" />}
              Test Result
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {lastResult.channels && lastResult.channels.length > 0 ? (
              lastResult.channels.map((ch) => {
                const Icon = mediumIcons[ch.medium] || Mail;
                return (
                  <div key={ch.medium} className="flex items-start gap-3 p-3 rounded-lg border" data-testid={`test-result-${ch.medium}`}>
                    <Icon className="h-4 w-4 mt-0.5 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{mediumLabels[ch.medium] || ch.medium}</span>
                        {ch.success ? (
                          <Badge variant="default" className="text-xs gap-1"><CheckCircle2 className="h-3 w-3" />Sent</Badge>
                        ) : (
                          <Badge variant="destructive" className="text-xs gap-1"><XCircle className="h-3 w-3" />Failed</Badge>
                        )}
                      </div>
                      {ch.error && (
                        <p className="text-xs text-muted-foreground mt-1">{ch.error}</p>
                      )}
                    </div>
                  </div>
                );
              })
            ) : (
              <>
                <Badge variant={lastResult.success ? "default" : "destructive"}>
                  {lastResult.success ? "Success" : "Failed"}
                </Badge>
                {lastResult.error && (
                  <p className="text-sm text-destructive mt-2">{lastResult.error}</p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  usePageTitle("Campaign Detail");

  const { data: campaign, isLoading, error } = useQuery<CampaignDetail>({
    queryKey: ["/api/bulk-campaigns", id],
    enabled: !!id,
  });

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/bulk-campaigns", id] });
    queryClient.invalidateQueries({ queryKey: ["/api/bulk-campaigns", id, "stats"] });
    queryClient.invalidateQueries({ queryKey: ["/api/bulk-campaigns", id, "readiness"] });
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <Skeleton className="h-10 w-48 mb-4" />
        <Skeleton className="h-6 w-96 mb-8" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !campaign) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <Link href="/campaigns">
          <Button variant="ghost" size="sm" className="mb-4">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Campaigns
          </Button>
        </Link>
        <Card>
          <CardContent className="py-12 text-center">
            <XCircle className="h-12 w-12 text-destructive mx-auto mb-3" />
            <p className="text-muted-foreground">Campaign not found or an error occurred.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <Link href="/campaigns">
        <Button variant="ghost" size="sm" className="mb-4" data-testid="button-back-to-campaigns">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Campaigns
        </Button>
      </Link>

      <div className="flex items-center gap-3 mb-6">
        <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
          <Megaphone className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold" data-testid="heading-campaign-name">{campaign.name}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant={statusVariants[campaign.status]} data-testid="badge-campaign-status-header">
              {campaign.status}
            </Badge>
            {campaign.channels?.map((ch) => {
              const Icon = mediumIcons[ch] || Mail;
              return (
                <Badge key={ch} variant="outline" className="gap-1 text-xs">
                  <Icon className="h-3 w-3" />
                  {mediumLabels[ch] || ch}
                </Badge>
              );
            })}
          </div>
        </div>
      </div>

      <Tabs defaultValue={new URLSearchParams(window.location.search).get("tab") || "overview"} className="space-y-6">
        <TabsList data-testid="tabs-campaign-detail">
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="channels" data-testid="tab-channels">Channels</TabsTrigger>
          <TabsTrigger value="audience" data-testid="tab-audience">Audience</TabsTrigger>
          <TabsTrigger value="test" data-testid="tab-test">Test</TabsTrigger>
          <TabsTrigger value="errors" data-testid="tab-errors">Errors</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab campaign={campaign} onRefresh={handleRefresh} />
        </TabsContent>
        <TabsContent value="channels">
          <ChannelsTab campaign={campaign} />
        </TabsContent>
        <TabsContent value="audience">
          <AudienceTab campaign={campaign} />
        </TabsContent>
        <TabsContent value="test">
          <TestSendTab campaign={campaign} />
        </TabsContent>
        <TabsContent value="errors">
          <ErrorsTab campaign={campaign} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
