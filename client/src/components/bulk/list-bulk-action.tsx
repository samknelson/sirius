import { useState } from "react";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ChevronDown, Loader2, MailPlus, ListChecks } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ExistingMessageChooserContent, type ExistingBulkMessageOption } from "./existing-message-chooser-content";
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
  const [chooserOpen, setChooserOpen] = useState(false);
  const [chosenBulkMessageId, setChosenBulkMessageId] = useState<string | null>(null);
  const [selectedMedia, setSelectedMedia] = useState<Record<Medium, boolean>>({
    email: true,
    sms: false,
    inapp: false,
    postal: false,
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingMediums, setPendingMediums] = useState<Medium[]>([]);

  const { data: componentConfig = [] } = useQuery<ComponentConfig[]>({
    queryKey: ["/api/components/config"],
    staleTime: 60000,
  });

  const bulkEnabled = componentConfig.find(c => c.componentId === "bulk")?.enabled ?? false;
  const existingMessagesQuery = useQuery<ExistingBulkMessageOption[]>({
    queryKey: ["/api/bulk-messages/eligible-drafts"],
    enabled: chooserOpen,
    staleTime: 0,
  });
  const addToExistingMutation = useMutation<{
    bulkMessage: { id: string }; participantsCreated: number; participantsSkipped: number;
  }, Error, string>({
    mutationFn: (bulkMessageId) => apiRequest("POST", "/api/bulk-messages/from-recipients", {
      contactIds: selectedContactIds, bulkMessageId,
      ...(reportSelection ? { reportSelection } : {}),
    }),
    onSuccess: async (result) => {
      setChooserOpen(false);
      setChosenBulkMessageId(null);
      await queryClient.invalidateQueries({ queryKey: ["/api/bulk-messages"] });
      toast({ title: "Recipients added to draft", description: `${result.participantsCreated} recipient/channel entries added; ${result.participantsSkipped} already present. Nothing was sent.` });
      navigate(`/bulk/${result.bulkMessage.id}/recipients/list`);
    },
    onError: (error) => toast({ title: "Couldn’t add recipients", description: error.message, variant: "destructive" }),
  });

  const createMutation = useMutation<{ bulkMessage: { id: string }; participantsCreated: number; recipientsResolved: number; recipientsMissing: number }, Error, Medium[]>({
    mutationFn: async (medium) => {
      return apiRequest("POST", "/api/bulk-messages/from-recipients", {
        contactIds: selectedContactIds,
        sourceLabel,
        ...(reportSelection ? { reportSelection } : {}),
        medium,
      });
    },
    onSuccess: (result) => {
      setConfirmOpen(false);
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
    if (requiresConfirmation) {
      setPendingMediums(chosenMedia);
      setConfirmOpen(true);
      return;
    }
    createMutation.mutate(chosenMedia);
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
      <DropdownMenu>
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
          <DropdownMenuItem
            disabled={noSelection || createMutation.isPending || addToExistingMutation.isPending}
            onSelect={() => { setChosenBulkMessageId(null); setChooserOpen(true); }}
            data-testid={`${testIdPrefix}-existing-message`}
          >
            Add to existing draft
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={chooserOpen} onOpenChange={(open) => { if (!addToExistingMutation.isPending) setChooserOpen(open); }}>
        <DialogContent data-testid={`${testIdPrefix}-existing-dialog`}>
          <ExistingMessageChooserContent
            messages={existingMessagesQuery.data ?? []}
            isLoading={existingMessagesQuery.isLoading}
            isError={existingMessagesQuery.isError}
            isFetching={existingMessagesQuery.isFetching}
            selectedContactCount={selectionCount}
            selectedBulkMessageId={chosenBulkMessageId}
            isPending={addToExistingMutation.isPending}
            testIdPrefix={testIdPrefix}
            onSelect={setChosenBulkMessageId}
            onRetry={() => { void existingMessagesQuery.refetch(); }}
            onCancel={() => setChooserOpen(false)}
            onSubmit={() => { if (chosenBulkMessageId) addToExistingMutation.mutate(chosenBulkMessageId); }}
          />
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirmOpen} onOpenChange={(open) => { if (!createMutation.isPending) setConfirmOpen(open); }}>
        <AlertDialogContent data-testid={`${testIdPrefix}-confirm-dialog`}>
          <AlertDialogHeader>
            <AlertDialogTitle>Create bulk message draft?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <div data-testid={`${testIdPrefix}-confirm-summary`}>
                  You're about to create a draft with{" "}
                  <span className="font-semibold text-foreground">
                    {selectionCount.toLocaleString()} recipient{selectionCount === 1 ? "" : "s"}
                  </span>
                  {" "}from{" "}
                  <span className="font-semibold text-foreground" data-testid={`${testIdPrefix}-confirm-source`}>
                    {sourceLabel}
                  </span>
                  .
                </div>
                <div data-testid={`${testIdPrefix}-confirm-mediums`}>
                  Channels: <span className="font-semibold text-foreground">{pendingMediums.join(", ")}</span>
                </div>
                <div className="text-xs">
                  Drafts of this size can be slow to delete. Confirm to continue.
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={createMutation.isPending} data-testid={`${testIdPrefix}-confirm-cancel`}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={createMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                createMutation.mutate(pendingMediums);
              }}
              data-testid={`${testIdPrefix}-confirm-create`}
            >
              {createMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Create draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
