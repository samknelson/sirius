import { useState, useEffect } from "react";
import { TrustProviderContactLayout, useTrustProviderContactLayout } from "@/components/layouts/TrustProviderContactLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { UserPlus, Save, AlertCircle, CheckCircle2 } from "lucide-react";
import { Role } from "@/lib/entity-types";

interface ProviderContactUserResponse {
  hasUser: boolean;
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    isActive: boolean;
    accountStatus: string;
  } | null;
  userRoleIds: string[];
  requiredRoleIds: string[];
  optionalRoleIds: string[];
  contactEmail: string;
  hasEmail?: boolean;
}

function TrustProviderContactUserContent() {
  const { trustProviderContact } = useTrustProviderContactLayout();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [selectedOptionalRoles, setSelectedOptionalRoles] = useState<string[]>([]);

  // Fetch user data
  const { data, isLoading, error } = useQuery<ProviderContactUserResponse>({
    queryKey: ["/api/trust-provider-contacts", trustProviderContact.id, "user"],
  });

  // Fetch all roles to display names
  const { data: allRoles = [] } = useQuery<Role[]>({
    queryKey: ["/api/admin/roles"],
  });

  // Initialize form when data loads
  useEffect(() => {
    if (data?.hasUser && data.user) {
      setFirstName(data.user.firstName || "");
      setLastName(data.user.lastName || "");
      setIsActive(data.user.isActive);
      
      // Set selected optional roles (exclude required roles)
      const optional = data.userRoleIds.filter(
        roleId => !data.requiredRoleIds.includes(roleId)
      );
      setSelectedOptionalRoles(optional);
    } else if (data && !data.hasUser) {
      // Pre-fill from contact name if creating new user
      setFirstName(trustProviderContact.contact.given || "");
      setLastName(trustProviderContact.contact.family || "");
      setIsActive(true);
      setSelectedOptionalRoles([]);
    }
  }, [data, trustProviderContact]);

  // Create/Update user mutation
  const saveUserMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/trust-provider-contacts/${trustProviderContact.id}/user`, {
        firstName,
        lastName,
        isActive,
        optionalRoleIds: selectedOptionalRoles,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trust-provider-contacts", trustProviderContact.id, "user"] });
      toast({
        title: data?.hasUser ? "User Updated" : "User Created",
        description: data?.hasUser 
          ? "User account has been updated successfully."
          : "User account has been created successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: data?.hasUser ? "Update Failed" : "Creation Failed",
        description: error?.message || "Failed to save user account.",
        variant: "destructive",
      });
    },
  });

  const handleOptionalRoleToggle = (roleId: string, checked: boolean) => {
    setSelectedOptionalRoles(prev => 
      checked ? [...prev, roleId] : prev.filter(id => id !== roleId)
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveUserMutation.mutate();
  };

  // Error state - no email
  if (error || (data && data.hasEmail === false)) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
            <AlertCircle className="text-muted-foreground" size={32} />
          </div>
          <h3 className="text-lg font-medium text-foreground mb-2">Email Required</h3>
          <p className="text-muted-foreground text-center max-w-md">
            This contact must have an email address before a user account can be created.
            Please add an email address to this contact first.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Loading state
  if (isLoading || !data) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48 mb-2" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent className="space-y-6">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  // Get role objects for display
  const requiredRoles = allRoles.filter(r => data.requiredRoleIds.includes(r.id));
  const optionalRoles = allRoles.filter(r => data.optionalRoleIds.includes(r.id));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserPlus size={20} />
          {data.hasUser ? "Manage User Account" : "Create User Account"}
        </CardTitle>
        <CardDescription>
          {data.hasUser 
            ? `Manage the user account linked to ${data.contactEmail}`
            : `Create a user account for ${data.contactEmail}`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* User status indicator */}
          {data.hasUser && (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>
                A user account exists for this contact with email <strong>{data.contactEmail}</strong>
              </AlertDescription>
            </Alert>
          )}

          {/* Basic Info */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Enter first name"
                  data-testid="input-user-first-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Enter last name"
                  data-testid="input-user-last-name"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email (from contact)</Label>
              <Input
                id="email"
                value={data.contactEmail}
                disabled
                className="bg-muted"
                data-testid="input-user-email"
              />
              <p className="text-xs text-muted-foreground">
                Email cannot be changed here. Update the contact's email to change the user's email.
              </p>
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="isActive"
                checked={isActive}
                onCheckedChange={setIsActive}
                data-testid="switch-user-active"
              />
              <Label htmlFor="isActive" className="cursor-pointer">
                Active {isActive ? "(User can log in)" : "(User cannot log in)"}
              </Label>
            </div>
          </div>

          {/* Required Roles */}
          {requiredRoles.length > 0 && (
            <div className="space-y-2">
              <Label>Required Roles (Automatically Assigned)</Label>
              <p className="text-sm text-muted-foreground">
                These roles are required for all provider users and cannot be removed.
              </p>
              <div className="flex flex-wrap gap-2 pt-2">
                {requiredRoles.map(role => (
                  <Badge key={role.id} variant="default" data-testid={`badge-required-role-${role.id}`}>
                    {role.name}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Optional Roles */}
          {optionalRoles.length > 0 && (
            <div className="space-y-2">
              <Label>Optional Roles</Label>
              <p className="text-sm text-muted-foreground">
                Select additional roles to assign to this user.
              </p>
              <div className="space-y-3 pt-2">
                {optionalRoles.map(role => (
                  <div key={role.id} className="flex items-start space-x-2">
                    <Checkbox
                      id={`role-${role.id}`}
                      checked={selectedOptionalRoles.includes(role.id)}
                      onCheckedChange={(checked) => handleOptionalRoleToggle(role.id, checked as boolean)}
                      data-testid={`checkbox-optional-role-${role.id}`}
                    />
                    <div className="space-y-1 leading-none">
                      <Label
                        htmlFor={`role-${role.id}`}
                        className="cursor-pointer font-medium"
                      >
                        {role.name}
                      </Label>
                      {role.description && (
                        <p className="text-sm text-muted-foreground">
                          {role.description}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* No optional roles message */}
          {optionalRoles.length === 0 && requiredRoles.length > 0 && (
            <Alert>
              <AlertDescription>
                No optional roles are configured. All provider users will have only the required roles.
              </AlertDescription>
            </Alert>
          )}

          {/* Submit Button */}
          <div className="flex justify-end gap-2">
            <Button
              type="submit"
              disabled={saveUserMutation.isPending}
              data-testid="button-save-user"
            >
              {saveUserMutation.isPending ? (
                "Saving..."
              ) : (
                <>
                  <Save size={16} className="mr-2" />
                  {data.hasUser ? "Update User" : "Create User"}
                </>
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export default function TrustProviderContactUserPage() {
  return (
    <TrustProviderContactLayout activeTab="user">
      <TrustProviderContactUserContent />
    </TrustProviderContactLayout>
  );
}
