import { BulkMessageLayout, useBulkMessageLayout } from "@/components/layouts/BulkMessageLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { Tag } from "lucide-react";
import type { CommTagOption } from "@/components/comm/CommTagPicker";

const mediumLabels: Record<string, string> = {
  email: "Email",
  sms: "SMS",
  postal: "Postal",
  inapp: "In-App",
};

function BulkMessageDetailsContent() {
  const { bulkMessage } = useBulkMessageLayout();
  const media = Array.isArray(bulkMessage.medium) ? bulkMessage.medium : [bulkMessage.medium];

  const data = (bulkMessage.data ?? {}) as Record<string, unknown>;
  const tagIds = Array.isArray(data.tagIds)
    ? (data.tagIds as unknown[]).filter((id): id is string => typeof id === "string")
    : [];

  const { data: allTags = [] } = useQuery<CommTagOption[]>({
    queryKey: ["/api/options/comm-tag"],
    enabled: tagIds.length > 0,
  });
  const selectedTags = allTags.filter((t) => tagIds.includes(t.id));

  return (
    <div className="space-y-6">
      <Card data-testid="card-bulk-details">
        <CardHeader>
          <CardTitle>Bulk Message Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Name</dt>
              <dd className="mt-1 text-sm" data-testid="text-bulk-detail-name">{bulkMessage.name}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Media</dt>
              <dd className="mt-1 text-sm flex flex-wrap gap-1" data-testid="text-bulk-detail-medium">
                {media.map((m) => (
                  <Badge key={m} variant="outline">
                    {mediumLabels[m] || m}
                  </Badge>
                ))}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Status</dt>
              <dd className="mt-1 text-sm" data-testid="text-bulk-detail-status">
                <Badge variant={bulkMessage.status === "sent" ? "default" : "secondary"}>
                  {bulkMessage.status}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Send Date</dt>
              <dd className="mt-1 text-sm" data-testid="text-bulk-detail-send-date">
                {bulkMessage.sendDate
                  ? new Date(bulkMessage.sendDate).toLocaleString()
                  : <span className="text-muted-foreground">—</span>}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-sm font-medium text-muted-foreground">Tags</dt>
              <dd className="mt-1 text-sm flex flex-wrap gap-1" data-testid="text-bulk-detail-tags">
                {tagIds.length === 0 ? (
                  <span className="text-muted-foreground">—</span>
                ) : selectedTags.length === 0 ? (
                  tagIds.map((id) => (
                    <Badge key={id} variant="outline" data-testid={`badge-bulk-tag-${id}`}>
                      <Tag className="h-3 w-3 mr-1" />
                      {id}
                    </Badge>
                  ))
                ) : (
                  selectedTags.map((t) => (
                    <Badge key={t.id} variant="secondary" data-testid={`badge-bulk-tag-${t.id}`}>
                      <Tag className="h-3 w-3 mr-1" />
                      {t.name}
                    </Badge>
                  ))
                )}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

    </div>
  );
}

export default function BulkMessageDetailsPage() {
  return (
    <BulkMessageLayout activeTab="details">
      <BulkMessageDetailsContent />
    </BulkMessageLayout>
  );
}
