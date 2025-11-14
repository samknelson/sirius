import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { MessageSquare, Save, AlertCircle } from "lucide-react";
import { Role } from "@shared/schema";
import { SimpleHtmlEditor } from "@/components/ui/simple-html-editor";
import { PluginSettingsProps } from "../types";

type WelcomeMessagesSettings = Record<string, string>;

export function WelcomeMessagesSettings({ plugin, queryClient, onConfigSaved, loadSettings, saveSettings }: PluginSettingsProps<WelcomeMessagesSettings>) {
  const { toast } = useToast();
  
  const { data: roles = [], isLoading: rolesLoading } = useQuery<Role[]>({
    queryKey: ["/api/admin/roles"],
  });

  const { data: welcomeMessages = {}, isLoading: messagesLoading } = useQuery<WelcomeMessagesSettings>({
    queryKey: [`/api/dashboard-plugins/${plugin.id}/settings`],
    queryFn: loadSettings,
  });

  const [editedMessages, setEditedMessages] = useState<WelcomeMessagesSettings>({});
  const [savingRoleId, setSavingRoleId] = useState<string | null>(null);

  useEffect(() => {
    if (welcomeMessages) {
      setEditedMessages(welcomeMessages);
    }
  }, [welcomeMessages]);

  const updateMessageMutation = useMutation({
    mutationFn: async ({ roleId, message }: { roleId: string; message: string }) => {
      const newSettings = {
        ...editedMessages,
        [roleId]: message,
      };
      await saveSettings(newSettings);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [`/api/dashboard-plugins/${plugin.id}/settings`] });
      toast({
        title: "Welcome Message Updated",
        description: `Dashboard message for this role has been updated successfully.`,
      });
      setSavingRoleId(null);
      onConfigSaved?.();
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error?.message || "Failed to update welcome message.",
        variant: "destructive",
      });
      setSavingRoleId(null);
    },
  });

  const handleSave = (roleId: string) => {
    setSavingRoleId(roleId);
    updateMessageMutation.mutate({
      roleId,
      message: editedMessages[roleId] || "",
    });
  };

  const handleMessageChange = (roleId: string, value: string) => {
    setEditedMessages((prev) => ({
      ...prev,
      [roleId]: value,
    }));
  };

  const hasChanges = (roleId: string) => {
    return editedMessages[roleId] !== (welcomeMessages[roleId] || "");
  };

  if (rolesLoading || messagesLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Dashboard Welcome Messages
          </h1>
          <p className="text-muted-foreground mt-2">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Dashboard Welcome Messages
        </h1>
        <p className="text-muted-foreground mt-2">
          Configure custom welcome messages for each role that appear on the dashboard.
          You can use HTML for formatting.
        </p>
      </div>

      <Alert>
        <MessageSquare className="h-4 w-4" />
        <AlertDescription>
          Use the formatting toolbar to add bold, italic, and lists to your welcome messages.
          HTML is sanitized for security.
        </AlertDescription>
      </Alert>

      <div className="space-y-4">
        {roles.map((role) => (
          <Card key={role.id} data-testid={`card-welcome-message-${role.id}`}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>{role.name}</span>
                <Button
                  size="sm"
                  onClick={() => handleSave(role.id)}
                  disabled={!hasChanges(role.id) || savingRoleId === role.id}
                  data-testid={`button-save-${role.id}`}
                >
                  <Save className="h-4 w-4 mr-2" />
                  {savingRoleId === role.id ? "Saving..." : "Save"}
                </Button>
              </CardTitle>
              <CardDescription>
                {role.description || "Configure the welcome message for this role"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor={`message-${role.id}`}>Welcome Message</Label>
                <div className="mt-2">
                  <SimpleHtmlEditor
                    value={editedMessages[role.id] || ""}
                    onChange={(value) => handleMessageChange(role.id, value)}
                    placeholder="Enter a welcome message for users with this role..."
                    data-testid={`editor-message-${role.id}`}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {roles.length === 0 && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            No roles found. Create roles in User Management to configure welcome messages.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
