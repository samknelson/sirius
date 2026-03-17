import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Users, Plus, Trash2, UserPlus } from "lucide-react";

interface Contact {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  contactTypeId: string | null;
  promoteToUser: boolean;
}

interface ContactsStepProps {
  wizardId: string;
  wizardType: string;
  data?: any;
  onDataChange?: (data: any) => void;
}

const emptyContact: Contact = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  contactTypeId: null,
  promoteToUser: false,
};

export function ContactsStep({ wizardId, data }: ContactsStepProps) {
  const { toast } = useToast();
  const [contacts, setContacts] = useState<Contact[]>(data?.contacts || []);

  const { data: contactTypes = [] } = useQuery<any[]>({
    queryKey: ["/api/options/employer-contact-type"],
  });

  const updateMutation = useMutation({
    mutationFn: async (updatedContacts: Contact[]) => {
      return await apiRequest("PATCH", `/api/wizards/${wizardId}`, {
        data: {
          contacts: updatedContacts,
          progress: {
            ...(data?.progress || {}),
            contacts: {
              status: "completed",
              completedAt: new Date().toISOString(),
            },
          },
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const addContact = () => {
    const updated = [...contacts, { ...emptyContact }];
    setContacts(updated);
  };

  const removeContact = (index: number) => {
    const updated = contacts.filter((_, i) => i !== index);
    setContacts(updated);
    updateMutation.mutate(updated);
  };

  const updateContact = (index: number, field: keyof Contact, value: any) => {
    const updated = [...contacts];
    updated[index] = { ...updated[index], [field]: value };
    setContacts(updated);
  };

  const saveContacts = () => {
    updateMutation.mutate(contacts);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
              <Users className="text-primary" size={20} />
            </div>
            <div>
              <CardTitle>Employer Contacts</CardTitle>
              <CardDescription>Add contacts for this employer and optionally create user accounts for them</CardDescription>
            </div>
          </div>
          <Button onClick={addContact} variant="outline" size="sm">
            <Plus size={16} className="mr-2" />
            Add Contact
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {contacts.length === 0 ? (
          <div className="text-center py-8 border border-dashed rounded-lg">
            <Users className="mx-auto text-muted-foreground mb-3" size={32} />
            <p className="text-muted-foreground">No contacts added yet</p>
            <Button onClick={addContact} variant="outline" size="sm" className="mt-3">
              <Plus size={16} className="mr-2" />
              Add First Contact
            </Button>
          </div>
        ) : (
          contacts.map((contact, index) => (
            <div key={index} className="border rounded-lg p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-medium text-sm">Contact {index + 1}</h4>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeContact(index)}
                >
                  <Trash2 size={16} className="text-destructive" />
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm mb-1 block">First Name</Label>
                  <Input
                    placeholder="First name"
                    value={contact.firstName}
                    onChange={(e) => updateContact(index, "firstName", e.target.value)}
                    onBlur={saveContacts}
                  />
                </div>
                <div>
                  <Label className="text-sm mb-1 block">Last Name</Label>
                  <Input
                    placeholder="Last name"
                    value={contact.lastName}
                    onChange={(e) => updateContact(index, "lastName", e.target.value)}
                    onBlur={saveContacts}
                  />
                </div>
                <div>
                  <Label className="text-sm mb-1 block">Email <span className="text-destructive">*</span></Label>
                  <Input
                    type="email"
                    placeholder="email@example.com"
                    value={contact.email}
                    onChange={(e) => updateContact(index, "email", e.target.value)}
                    onBlur={saveContacts}
                  />
                </div>
                <div>
                  <Label className="text-sm mb-1 block">Phone</Label>
                  <Input
                    placeholder="Phone number"
                    value={contact.phone}
                    onChange={(e) => updateContact(index, "phone", e.target.value)}
                    onBlur={saveContacts}
                  />
                </div>
              </div>

              {contactTypes.length > 0 && (
                <div>
                  <Label className="text-sm mb-1 block">Contact Type</Label>
                  <Select
                    value={contact.contactTypeId || "__none__"}
                    onValueChange={(value) => {
                      updateContact(index, "contactTypeId", value === "__none__" ? null : value);
                      setTimeout(saveContacts, 0);
                    }}
                  >
                    <SelectTrigger className="w-full md:w-64">
                      <SelectValue placeholder="Select type (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">
                        <span className="text-muted-foreground">None</span>
                      </SelectItem>
                      {contactTypes.map((type: any) => (
                        <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="flex items-center space-x-3 pt-2 border-t">
                <Checkbox
                  id={`promote-${index}`}
                  checked={contact.promoteToUser}
                  onCheckedChange={(checked) => {
                    updateContact(index, "promoteToUser", checked === true);
                    setTimeout(saveContacts, 0);
                  }}
                />
                <Label htmlFor={`promote-${index}`} className="cursor-pointer flex items-center gap-2">
                  <UserPlus size={14} className="text-muted-foreground" />
                  Create user account (allows this contact to log in to the system)
                </Label>
              </div>
            </div>
          ))
        )}

        {contacts.length > 0 && (
          <div className="flex justify-between items-center pt-4 border-t">
            <p className="text-sm text-muted-foreground">
              {contacts.length} contact{contacts.length !== 1 ? "s" : ""} configured
              {contacts.filter(c => c.promoteToUser).length > 0 && (
                <span> ({contacts.filter(c => c.promoteToUser).length} will get user accounts)</span>
              )}
            </p>
            <Button onClick={addContact} variant="outline" size="sm">
              <Plus size={16} className="mr-2" />
              Add Another
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
