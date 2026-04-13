import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  ArrowLeft,
  Loader2,
  Mail,
  MessageSquare,
  MapPin,
  Bell,
  Megaphone,
} from "lucide-react";
import { Link } from "wouter";

const channelOptions = [
  { id: "email", label: "Email", icon: Mail, description: "Send email messages" },
  { id: "sms", label: "SMS", icon: MessageSquare, description: "Send text messages" },
  { id: "postal", label: "Postal", icon: MapPin, description: "Send physical mail" },
  { id: "inapp", label: "In-App", icon: Bell, description: "Send in-app notifications" },
] as const;

export default function CampaignCreatePage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  usePageTitle("New Campaign");

  const params = new URLSearchParams(searchString);
  const defaultAudienceType = params.get("audienceType") || "";

  const [name, setName] = useState("");
  const [audienceType, setAudienceType] = useState<string>(defaultAudienceType || "worker");
  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(new Set(["email"]));

  useEffect(() => {
    if (defaultAudienceType) {
      setAudienceType(defaultAudienceType);
    }
  }, [defaultAudienceType]);

  const toggleChannel = (channelId: string) => {
    setSelectedChannels(prev => {
      const next = new Set(prev);
      if (next.has(channelId)) {
        if (next.size > 1) next.delete(channelId);
      } else {
        next.add(channelId);
      }
      return next;
    });
  };

  const createMutation = useMutation({
    mutationFn: (data: { name: string; audienceType: string; channels: string[] }) =>
      apiRequest("POST", "/api/bulk-campaigns", {
        name: data.name,
        audienceType: data.audienceType,
        channels: data.channels,
        audienceFilters: {},
      }),
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bulk-campaigns"] });
      toast({ title: "Campaign created", description: `"${name}" has been created.` });
      setLocation(`/campaigns/${result.id}`);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create campaign", description: error.message, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast({ title: "Validation error", description: "Campaign name is required.", variant: "destructive" });
      return;
    }
    if (selectedChannels.size === 0) {
      toast({ title: "Validation error", description: "Select at least one channel.", variant: "destructive" });
      return;
    }
    createMutation.mutate({
      name: name.trim(),
      audienceType,
      channels: Array.from(selectedChannels),
    });
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <div className="mb-6">
        <Link href="/campaigns">
          <Button variant="ghost" size="sm" className="mb-4" data-testid="button-back-to-campaigns">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Campaigns
          </Button>
        </Link>
        <div className="flex items-center gap-3">
          <Megaphone className="h-8 w-8 text-primary" />
          <h1 className="text-3xl font-bold" data-testid="heading-new-campaign">New Campaign</h1>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Campaign Details</CardTitle>
            <CardDescription>Give your campaign a name and select the target audience type.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="campaign-name">Campaign Name *</Label>
              <Input
                id="campaign-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Q1 Member Outreach"
                data-testid="input-campaign-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="audience-type">Audience Type *</Label>
              <Select value={audienceType} onValueChange={setAudienceType}>
                <SelectTrigger data-testid="select-audience-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="worker">Workers</SelectItem>
                  <SelectItem value="employer_contact">Employer Contacts</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Channels</CardTitle>
            <CardDescription>Select one or more communication channels for this campaign.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {channelOptions.map((channel) => {
                const Icon = channel.icon;
                const isSelected = selectedChannels.has(channel.id);
                return (
                  <div
                    key={channel.id}
                    className={`flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition-colors ${
                      isSelected
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/30"
                    }`}
                    onClick={() => toggleChannel(channel.id)}
                    data-testid={`channel-option-${channel.id}`}
                  >
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleChannel(channel.id)}
                      data-testid={`checkbox-channel-${channel.id}`}
                    />
                    <Icon className={`h-5 w-5 ${isSelected ? "text-primary" : "text-muted-foreground"}`} />
                    <div>
                      <p className="font-medium text-sm">{channel.label}</p>
                      <p className="text-xs text-muted-foreground">{channel.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button
            type="submit"
            disabled={createMutation.isPending || !name.trim()}
            data-testid="button-create-campaign"
          >
            {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create Campaign
          </Button>
          <Link href="/campaigns">
            <Button type="button" variant="outline" data-testid="button-cancel-create-campaign">
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
