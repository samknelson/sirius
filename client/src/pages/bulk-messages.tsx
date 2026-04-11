import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Eye, Megaphone, Plus, Loader2, Search } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { usePageTitle } from "@/contexts/PageTitleContext";
import type { BulkMessage } from "@shared/schema/bulk/schema";

const mediumLabels: Record<string, string> = {
  email: "Email",
  sms: "SMS",
  postal: "Postal",
  inapp: "In-App",
};

const statusVariants: Record<string, "default" | "secondary" | "outline"> = {
  draft: "secondary",
  queued: "outline",
  sent: "default",
};

export default function BulkMessagesPage() {
  const { toast } = useToast();
  usePageTitle("Bulk Messages");
  const [isAdding, setIsAdding] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterMedium, setFilterMedium] = useState<string>("all");
  const [filterName, setFilterName] = useState<string>("");
  const [formData, setFormData] = useState({
    name: "",
    medium: "email" as "email" | "sms" | "postal" | "inapp",
  });

  const queryParams = new URLSearchParams();
  if (filterStatus !== "all") queryParams.set("status", filterStatus);
  if (filterMedium !== "all") queryParams.set("medium", filterMedium);
  if (filterName.trim()) queryParams.set("name", filterName.trim());
  const queryString = queryParams.toString();

  const { data: messages, isLoading } = useQuery<BulkMessage[]>({
    queryKey: ["/api/bulk-messages", { status: filterStatus, medium: filterMedium, name: filterName }],
    queryFn: async () => {
      const url = queryString ? `/api/bulk-messages?${queryString}` : "/api/bulk-messages";
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch bulk messages");
      return response.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof formData) => {
      return apiRequest("POST", "/api/bulk-messages", {
        name: data.name,
        medium: data.medium,
        status: "draft",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bulk-messages"] });
      toast({ title: "Bulk message created", description: "The bulk message has been created." });
      setFormData({ name: "", medium: "email" });
      setIsAdding(false);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create bulk message", description: error.message || "An error occurred", variant: "destructive" });
    },
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast({ title: "Validation error", description: "Name is required.", variant: "destructive" });
      return;
    }
    createMutation.mutate(formData);
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="flex items-center gap-3 mb-6">
        <Megaphone className="h-8 w-8 text-primary" />
        <h1 className="text-3xl font-bold" data-testid="heading-bulk-messages">Bulk Messages</h1>
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
              data-testid="input-filter-name"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="filter-status" className="text-sm whitespace-nowrap">Status:</Label>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[140px]" data-testid="select-filter-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="queued">Queued</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="filter-medium" className="text-sm whitespace-nowrap">Medium:</Label>
          <Select value={filterMedium} onValueChange={setFilterMedium}>
            <SelectTrigger className="w-[140px]" data-testid="select-filter-medium">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="sms">SMS</SelectItem>
              <SelectItem value="postal">Postal</SelectItem>
              <SelectItem value="inapp">In-App</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle data-testid="heading-bulk-list">Messages</CardTitle>
          <Button
            size="sm"
            onClick={() => setIsAdding(!isAdding)}
            data-testid="button-add-bulk-message"
          >
            <Plus size={16} className="mr-2" />
            {isAdding ? "Cancel" : "New Message"}
          </Button>
        </CardHeader>
        <CardContent>
          {isAdding && (
            <Card className="mb-6 bg-muted/50">
              <CardHeader>
                <CardTitle className="text-lg">New Bulk Message</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleCreate} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="bulk-name">Name *</Label>
                      <Input
                        id="bulk-name"
                        value={formData.name}
                        onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                        placeholder="Message name"
                        data-testid="input-bulk-name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="bulk-medium">Medium *</Label>
                      <Select
                        value={formData.medium}
                        onValueChange={(value) => setFormData((prev) => ({ ...prev, medium: value as typeof prev.medium }))}
                      >
                        <SelectTrigger data-testid="select-bulk-medium">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="email">Email</SelectItem>
                          <SelectItem value="sms">SMS</SelectItem>
                          <SelectItem value="postal">Postal</SelectItem>
                          <SelectItem value="inapp">In-App</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <Button type="submit" disabled={createMutation.isPending} data-testid="button-create-bulk-message">
                      {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      Create
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setIsAdding(false)} data-testid="button-cancel-create">
                      Cancel
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : !messages || messages.length === 0 ? (
            <p className="text-muted-foreground text-center py-8" data-testid="text-no-bulk-messages">
              No bulk messages found.
            </p>
          ) : (
            <div className="space-y-2">
              {messages.map((msg) => (
                <Link key={msg.id} href={`/bulk/${msg.id}`}>
                  <div
                    className="flex items-center justify-between p-4 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors"
                    data-testid={`row-bulk-message-${msg.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <Megaphone className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <p className="font-medium" data-testid={`text-bulk-name-${msg.id}`}>{msg.name}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant={statusVariants[msg.status] || "secondary"} className="text-xs">
                            {msg.status}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {mediumLabels[msg.medium] || msg.medium}
                          </Badge>
                          {msg.sendDate && (
                            <span className="text-xs text-muted-foreground">
                              Send: {new Date(msg.sendDate).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
