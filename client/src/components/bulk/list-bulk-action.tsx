import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
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
import { ChevronDown, Loader2, MailPlus, ListChecks } from "lucide-react";

interface ComponentConfig {
  componentId: string;
  enabled: boolean;
}

interface ListBulkActionProps {
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
  const [selectedMedia, setSelectedMedia] = useState<Record<Medium, boolean>>({
    email: true,
    sms: false,
    inapp: false,
    postal: false,
  });

  const { data: componentConfig = [] } = useQuery<ComponentConfig[]>({
    queryKey: ["/api/components/config"],
    staleTime: 60000,
  });

  const bulkEnabled = componentConfig.find(c => c.componentId === "bulk")?.enabled ?? false;

  const createMutation = useMutation<{ bulkMessage: { id: string }; participantsCreated: number; recipientsResolved: number; recipientsMissing: number }, Error, Medium[]>({
    mutationFn: async (medium) => {
      return apiRequest("POST", "/api/bulk-messages/from-recipients", {
        contactIds: selectedContactIds,
        sourceLabel,
        medium,
      });
    },
    onSuccess: (result) => {
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

  const messageItem = (
    <DropdownMenuItem
      disabled={messageDisabled}
      onSelect={(e) => {
        e.preventDefault();
        if (messageDisabled) return;
        createMutation.mutate(chosenMedia);
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
            disabled={createMutation.isPending}
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
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
