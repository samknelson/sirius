import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { usePageTitle } from "@/contexts/PageTitleContext";
import {
  Megaphone,
  Search,
  Eye,
  Mail,
  MessageSquare,
  MapPin,
  Bell,
  Trash2,
  Loader2,
} from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
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

interface CampaignListItem extends BulkCampaign {
  creatorName?: string;
  channelMessages?: { medium: string; status: string }[];
  audienceSize?: number;
  totalParticipants?: number;
  pendingCount?: number;
  sentCount?: number;
  failedCount?: number;
  progress?: number;
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

export default function CampaignsPage() {
  const { toast } = useToast();
  usePageTitle("Campaigns");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterName, setFilterName] = useState<string>("");

  const { data: campaigns, isLoading } = useQuery<CampaignListItem[]>({
    queryKey: ["/api/bulk-campaigns", {
      ...(filterStatus !== "all" && { status: filterStatus }),
      ...(filterName.trim() && { name: filterName.trim() }),
    }],
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/bulk-campaigns/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bulk-campaigns"] });
      toast({ title: "Campaign deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete campaign", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Megaphone className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold" data-testid="heading-campaigns">Campaign Management</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Monitor and manage bulk campaign delivery
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 mb-6">
        <div className="flex items-center gap-2">
          <Label htmlFor="filter-name" className="text-sm whitespace-nowrap">Name:</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              id="filter-name"
              value={filterName}
              onChange={(e) => setFilterName(e.target.value)}
              placeholder="Search by name..."
              className="w-[200px] pl-8"
              data-testid="input-filter-campaign-name"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="filter-status" className="text-sm whitespace-nowrap">Status:</Label>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[140px]" data-testid="select-filter-campaign-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="queued">Queued</SelectItem>
              <SelectItem value="processing">Processing</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="aborted">Aborted</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {campaigns && (
          <span className="text-sm text-muted-foreground ml-auto" data-testid="text-campaign-count">
            {campaigns.length} campaign{campaigns.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : !campaigns || campaigns.length === 0 ? (
        <div className="text-center py-16 border rounded-lg bg-card">
          <Megaphone className="h-12 w-12 text-muted-foreground/50 mx-auto mb-3" />
          <p className="text-muted-foreground" data-testid="text-no-campaigns">
            No campaigns found.
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Use the "Bulk Message" button on the Workers or Employer Contacts page to create a campaign.
          </p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden" data-testid="grid-campaigns">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[250px]">Campaign Name</TableHead>
                <TableHead>Creator</TableHead>
                <TableHead>Scheduled Date</TableHead>
                <TableHead>Channels</TableHead>
                <TableHead className="text-right">Audience</TableHead>
                <TableHead className="w-[180px]">Progress</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((campaign) => {
                const pct = campaign.progress ?? 0;
                return (
                  <TableRow
                    key={campaign.id}
                    className="cursor-pointer hover:bg-muted/50"
                    data-testid={`row-campaign-${campaign.id}`}
                  >
                    <TableCell className="font-medium">
                      <Link href={`/campaigns/${campaign.id}`} className="hover:underline" data-testid={`link-campaign-${campaign.id}`}>
                        {campaign.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground" data-testid={`text-creator-${campaign.id}`}>
                      {campaign.creatorName || "System"}
                    </TableCell>
                    <TableCell className="text-sm" data-testid={`text-scheduled-${campaign.id}`}>
                      {campaign.scheduledAt
                        ? new Date(campaign.scheduledAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })
                        : campaign.status === "draft"
                        ? "-"
                        : "Immediate"}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {campaign.channelMessages?.map((ch) => {
                          const Icon = mediumIcons[ch.medium] || Mail;
                          return (
                            <Badge key={ch.medium} variant="outline" className="text-xs gap-1 px-1.5" data-testid={`badge-channel-${campaign.id}-${ch.medium}`}>
                              <Icon className="h-3 w-3" />
                              {mediumLabels[ch.medium] || ch.medium}
                            </Badge>
                          );
                        })}
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-sm" data-testid={`text-audience-${campaign.id}`}>
                      {campaign.totalParticipants?.toLocaleString() ?? campaign.audienceSize?.toLocaleString() ?? "-"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Progress value={pct} className="h-1.5 flex-1" />
                        <span className="text-xs text-muted-foreground w-[40px] text-right" data-testid={`text-progress-${campaign.id}`}>
                          {Math.round(pct)}%
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Link href={campaign.status === "failed" ? `/campaigns/${campaign.id}?tab=errors` : `/campaigns/${campaign.id}`}>
                        <Badge
                          variant={statusVariants[campaign.status] || "secondary"}
                          className={`text-xs cursor-pointer ${campaign.status === "failed" ? "hover:opacity-80" : ""}`}
                          data-testid={`badge-status-${campaign.id}`}
                        >
                          {campaign.status}
                        </Badge>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Link href={`/campaigns/${campaign.id}`}>
                          <Button variant="ghost" size="sm" data-testid={`button-view-campaign-${campaign.id}`}>
                            <Eye className="h-4 w-4" />
                          </Button>
                        </Link>
                        {["draft", "aborted", "completed", "failed"].includes(campaign.status) && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                data-testid={`button-delete-campaign-${campaign.id}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Campaign</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to delete "{campaign.name}"? This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => deleteMutation.mutate(campaign.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
