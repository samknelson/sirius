import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageSquare } from "lucide-react";
import DOMPurify from "isomorphic-dompurify";
import { DashboardPluginProps } from "../registry";
import { useDashboardContent } from "../useDashboardContent";

interface WelcomeMessageContent {
  message: string | null;
}

export function WelcomeMessages(props: DashboardPluginProps) {
  const { data, isLoading } = useDashboardContent<WelcomeMessageContent>("welcome-messages");

  if (isLoading) return null;
  const message = data?.message;
  if (!message) return null;

  const sanitizedMessage = DOMPurify.sanitize(message, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'u', 'p', 'br', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'span', 'div'],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'class'],
  });

  return (
    <Card data-testid={`plugin-welcome-messages-${props.configId ?? "default"}`}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          {props.configName || "Welcome"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className="prose prose-sm max-w-none dark:prose-invert"
          dangerouslySetInnerHTML={{ __html: sanitizedMessage }}
          data-testid={`welcome-message-${props.configId ?? "default"}`}
        />
      </CardContent>
    </Card>
  );
}
