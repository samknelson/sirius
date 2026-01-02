import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageSquare } from "lucide-react";
import DOMPurify from "isomorphic-dompurify";
import { DashboardPluginProps } from "../types";

interface WelcomeMessageContent {
  messages: Array<{
    roleId: string;
    roleName: string;
    message: string;
  }>;
}

export function WelcomeMessagesPlugin({ userRoles }: DashboardPluginProps) {
  const { data, isLoading } = useQuery<WelcomeMessageContent>({
    queryKey: ["/api/dashboard-plugins/welcome-messages/content"],
  });

  if (isLoading) {
    return null;
  }

  const messages = data?.messages ?? [];

  if (messages.length === 0) {
    return null;
  }

  return (
    <Card data-testid="plugin-welcome-messages">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          Welcome
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {messages.map(({ roleId, roleName, message }) => {
          const sanitizedMessage = DOMPurify.sanitize(message, {
            ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'u', 'p', 'br', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'span', 'div'],
            ALLOWED_ATTR: ['href', 'target', 'rel', 'class'],
          });

          return (
            <div key={roleId} className="space-y-2">
              {messages.length > 1 && (
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {roleName}
                </div>
              )}
              <div 
                className="prose prose-sm max-w-none dark:prose-invert"
                dangerouslySetInnerHTML={{ __html: sanitizedMessage }}
                data-testid={`welcome-message-${roleId}`}
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
