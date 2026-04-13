import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { usePageTitle } from "@/contexts/PageTitleContext";
import {
  Megaphone,
  Plus,
  Search,
  Eye,
  Mail,
  MessageSquare,
  MapPin,
  Bell,
  Users,
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
  inapp: "In-App",
};

export default function CampaignsPage() {
  const { toast } = useToast();
  usePageTitle("Campaigns");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterName, setFilterName] = useState<string>("");

  const queryParams = new URLSearchParams();
  if (filterStatus !== "all") queryParams.set("status", filterStatus);
  if (filterName.trim()) queryParams.set("name", filterName.trim());

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
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Megaphone className="h-8 w-8 text-primary" />
          <h1 className="text-3xl font-bold" data-testid="heading-campaigns">Campaigns</h1>
        </div>
        <Link href="/campaigns/new">
          <Button data-testid="button-new-campaign">
            <Plus className="h-4 w-4 mr-2" />
            New Campaign
          </Button>
        </Link>
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
      </div>

      <Card>
        <CardHeader>
          <CardTitle data-testid="heading-campaign-list">
            All Campaigns
            {campaigns && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({campaigns.length})
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : !campaigns || campaigns.length === 0 ? (
            <div className="text-center py-12">
              <Megaphone className="h-12 w-12 text-muted-foreground/50 mx-auto mb-3" />
              <p className="text-muted-foreground" data-testid="text-no-campaigns">
                No campaigns found. Create your first campaign to get started.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {campaigns.map((campaign) => (
                <div
                  key={campaign.id}
                  className="flex items-center justify-between p-4 rounded-lg border hover:bg-muted/50 transition-colors"
                  data-testid={`row-campaign-${campaign.id}`}
                >
                  <Link href={`/campaigns/${campaign.id}`} className="flex-1 min-w-0">
                    <div className="flex items-start gap-3 cursor-pointer">
                      <Megaphone className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate" data-testid={`text-campaign-name-${campaign.id}`}>
                          {campaign.name}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 mt-1">
                          <Badge variant={statusVariants[campaign.status] || "secondary"} className="text-xs">
                            {campaign.status}
                          </Badge>
                          {campaign.channelMessages?.map((ch) => {
                            const Icon = mediumIcons[ch.medium] || Mail;
                            return (
                              <Badge key={ch.medium} variant="outline" className="text-xs gap-1">
                                <Icon className="h-3 w-3" />
                                {mediumLabels[ch.medium] || ch.medium}
                              </Badge>
                            );
                          })}
                          {campaign.audienceType && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Users className="h-3 w-3" />
                              {campaign.audienceType === "worker" ? "Workers" : "Employer Contacts"}
                            </span>
                          )}
                        </div>
                        {campaign.totalParticipants != null && campaign.totalParticipants > 0 && (
                          <div className="mt-2 flex items-center gap-3">
                            <Progress value={campaign.progress || 0} className="h-1.5 flex-1 max-w-[200px]" />
                            <span className="text-xs text-muted-foreground">
                              {campaign.sentCount || 0}/{campaign.totalParticipants} sent
                            </span>
                          </div>
                        )}
                        {campaign.scheduledAt && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Scheduled: {new Date(campaign.scheduledAt).toLocaleString()}
                          </p>
                        )}
                      </div>
                    </div>
                  </Link>
                  <div className="flex items-center gap-1 ml-4 flex-shrink-0">
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
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
