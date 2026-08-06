import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Phone, Loader2, Save } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { INTERACTION_CHANNEL_LABELS } from "@/lib/comm-types";

interface CallReason {
  id: string;
  name: string;
  description?: string | null;
}

interface CommLogInteractionProps {
  contactId: string;
  onSendSuccess?: () => void;
}

export function CommLogInteraction({ contactId, onSendSuccess }: CommLogInteractionProps) {
  const { toast } = useToast();
  const [channel, setChannel] = useState<string>("");
  const [callReasonId, setCallReasonId] = useState<string>("");
  const [notes, setNotes] = useState("");

  const { data: reasons, isLoading: isLoadingReasons } = useQuery<CallReason[]>({
    queryKey: ["/api/options/call-reason"],
  });

  const logMutation = useMutation({
    mutationFn: async (data: { channel: string; callReasonId: string; notes?: string }) => {
      return await apiRequest("POST", `/api/contacts/${contactId}/interaction`, data);
    },
    onSuccess: () => {
      toast({
        title: "Interaction Logged",
        description: "The call/visit has been recorded.",
      });
      setChannel("");
      setCallReasonId("");
      setNotes("");
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "comm"] });
      onSendSuccess?.();
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Log Interaction",
        description: error?.message || "Failed to log interaction",
        variant: "destructive",
      });
    },
  });

  const canSave = channel.length > 0 && callReasonId.length > 0 && !logMutation.isPending;

  const handleSave = () => {
    if (!canSave) return;
    logMutation.mutate({
      channel,
      callReasonId,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Phone className="h-5 w-5" />
          Log Call / Visit
        </CardTitle>
        <CardDescription>
          Record a member interaction — a phone call, office visit, or helpline/hotline contact.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="interaction-channel">Channel</Label>
          <Select value={channel} onValueChange={setChannel}>
            <SelectTrigger id="interaction-channel" data-testid="select-interaction-channel">
              <SelectValue placeholder="Select a channel" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(INTERACTION_CHANNEL_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value} data-testid={`option-channel-${value}`}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="interaction-reason">Reason</Label>
          <Select value={callReasonId} onValueChange={setCallReasonId} disabled={isLoadingReasons}>
            <SelectTrigger id="interaction-reason" data-testid="select-interaction-reason">
              <SelectValue placeholder={isLoadingReasons ? "Loading reasons..." : "Select a reason"} />
            </SelectTrigger>
            <SelectContent>
              {(reasons ?? []).map((reason) => (
                <SelectItem key={reason.id} value={reason.id} data-testid={`option-reason-${reason.id}`}>
                  {reason.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="interaction-notes">Notes</Label>
          <Textarea
            id="interaction-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes about the interaction"
            rows={5}
            maxLength={10000}
            data-testid="input-interaction-notes"
          />
        </div>
      </CardContent>
      <CardFooter className="justify-end">
        <Button onClick={handleSave} disabled={!canSave} data-testid="button-log-interaction">
          {logMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Log Interaction
        </Button>
      </CardFooter>
    </Card>
  );
}
