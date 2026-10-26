import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { BulkTemplateSelector, type BulkTemplateIds } from "@/components/bulk/bulk-template-selector";
import { ExistingMessageChooserContent, type ExistingBulkMessageOption } from "@/components/bulk/existing-message-chooser-content";
import { ChevronDown, Loader2, MailPlus, ListChecks, Send } from "lucide-react";
import type { ComplianceView } from "@shared/worker-comms-compliance";

const LARGE_DRAFT_THRESHOLD = 100;

interface ComponentConfig {
  componentId: string;
  enabled: boolean;
}

interface ListBulkActionProps {
  reportSelection?: { definitionId: string; view: ComplianceView };
  selectedContactIds: string[];
  totalMatching: number;
  visibleSelectedCount: number;
  onSelectAllMatching: () => void;
  isSelectingAllMatching?: boolean;
  selectAllMatchingDisabled?: boolean;
  sourceLabel: string;
  testIdPrefix?: string;
}

type Medium = "email" | "sms" | "inapp" | "postal";

interface AddRecipientsResult {
  bulkMessage: { id: string };
  participantsCreated: number;
  recipientsResolved: number;
  recipientsMissing: number;
  participantsSkipped: number;
}

const MEDIUM_OPTIONS: { value: Medium; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "sms", label: "SMS" },
  { value: "inapp", label: "In-app" },
  { value: "postal", label: "Postal" },
];

