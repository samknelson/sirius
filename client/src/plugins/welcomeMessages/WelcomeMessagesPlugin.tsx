import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageSquare } from "lucide-react";
import DOMPurify from "isomorphic-dompurify";
import { DashboardPluginProps } from "../types";

export function WelcomeMessagesPlugin({ userRoles }: DashboardPluginProps) {
  const { data: welcomeMessages = {}, isLoading } = useQuery<Record<string, string>>({
    queryKey: ["/api/welcome-messages"],
  });

  // Don't render while loading
  if (isLoading) {
    return null;
  }

  // Get all welcome messages for user's roles
  const userRoleMessages = userRoles
    .map(role => {
      const message = welcomeMessages[role.id];
      if (message) {
        return { role, message };
      }
      return null;
    })
    .filter(Boolean) as Array<{ role: typeof userRoles[number]; message: string }>;

  // If no messages, don't render
  if (userRoleMessages.length === 0) {
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
        {userRoleMessages.map(({ role, message }) => {
          const sanitizedMessage = DOMPurify.sanitize(message, {
            ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'u', 'p', 'br', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'span', 'div'],
            ALLOWED_ATTR: ['href', 'target', 'rel', 'class'],
          });

          return (
            <div key={role.id} className="space-y-2">
              {userRoleMessages.length > 1 && (
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {role.name}
                </div>
              )}
              <div 
                className="prose prose-sm max-w-none dark:prose-invert"
                dangerouslySetInnerHTML={{ __html: sanitizedMessage }}
                data-testid={`welcome-message-${role.id}`}
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
