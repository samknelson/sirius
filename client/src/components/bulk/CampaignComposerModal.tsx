import { useState, useEffect, useRef, useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { SimpleHtmlEditor } from "@/components/ui/simple-html-editor";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Loader2,
  Mail,
  MessageSquare,
  MapPin,
  Bell,
  Send,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronDown,
  Search,
  User,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface TokenInfo {
  token: string;
  description: string;
  example: string;
}

interface ReadinessChannel {
  ready: number;
  missing: number;
  total: number;
}

interface CampaignComposerModalProps {
  open: boolean;
  onClose: () => void;
  audienceType: "worker" | "employer_contact";
  audienceFilters: Record<string, unknown>;
  audienceLabel?: string;
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
  inapp: "Internal Log",
};

const SMS_SEGMENT_LENGTH = 160;

function TokenDropdown({ onInsert }: { onInsert: (token: string) => void }) {
  const { data: tokens = [] } = useQuery<TokenInfo[]>({
    queryKey: ["/api/bulk-campaigns/tokens/available"],
  });

  if (tokens.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" data-testid="button-insert-token">
          <ChevronDown className="h-3 w-3 mr-1" />
          Insert Token
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-60 overflow-y-auto">
        {tokens.map((t) => (
          <DropdownMenuItem
            key={t.token}
            onClick={() => onInsert(t.token)}
            data-testid={`menu-token-${t.token}`}
          >
            <code className="text-xs mr-2 bg-muted px-1 rounded">{t.token}</code>
            <span className="text-xs text-muted-foreground">{t.description}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function insertAtCursor(ref: React.RefObject<HTMLTextAreaElement | HTMLInputElement | null>, token: string, currentValue: string, setValue: (v: string) => void) {
  const el = ref.current;
  if (!el) {
    setValue(currentValue + token);
    return;
  }
  const start = el.selectionStart ?? currentValue.length;
  const end = el.selectionEnd ?? currentValue.length;
  const newVal = currentValue.slice(0, start) + token + currentValue.slice(end);
  setValue(newVal);
  requestAnimationFrame(() => {
    el.focus();
    const pos = start + token.length;
    el.setSelectionRange(pos, pos);
  });
}

function TestSendButton({ campaignId, medium, label }: { campaignId: string; medium: string; label: string }) {
  const { toast } = useToast();
  const [contactSearch, setContactSearch] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedContact, setSelectedContact] = useState<any>(null);
  const [showSearch, setShowSearch] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(contactSearch), 300);
    return () => clearTimeout(timer);
  }, [contactSearch]);

  const { data: searchResults = [], isFetching } = useQuery<any[]>({
    queryKey: ["/api/contacts/search", debouncedQuery],
    queryFn: () => apiRequest("GET", `/api/contacts/search?q=${encodeURIComponent(debouncedQuery)}`),
    enabled: debouncedQuery.trim().length >= 2 && !selectedContact,
  });

  const testMutation = useMutation({
    mutationFn: (contactId: string) =>
      apiRequest("POST", `/api/bulk-campaigns/${campaignId}/test-send`, { contactId, medium }),
    onSuccess: (result: any) => {
      if (result.success) {
        toast({ title: `${label} test sent`, description: "Test message delivered successfully." });
      } else {
        toast({ title: `${label} test failed`, description: result.error || "Unknown error", variant: "destructive" });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Test send failed", description: error.message, variant: "destructive" });
    },
  });

  if (!showSearch) {
    return (
      <Button variant="outline" size="sm" onClick={() => setShowSearch(true)} data-testid={`button-test-send-${medium}`}>
        <Send className="h-3 w-3 mr-1" />
        Send Test
      </Button>
    );
  }

  return (
    <div className="border rounded-lg p-3 space-y-2 bg-muted/30" data-testid={`test-send-panel-${medium}`}>
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium">Send test {label}</Label>
        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => { setShowSearch(false); setSelectedContact(null); setContactSearch(""); }}>
          Close
        </Button>
      </div>
      {!selectedContact ? (
        <>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search contact..."
              className="pl-7 h-8 text-sm"
              value={contactSearch}
              onChange={(e) => setContactSearch(e.target.value)}
              data-testid={`input-test-contact-${medium}`}
            />
          </div>
          {debouncedQuery.trim().length >= 2 && (
            <div className="border rounded max-h-32 overflow-y-auto">
              {searchResults.length === 0 && !isFetching && (
                <p className="p-2 text-xs text-muted-foreground text-center">No contacts found</p>
              )}
              {searchResults.map((c: any) => (
                <div
                  key={c.id}
                  className="px-2 py-1.5 text-xs hover:bg-accent cursor-pointer flex items-center gap-2"
                  onClick={() => { setSelectedContact(c); setContactSearch(c.displayName); }}
                >
                  <User className="h-3 w-3" />
                  {c.displayName}
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">{selectedContact.displayName}</Badge>
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={() => testMutation.mutate(selectedContact.id)}
            disabled={testMutation.isPending}
            data-testid={`button-confirm-test-${medium}`}
          >
            {testMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3 mr-1" />}
            Send
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setSelectedContact(null); setContactSearch(""); }}>
            Change
          </Button>
        </div>
      )}
    </div>
  );
}

function EmailTab({ campaignId, emailState, setEmailState }: {
  campaignId: string | null;
  emailState: { subject: string; bodyHtml: string };
  setEmailState: (s: { subject: string; bodyHtml: string }) => void;
}) {
  const subjectRef = useRef<HTMLInputElement>(null);
  const [lastFocused, setLastFocused] = useState<"subject" | "body">("body");

  const handleInsertToken = useCallback((token: string) => {
    if (lastFocused === "subject") {
      insertAtCursor(subjectRef, token, emailState.subject, (v) => setEmailState({ ...emailState, subject: v }));
    } else {
      const editorEl = document.querySelector('[data-testid="editor-composer-email-body"] [contenteditable="true"]') as HTMLElement | null;
      if (editorEl) {
        editorEl.focus();
        document.execCommand("insertText", false, token);
      } else {
        setEmailState({ ...emailState, bodyHtml: emailState.bodyHtml + token });
      }
    }
  }, [emailState, setEmailState, lastFocused]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <TokenDropdown onInsert={handleInsertToken} />
        {campaignId && <TestSendButton campaignId={campaignId} medium="email" label="Email" />}
      </div>
      <div className="space-y-2">
        <Label>Subject Line</Label>
        <Input
          ref={subjectRef}
          value={emailState.subject}
          onChange={(e) => setEmailState({ ...emailState, subject: e.target.value })}
          onFocus={() => setLastFocused("subject")}
          placeholder="Enter email subject..."
          data-testid="input-composer-email-subject"
        />
      </div>
      <div className="space-y-2" onFocus={() => setLastFocused("body")}>
        <Label>Email Body</Label>
        <SimpleHtmlEditor
          value={emailState.bodyHtml}
          onChange={(v) => setEmailState({ ...emailState, bodyHtml: v })}
          placeholder="Compose your email..."
          data-testid="editor-composer-email-body"
        />
      </div>
    </div>
  );
}

function SmsTab({ campaignId, smsState, setSmsState }: {
  campaignId: string | null;
  smsState: { body: string };
  setSmsState: (s: { body: string }) => void;
}) {
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const segments = Math.max(1, Math.ceil(smsState.body.length / SMS_SEGMENT_LENGTH));
  const remaining = SMS_SEGMENT_LENGTH - (smsState.body.length % SMS_SEGMENT_LENGTH || SMS_SEGMENT_LENGTH);

  const handleInsertToken = useCallback((token: string) => {
    insertAtCursor(bodyRef, token, smsState.body, (v) => setSmsState({ body: v }));
  }, [smsState, setSmsState]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <TokenDropdown onInsert={handleInsertToken} />
        {campaignId && <TestSendButton campaignId={campaignId} medium="sms" label="SMS" />}
      </div>
      <div className="space-y-2">
        <Label>Message Body</Label>
        <Textarea
          ref={bodyRef}
          value={smsState.body}
          onChange={(e) => setSmsState({ body: e.target.value })}
          rows={6}
          placeholder="Enter SMS message..."
          data-testid="textarea-composer-sms-body"
        />
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">{smsState.body.length} characters</span>
            <span className="text-muted-foreground">·</span>
            <span className={segments > 1 ? "text-yellow-600 font-medium" : "text-muted-foreground"}>
              {segments} segment{segments !== 1 ? "s" : ""}
            </span>
          </div>
          {smsState.body.length > 0 && (
            <span className={remaining < 20 ? "text-yellow-600 font-medium" : "text-muted-foreground"}>
              {remaining} chars remaining in segment
            </span>
          )}
        </div>
        {segments > 1 && (
          <div className="flex items-center gap-2 p-2 rounded bg-yellow-50 dark:bg-yellow-950/30 text-xs text-yellow-700 dark:text-yellow-400">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
            <span>Message exceeds 160 characters and will be sent as {segments} segments. Some carriers may split or truncate long messages.</span>
          </div>
        )}
      </div>
    </div>
  );
}

function PostalTab({ campaignId, postalState, setPostalState }: {
  campaignId: string | null;
  postalState: { description: string; templateId: string; color: boolean; doubleSided: boolean; mailType: string };
  setPostalState: (s: any) => void;
}) {
  const descRef = useRef<HTMLTextAreaElement>(null);

  const handleInsertToken = useCallback((token: string) => {
    insertAtCursor(descRef, token, postalState.description, (v) => setPostalState({ ...postalState, description: v }));
  }, [postalState, setPostalState]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <TokenDropdown onInsert={handleInsertToken} />
        {campaignId && <TestSendButton campaignId={campaignId} medium="postal" label="Postal" />}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Description / Notes</Label>
          <Textarea
            ref={descRef}
            value={postalState.description}
            onChange={(e) => setPostalState({ ...postalState, description: e.target.value })}
            rows={3}
            placeholder="Postal mail description..."
            data-testid="textarea-composer-postal-description"
          />
        </div>
        <div className="space-y-2">
          <Label>Template ID / PDF Reference</Label>
          <Input
            value={postalState.templateId}
            onChange={(e) => setPostalState({ ...postalState, templateId: e.target.value })}
            placeholder="e.g. tmpl_abc123 or PDF filename"
            data-testid="input-composer-postal-template"
          />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="flex items-center space-x-2">
          <Switch
            checked={postalState.color}
            onCheckedChange={(c) => setPostalState({ ...postalState, color: c })}
            data-testid="switch-composer-postal-color"
          />
          <Label>Color</Label>
        </div>
        <div className="flex items-center space-x-2">
          <Switch
            checked={postalState.doubleSided}
            onCheckedChange={(c) => setPostalState({ ...postalState, doubleSided: c })}
            data-testid="switch-composer-postal-double-sided"
          />
          <Label>Double Sided</Label>
        </div>
        <div className="space-y-2">
          <Label>Mail Type</Label>
          <Select value={postalState.mailType} onValueChange={(v) => setPostalState({ ...postalState, mailType: v })}>
            <SelectTrigger data-testid="select-composer-postal-mail-type"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="usps_first_class">USPS First Class</SelectItem>
              <SelectItem value="usps_standard">USPS Standard</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

function InternalLogTab({ campaignId, inappState, setInappState, emailState }: {
  campaignId: string | null;
  inappState: { title: string; body: string; linkUrl: string; linkLabel: string; mirrorEmail: boolean };
  setInappState: (s: any) => void;
  emailState: { subject: string; bodyHtml: string };
}) {
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (inappState.mirrorEmail) {
      setInappState({
        ...inappState,
        title: emailState.subject,
        body: emailState.bodyHtml.replace(/<[^>]*>/g, "").substring(0, 500),
      });
    }
  }, [inappState.mirrorEmail, emailState.subject, emailState.bodyHtml]);

  const handleInsertToken = useCallback((token: string) => {
    insertAtCursor(bodyRef, token, inappState.body, (v) => setInappState({ ...inappState, body: v }));
  }, [inappState, setInappState]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <TokenDropdown onInsert={handleInsertToken} />
          <div className="flex items-center space-x-2">
            <Switch
              checked={inappState.mirrorEmail}
              onCheckedChange={(c) => setInappState({ ...inappState, mirrorEmail: c })}
              data-testid="switch-mirror-email"
            />
            <Label className="text-xs">Mirror Email Content</Label>
          </div>
        </div>
        {campaignId && <TestSendButton campaignId={campaignId} medium="inapp" label="Internal Log" />}
      </div>
      <div className="space-y-2">
        <Label>Title</Label>
        <Input
          value={inappState.title}
          onChange={(e) => setInappState({ ...inappState, title: e.target.value })}
          maxLength={100}
          placeholder="Notification title"
          disabled={inappState.mirrorEmail}
          data-testid="input-composer-inapp-title"
        />
        <div className="flex justify-end"><span className="text-xs text-muted-foreground">{inappState.title.length}/100</span></div>
      </div>
      <div className="space-y-2">
        <Label>Body</Label>
        <Textarea
          ref={bodyRef}
          value={inappState.body}
          onChange={(e) => setInappState({ ...inappState, body: e.target.value })}
          rows={4}
          maxLength={500}
          placeholder="Summary or custom note..."
          disabled={inappState.mirrorEmail}
          data-testid="textarea-composer-inapp-body"
        />
        <div className="flex justify-end"><span className="text-xs text-muted-foreground">{inappState.body.length}/500</span></div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Link URL</Label>
          <Input
            value={inappState.linkUrl}
            onChange={(e) => setInappState({ ...inappState, linkUrl: e.target.value })}
            maxLength={2048}
            placeholder="https://..."
            data-testid="input-composer-inapp-link-url"
          />
        </div>
        <div className="space-y-2">
          <Label>Link Label</Label>
          <Input
            value={inappState.linkLabel}
            onChange={(e) => setInappState({ ...inappState, linkLabel: e.target.value })}
            maxLength={50}
            placeholder="Click here"
            data-testid="input-composer-inapp-link-label"
          />
        </div>
      </div>
    </div>
  );
}

const TIMEZONE_OPTIONS = [
  { value: "America/New_York", label: "Eastern (ET)" },
  { value: "America/Chicago", label: "Central (CT)" },
  { value: "America/Denver", label: "Mountain (MT)" },
  { value: "America/Los_Angeles", label: "Pacific (PT)" },
  { value: "America/Anchorage", label: "Alaska (AKT)" },
  { value: "Pacific/Honolulu", label: "Hawaii (HT)" },
  { value: "UTC", label: "UTC" },
];

export function CampaignComposerModal({ open, onClose, audienceType, audienceFilters, audienceLabel }: CampaignComposerModalProps) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [campaignName, setCampaignName] = useState("");
  const [activeChannels, setActiveChannels] = useState<Record<string, boolean>>({
    email: true,
    sms: false,
    postal: false,
    inapp: false,
  });
  const [activeTab, setActiveTab] = useState("email");

  const [emailState, setEmailState] = useState({ subject: "", bodyHtml: "" });
  const [smsState, setSmsState] = useState({ body: "" });
  const [postalState, setPostalState] = useState({
    description: "", templateId: "", color: false, doubleSided: false, mailType: "usps_first_class",
  });
  const [inappState, setInappState] = useState({
    title: "", body: "", linkUrl: "", linkLabel: "", mirrorEmail: false,
  });

  const [scheduleMode, setScheduleMode] = useState<"now" | "later">("now");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [timezone, setTimezone] = useState("America/New_York");

  const [createdCampaignId, setCreatedCampaignId] = useState<string | null>(null);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [step, setStep] = useState<"compose" | "review">("compose");

  const { data: readiness } = useQuery<{ channels: Record<string, ReadinessChannel>; totalContacts: number }>({
    queryKey: ["/api/bulk-campaigns", createdCampaignId, "readiness"],
    enabled: !!createdCampaignId && step === "review",
  });

  const enabledChannels = Object.entries(activeChannels)
    .filter(([, enabled]) => enabled)
    .map(([ch]) => ch);

  const toggleChannel = (channel: string) => {
    const newState = { ...activeChannels, [channel]: !activeChannels[channel] };
    const hasAny = Object.values(newState).some(Boolean);
    if (!hasAny) return;
    setActiveChannels(newState);
    if (!newState[activeTab]) {
      const firstActive = Object.entries(newState).find(([, v]) => v)?.[0] || "email";
      setActiveTab(firstActive);
    }
  };

  const createAndSaveMutation = useMutation({
    mutationFn: async () => {
      const campaign = await apiRequest("POST", "/api/bulk-campaigns", {
        name: campaignName.trim(),
        audienceType,
        channels: enabledChannels,
        audienceFilters,
      });

      const campaignId = campaign.id;

      const savePromises: Promise<any>[] = [];
      if (activeChannels.email) {
        savePromises.push(
          apiRequest("PUT", `/api/bulk-campaigns/${campaignId}/messages/email`, {
            subject: emailState.subject,
            bodyHtml: emailState.bodyHtml,
            bodyText: emailState.bodyHtml.replace(/<[^>]*>/g, ""),
          })
        );
      }
      if (activeChannels.sms) {
        savePromises.push(
          apiRequest("PUT", `/api/bulk-campaigns/${campaignId}/messages/sms`, { body: smsState.body })
        );
      }
      if (activeChannels.postal) {
        savePromises.push(
          apiRequest("PUT", `/api/bulk-campaigns/${campaignId}/messages/postal`, postalState)
        );
      }
      if (activeChannels.inapp) {
        savePromises.push(
          apiRequest("PUT", `/api/bulk-campaigns/${campaignId}/messages/inapp`, {
            title: inappState.title,
            body: inappState.body,
            linkUrl: inappState.linkUrl,
            linkLabel: inappState.linkLabel,
          })
        );
      }

      await Promise.all(savePromises);

      await apiRequest("POST", `/api/bulk-campaigns/${campaignId}/import-audience`, {
        audienceType,
        filters: audienceFilters,
      });

      return campaign;
    },
    onSuccess: (campaign) => {
      setCreatedCampaignId(campaign.id);
      setStep("review");
      toast({ title: "Campaign created", description: "Review readiness and confirm to queue." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create campaign", description: error.message, variant: "destructive" });
    },
  });

  const queueMutation = useMutation({
    mutationFn: async () => {
      if (!createdCampaignId) throw new Error("No campaign to queue");
      let scheduledAt: string | undefined;
      if (scheduleMode === "later" && scheduledDate && scheduledTime) {
        const formatter = new Intl.DateTimeFormat("en-US", {
          timeZone: timezone,
          year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit", second: "2-digit",
          hour12: false,
        });
        const localDateStr = `${scheduledDate}T${scheduledTime}:00`;
        const tempDate = new Date(localDateStr);
        const offsetDate = new Date(tempDate.getTime());
        const parts = formatter.formatToParts(offsetDate);
        const getPart = (type: string) => parts.find(p => p.type === type)?.value || "";
        const localFormatted = `${getPart("year")}-${getPart("month")}-${getPart("day")}T${getPart("hour")}:${getPart("minute")}:${getPart("second")}`;
        const localMs = new Date(localFormatted).getTime();
        const targetMs = offsetDate.getTime();
        const tzOffsetMs = targetMs - localMs;
        const corrected = new Date(tempDate.getTime() + tzOffsetMs);
        scheduledAt = corrected.toISOString();
      }
      return apiRequest("POST", `/api/bulk-campaigns/${createdCampaignId}/queue`, scheduledAt ? { scheduledAt, timezone } : {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bulk-campaigns"] });
      toast({ title: "Campaign queued", description: scheduleMode === "later" ? "Campaign scheduled for delivery." : "Campaign queued for immediate delivery." });
      setShowConfirmation(false);
      onClose();
      setLocation(`/campaigns/${createdCampaignId}`);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to queue", description: error.message, variant: "destructive" });
    },
  });

  const handleProceedToReview = () => {
    if (!campaignName.trim()) {
      toast({ title: "Name required", description: "Please enter a campaign name.", variant: "destructive" });
      return;
    }
    if (enabledChannels.length === 0) {
      toast({ title: "No channels", description: "Enable at least one channel.", variant: "destructive" });
      return;
    }
    createAndSaveMutation.mutate();
  };

  const handleConfirmQueue = () => {
    setShowConfirmation(true);
  };

  const handleClose = () => {
    if (createdCampaignId && step === "review") {
      setLocation(`/campaigns/${createdCampaignId}`);
    }
    onClose();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
        <DialogContent className="fixed inset-4 max-w-none w-auto h-auto translate-x-0 translate-y-0 left-4 top-4 right-4 bottom-4 overflow-y-auto flex flex-col" data-testid="dialog-campaign-composer">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2" data-testid="heading-composer-title">
              {step === "compose" ? "New Campaign" : "Review & Confirm"}
            </DialogTitle>
          </DialogHeader>

          {step === "compose" && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Campaign Name *</Label>
                  <Input
                    value={campaignName}
                    onChange={(e) => setCampaignName(e.target.value)}
                    placeholder="e.g. Q1 Member Outreach"
                    data-testid="input-composer-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Audience</Label>
                  <div className="flex items-center gap-2 h-10 px-3 border rounded-md bg-muted/30">
                    <Badge variant="outline" className="text-xs">
                      {audienceType === "worker" ? "Workers" : "Employer Contacts"}
                    </Badge>
                    {audienceLabel && (
                      <span className="text-sm text-muted-foreground truncate">{audienceLabel}</span>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <Label className="mb-2 block">Active Channels</Label>
                <div className="flex flex-wrap gap-3">
                  {(["email", "sms", "postal", "inapp"] as const).map((ch) => {
                    const Icon = mediumIcons[ch];
                    const isActive = activeChannels[ch];
                    return (
                      <div
                        key={ch}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                          isActive ? "border-primary bg-primary/5" : "border-border opacity-60"
                        }`}
                        onClick={() => toggleChannel(ch)}
                        data-testid={`toggle-channel-${ch}`}
                      >
                        <Switch checked={isActive} onCheckedChange={() => toggleChannel(ch)} />
                        <Icon className="h-4 w-4" />
                        <span className="text-sm font-medium">{mediumLabels[ch]}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="w-full justify-start">
                  {enabledChannels.map((ch) => {
                    const Icon = mediumIcons[ch];
                    return (
                      <TabsTrigger key={ch} value={ch} className="gap-1" data-testid={`tab-composer-${ch}`}>
                        <Icon className="h-4 w-4" />
                        {mediumLabels[ch]}
                      </TabsTrigger>
                    );
                  })}
                </TabsList>

                {activeChannels.email && (
                  <TabsContent value="email">
                    <EmailTab campaignId={createdCampaignId} emailState={emailState} setEmailState={setEmailState} />
                  </TabsContent>
                )}
                {activeChannels.sms && (
                  <TabsContent value="sms">
                    <SmsTab campaignId={createdCampaignId} smsState={smsState} setSmsState={setSmsState} />
                  </TabsContent>
                )}
                {activeChannels.postal && (
                  <TabsContent value="postal">
                    <PostalTab campaignId={createdCampaignId} postalState={postalState} setPostalState={setPostalState} />
                  </TabsContent>
                )}
                {activeChannels.inapp && (
                  <TabsContent value="inapp">
                    <InternalLogTab campaignId={createdCampaignId} inappState={inappState} setInappState={setInappState} emailState={emailState} />
                  </TabsContent>
                )}
              </Tabs>

              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm">Scheduling</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="schedule" checked={scheduleMode === "now"} onChange={() => setScheduleMode("now")} className="accent-primary" data-testid="radio-send-now" />
                      <span className="text-sm font-medium">Send Now</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="schedule" checked={scheduleMode === "later"} onChange={() => setScheduleMode("later")} className="accent-primary" data-testid="radio-schedule-later" />
                      <span className="text-sm font-medium">Schedule for Later</span>
                    </label>
                  </div>
                  {scheduleMode === "later" && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Date</Label>
                        <Input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} data-testid="input-schedule-date" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Time</Label>
                        <Input type="time" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)} data-testid="input-schedule-time" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Timezone</Label>
                        <Select value={timezone} onValueChange={setTimezone}>
                          <SelectTrigger data-testid="select-timezone"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {TIMEZONE_OPTIONS.map((tz) => (
                              <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="flex justify-end gap-3 pt-2">
                <Button variant="outline" onClick={handleClose} data-testid="button-composer-cancel">
                  Cancel
                </Button>
                <Button onClick={handleProceedToReview} disabled={createAndSaveMutation.isPending} data-testid="button-composer-review">
                  {createAndSaveMutation.isPending ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creating...</>
                  ) : (
                    "Review & Confirm"
                  )}
                </Button>
              </div>
            </div>
          )}

          {step === "review" && (
            <div className="space-y-6">
              <Card data-testid="card-readiness-summary">
                <CardHeader>
                  <CardTitle className="text-base">Readiness Summary</CardTitle>
                  <CardDescription>Per-channel recipient readiness before delivery.</CardDescription>
                </CardHeader>
                <CardContent>
                  {readiness ? (
                    <div className="space-y-3">
                      {Object.entries(readiness.channels).map(([medium, info]) => {
                        const Icon = mediumIcons[medium] || Mail;
                        const pct = info.total > 0 ? (info.ready / info.total) * 100 : 0;
                        return (
                          <div key={medium} className="flex items-center gap-3" data-testid={`readiness-summary-${medium}`}>
                            <Icon className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-sm font-medium">{mediumLabels[medium]}</span>
                                <span className="text-xs text-muted-foreground">
                                  {info.ready} ready{info.missing > 0 && <>, <span className="text-yellow-600">{info.missing} missing</span></>}
                                </span>
                              </div>
                              <Progress value={pct} className="h-1.5" />
                            </div>
                            {info.missing === 0 && info.total > 0 ? (
                              <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
                            ) : info.missing > 0 ? (
                              <AlertTriangle className="h-4 w-4 text-yellow-600 flex-shrink-0" />
                            ) : null}
                          </div>
                        );
                      })}
                      <p className="text-xs text-muted-foreground pt-2">
                        Total contacts: {readiness.totalContacts}
                      </p>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 py-4">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm text-muted-foreground">Loading readiness data...</span>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Campaign Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <dt className="text-muted-foreground">Name</dt>
                      <dd className="font-medium">{campaignName}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Audience</dt>
                      <dd className="font-medium">{audienceType === "worker" ? "Workers" : "Employer Contacts"}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Channels</dt>
                      <dd className="flex flex-wrap gap-1">
                        {enabledChannels.map((ch) => {
                          const Icon = mediumIcons[ch];
                          return (
                            <Badge key={ch} variant="outline" className="gap-1 text-xs">
                              <Icon className="h-3 w-3" />
                              {mediumLabels[ch]}
                            </Badge>
                          );
                        })}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Schedule</dt>
                      <dd className="font-medium">
                        {scheduleMode === "now" ? "Send Now" : `${scheduledDate} ${scheduledTime} (${TIMEZONE_OPTIONS.find(t => t.value === timezone)?.label || timezone})`}
                      </dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>

              <div className="flex justify-between gap-3 pt-2">
                <Button variant="outline" onClick={() => setStep("compose")} data-testid="button-back-to-compose">
                  Back to Edit
                </Button>
                <div className="flex gap-3">
                  <Button variant="outline" onClick={handleClose} data-testid="button-save-draft">
                    Save as Draft
                  </Button>
                  <Button onClick={handleConfirmQueue} data-testid="button-proceed-to-confirm">
                    Proceed to Queue
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={showConfirmation} onOpenChange={setShowConfirmation}>
        <AlertDialogContent data-testid="dialog-confirm-queue">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Campaign Queue</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to queue "{campaignName}" for delivery.
              {readiness?.totalContacts != null && (
                <span className="block mt-2 font-medium text-foreground">
                  {readiness.totalContacts} recipients across {enabledChannels.length} channel{enabledChannels.length !== 1 ? "s" : ""}.
                </span>
              )}
              {scheduleMode === "later" && scheduledDate && (
                <span className="block mt-1">
                  Scheduled for: {scheduledDate} at {scheduledTime} ({TIMEZONE_OPTIONS.find(t => t.value === timezone)?.label || timezone})
                </span>
              )}
              <span className="block mt-2 text-sm">This action cannot be easily undone. Are you sure you want to proceed?</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-queue">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => queueMutation.mutate()}
              disabled={queueMutation.isPending}
              data-testid="button-final-proceed"
            >
              {queueMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Proceed
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
