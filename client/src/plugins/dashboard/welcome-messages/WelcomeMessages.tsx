import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageSquare } from "lucide-react";
import { sanitizeHtml } from "@shared/utils/html";
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

  const sanitizedMessage = sanitizeHtml(message, "styled-text");

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
