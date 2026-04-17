import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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

  const { data: componentConfig = [] } = useQuery<ComponentConfig[]>({
    queryKey: ["/api/components/config"],
    staleTime: 60000,
  });

  const bulkEnabled = componentConfig.find(c => c.componentId === "bulk")?.enabled ?? false;

  const createMutation = useMutation<{ bulkMessage: { id: string }; participantsCreated: number; recipientsResolved: number; recipientsMissing: number }, Error, void>({
    mutationFn: async () => {
      return apiRequest("POST", "/api/bulk-messages/from-recipients", {
        contactIds: selectedContactIds,
        sourceLabel,
        medium: ["email"],
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

  const messageItem = (
    <DropdownMenuItem
      disabled={noSelection || createMutation.isPending}
      onClick={() => {
        if (noSelection) return;
        createMutation.mutate();
      }}
      data-testid={`${testIdPrefix}-message`}
    >
      {createMutation.isPending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <MailPlus className="mr-2 h-4 w-4" />
      )}
      Message{noSelection ? "" : ` (${selectionCount})`}
    </DropdownMenuItem>
  );

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
        <DropdownMenuContent align="end">
          {noSelection ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div data-testid={`${testIdPrefix}-message-disabled-wrapper`}>{messageItem}</div>
                </TooltipTrigger>
                <TooltipContent>
                  Select one or more recipients first
                </TooltipContent>
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