export function ListBulkAction({
  reportSelection,
  selectedContactIds,
  totalMatching,
  visibleSelectedCount,
  onSelectAllMatching,
  isSelectingAllMatching = false,
  selectAllMatchingDisabled = false,
  sourceLabel,
  testIdPrefix = "list-bulk-action",
}: ListBulkActionProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedMedia, setSelectedMedia] = useState<Record<Medium, boolean>>({
    email: true,
    sms: false,
    inapp: false,
    postal: false,
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [templateIds, setTemplateIds] = useState<BulkTemplateIds>({});
  const [largeDraftConfirmed, setLargeDraftConfirmed] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [chosenBulkMessageId, setChosenBulkMessageId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const { data: componentConfig = [] } = useQuery<ComponentConfig[]>({
    queryKey: ["/api/components/config"],
    staleTime: 60000,
  });

  const bulkEnabled = componentConfig.find(c => c.componentId === "bulk")?.enabled ?? false;

  const existingMessagesQuery = useQuery<ExistingBulkMessageOption[]>({
    queryKey: ["/api/bulk-messages"],
    queryFn: () => apiRequest("GET", "/api/bulk-messages"),
    enabled: chooserOpen,
    staleTime: 30000,
  });

  const chosenExistingMessage = existingMessagesQuery.data?.find((message) => message.id === chosenBulkMessageId);
  const existingMedia = (chosenExistingMessage?.medium ?? []).filter(
    (medium): medium is Medium => MEDIUM_OPTIONS.some((option) => option.value === medium),
  );
  const editableExisting = chosenExistingMessage?.status === "draft";
  const hasExistingTemplates = Object.keys(templateIds).length > 0;

  useEffect(() => {
    setTemplateIds((previous) => Object.fromEntries(
      Object.entries(previous).filter(([medium]) => selectedMedia[medium as Medium]),
    ) as BulkTemplateIds);
  }, [selectedMedia]);

  const createMutation = useMutation<{ bulkMessage: { id: string }; participantsCreated: number; recipientsResolved: number; recipientsMissing: number }, Error, { medium: Medium[]; templateIds: BulkTemplateIds }>({
    mutationFn: async ({ medium, templateIds: chosenTemplates }) => {
      return apiRequest("POST", "/api/bulk-messages/from-recipients", {
        contactIds: selectedContactIds,
        sourceLabel,
        reportSelection,
        medium,
        ...(Object.keys(chosenTemplates).length ? { templateIds: chosenTemplates } : {}),
      });
    },
    onSuccess: (result) => {
      setCreateOpen(false);
      setLargeDraftConfirmed(false);
      setTemplateIds({});
      toast({
        title: "Bulk message draft created",
        description: `${result.recipientsResolved} recipient${result.recipientsResolved === 1 ? "" : "s"} attached${result.recipientsMissing ? `, ${result.recipientsMissing} skipped` : ""}.`,
      });
      navigate(`/bulk/${result.bulkMessage.id}/message`);
    },
    onError: (error) => {
      toast({
        title: "Failed to create bulk message",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const addToExistingMutation = useMutation<AddRecipientsResult, Error, { bulkMessageId: string; templateIds: BulkTemplateIds }>({
    mutationFn: ({ bulkMessageId, templateIds: chosenTemplates }) => apiRequest("POST", "/api/bulk-messages/from-recipients", {
      contactIds: selectedContactIds,
      bulkMessageId,
      reportSelection,
      ...(Object.keys(chosenTemplates).length ? { templateIds: chosenTemplates } : {}),
    }),
    onSuccess: async (result) => {
      const targetId = result.bulkMessage.id;
      setChooserOpen(false);
      setChosenBulkMessageId(null);
      setTemplateIds({});
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/bulk-messages", targetId] }),
        queryClient.invalidateQueries({ queryKey: ["/api/bulk-messages", targetId, "participants"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/bulk-messages", targetId, "delivery-stats"] }),
      ]);
      const created = result.participantsCreated;
      const duplicates = result.participantsSkipped;
      const missing = result.recipientsMissing;
      const details = [
        `${created} recipient/channel entr${created === 1 ? "y" : "ies"} added`,
        ...(duplicates ? [`${duplicates} already enrolled`] : []),
        ...(missing ? [`${missing} skipped (not found)`] : []),
      ];
      toast({
        title: "Recipients added to message",
        description: `${details.join(" · ")}.`,
      });
      navigate(`/bulk/${targetId}/recipients/list`);
    },
    onError: (error) => {
      toast({
        title: "Couldn’t add recipients",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (!bulkEnabled) return null;

  const selectionCount = selectedContactIds.length;
  const noSelection = selectionCount === 0;
  const allMatchingSelected = totalMatching > 0 && selectionCount >= totalMatching;
  const showSelectAll = totalMatching > visibleSelectedCount && !allMatchingSelected;
  const chosenMedia = MEDIUM_OPTIONS.filter(o => selectedMedia[o.value]).map(o => o.value);
  const noMedia = chosenMedia.length === 0;
  const messageDisabled = noSelection || noMedia || createMutation.isPending;

  const requiresConfirmation = selectionCount >= LARGE_DRAFT_THRESHOLD;

  const handleMessageClick = () => {
    if (messageDisabled) return;
    setLargeDraftConfirmed(false);
    setTemplateIds({});
    setMenuOpen(false);
    window.setTimeout(() => setCreateOpen(true), 0);
  };

  const messageItem = (
    <DropdownMenuItem
      disabled={messageDisabled}
      onSelect={(e) => {
        e.preventDefault();
        handleMessageClick();
      }}
      data-testid={`${testIdPrefix}-message`}
    >
      {createMutation.isPending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <MailPlus className="mr-2 h-4 w-4" />
      )}
      Create draft{noSelection ? "" : ` (${selectionCount})`}
    </DropdownMenuItem>
  );
  const existingMessageItem = (
    <DropdownMenuItem
      disabled={noSelection || addToExistingMutation.isPending}
      onSelect={(e) => {
        e.preventDefault();
        if (noSelection || addToExistingMutation.isPending) return;
        setChosenBulkMessageId(null);
        setTemplateIds({});
        setMenuOpen(false);
        window.setTimeout(() => setChooserOpen(true), 0);
      }}
      data-testid={`${testIdPrefix}-existing-message`}
    >
      <Send className="mr-2 h-4 w-4" />
      Add to existing message{noSelection ? "" : ` (${selectionCount})`}
    </DropdownMenuItem>
  );

  const disabledReason = noSelection
    ? "Select one or more recipients first"
    : noMedia
      ? "Choose at least one channel"
      : null;

  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid={`${testIdPrefix}-container`}>
      {showSelectAll && (
        <Button
          variant="outline"
          size="sm"
          onClick={onSelectAllMatching}
          disabled={isSelectingAllMatching || selectAllMatchingDisabled}
          data-testid={`${testIdPrefix}-select-all-matching`}
        >
          {isSelectingAllMatching ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <ListChecks className="mr-2 h-4 w-4" />
          )}
          Select all {totalMatching.toLocaleString()} matching
        </Button>
      )}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="default"
            size="sm"
          disabled={createMutation.isPending || addToExistingMutation.isPending}
            data-testid={`${testIdPrefix}-trigger`}
          >
            Bulk Action
            <ChevronDown className="ml-2 h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Channels</DropdownMenuLabel>
          {MEDIUM_OPTIONS.map((opt) => (
            <DropdownMenuCheckboxItem
              key={opt.value}
              checked={selectedMedia[opt.value]}
              onCheckedChange={(checked) =>
                setSelectedMedia((prev) => ({ ...prev, [opt.value]: !!checked }))
              }
              onSelect={(e) => e.preventDefault()}
              data-testid={`${testIdPrefix}-medium-${opt.value}`}
            >
              {opt.label}
            </DropdownMenuCheckboxItem>
          ))}
          <DropdownMenuSeparator />
          {existingMessageItem}
          <DropdownMenuSeparator />
          {disabledReason ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div data-testid={`${testIdPrefix}-message-disabled-wrapper`}>{messageItem}</div>
                </TooltipTrigger>
                <TooltipContent>{disabledReason}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            messageItem
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        open={chooserOpen}
        onOpenChange={(open) => {
          if (!addToExistingMutation.isPending) {
            setChooserOpen(open);
            if (!open) {
              setChosenBulkMessageId(null);
              setTemplateIds({});
            }
          }
        }}
      >
        <DialogContent className="sm:max-w-xl" data-testid={`${testIdPrefix}-existing-dialog`}>
          <ExistingMessageChooserContent
            messages={existingMessagesQuery.data ?? []}
            isLoading={existingMessagesQuery.isLoading}
            isError={existingMessagesQuery.isError}
            isFetching={existingMessagesQuery.isFetching}
            selectedContactCount={selectionCount}
            selectedBulkMessageId={chosenBulkMessageId}
            isPending={addToExistingMutation.isPending}
            testIdPrefix={testIdPrefix}
            onSelect={(id) => {
              setChosenBulkMessageId(id);
              setTemplateIds({});
            }}
            onRetry={() => existingMessagesQuery.refetch()}
            onCancel={() => setChooserOpen(false)}
            onSubmit={() => {
              if (!selectedContactIds.length || !chosenBulkMessageId || addToExistingMutation.isPending) return;
              addToExistingMutation.mutate({
                bulkMessageId: chosenBulkMessageId,
                templateIds: editableExisting ? templateIds : {},
              });
            }}
          >
            {chosenExistingMessage && editableExisting && (
              <div className="space-y-3">
                <BulkTemplateSelector
                  media={existingMedia}
                  value={templateIds}
                  onChange={setTemplateIds}
                  disabled={addToExistingMutation.isPending}
                  testIdPrefix={testIdPrefix}
                />
                {hasExistingTemplates && (
                  <Alert variant="destructive">
                    <AlertDescription>
                      Applying a template replaces authored fields on this draft for all of its recipients. Other message and delivery settings remain unchanged.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}
          </ExistingMessageChooserContent>
        </DialogContent>
      </Dialog>
      <Dialog open={createOpen} onOpenChange={(open) => {
        if (!createMutation.isPending) {
          setCreateOpen(open);
          if (!open) {
            setTemplateIds({});
            setLargeDraftConfirmed(false);
          }
        }
      }}>
        <DialogContent className="max-w-2xl" data-testid={`${testIdPrefix}-create-dialog`}>
          <DialogHeader>
            <DialogTitle>Create bulk message draft</DialogTitle>
            <DialogDescription>
              Create a draft for {selectionCount.toLocaleString()} selected recipient{selectionCount === 1 ? "" : "s"} from {sourceLabel}. Choose wording separately for each channel.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
            <div className="flex flex-wrap gap-2">
              {chosenMedia.map((medium) => <span key={medium} className="rounded border bg-muted/40 px-2 py-1 text-xs capitalize">{medium}</span>)}
            </div>
            <BulkTemplateSelector
              media={chosenMedia}
              value={templateIds}
              onChange={setTemplateIds}
              disabled={createMutation.isPending}
              testIdPrefix={testIdPrefix}
            />
            {requiresConfirmation && (
              <Alert variant="destructive">
                <AlertDescription className="space-y-3">
                  <p>This draft includes {selectionCount.toLocaleString()} recipients. Drafts of this size can be slow to delete.</p>
                  <label className="flex items-start gap-2 text-sm text-foreground">
                    <Checkbox checked={largeDraftConfirmed} onCheckedChange={(checked) => setLargeDraftConfirmed(Boolean(checked))} disabled={createMutation.isPending} />
                    <span>I reviewed the recipient count and want to create this draft.</span>
                  </label>
                </AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>Cancel</Button>
            <Button
              type="button"
              onClick={() => createMutation.mutate({ medium: chosenMedia, templateIds })}
              disabled={createMutation.isPending || (requiresConfirmation && !largeDraftConfirmed)}
              data-testid={`${testIdPrefix}-create-submit`}
            >
              {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MailPlus className="mr-2 h-4 w-4" />}
              Create draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
