import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X, Phone, MapPin } from "lucide-react";
import { useState } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { PhoneNumber, ContactPostal } from "@shared/schema";

interface EmployerContactRow {
  id: string;
  contactId: string;
  contactTypeId: string | null;
  contact: {
    id: string;
    displayName: string;
    title: string | null;
    email: string | null;
  };
  contactType?: { id: string; name: string; description: string | null } | null;
}

/**
 * Build the employer-contact options for a grievance's Company Representative,
 * deduped by the underlying contact id (an employer may link the same contact
 * more than once under different contact types).
 */
function dedupeByContactId(rows: EmployerContactRow[]): EmployerContactRow[] {
  const seen = new Set<string>();
  const out: EmployerContactRow[] = [];
  for (const row of rows) {
    if (seen.has(row.contactId)) continue;
    seen.add(row.contactId);
    out.push(row);
  }
  return out;
}

interface EditProps {
  grievanceId: string;
  employerId: string;
  employerContactId: string | null;
}

/**
 * Live edit control for a grievance's optional Company Representative. Only
 * meant to be rendered when the grievance has an employer. Lists that
 * employer's contacts; selecting one saves immediately, and it can be cleared.
 * There is no enforcement that the stored contact belongs to the employer: if
 * the current value is not among the employer's contacts (drift), the control
 * shows nothing selected but keeps the stored value until staff pick a new one
 * or explicitly clear it.
 */
export function GrievanceRepresentativeSection({
  grievanceId,
  employerId,
  employerContactId,
}: EditProps) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const { data: contacts = [], isLoading } = useQuery<EmployerContactRow[]>({
    queryKey: ["/api/employers", employerId, "contacts"],
  });

  const options = dedupeByContactId(contacts);
  const matched = contacts.find((c) => c.contactId === employerContactId);
  const hasStoredValue = !!employerContactId;

  const save = async (contactId: string | null) => {
    setBusy(true);
    try {
      await apiRequest("PATCH", `/api/grievances/${grievanceId}`, {
        employerContactId: contactId,
      });
      await queryClient.invalidateQueries({
        queryKey: ["/api/grievances", grievanceId],
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/grievances"] });
      toast({
        title: contactId ? "Representative updated" : "Representative cleared",
      });
    } catch (error: any) {
      toast({
        title: "Failed to update representative",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card data-testid="card-grievance-representative">
      <CardHeader>
        <CardTitle>Company Representative</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : options.length === 0 ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid="text-no-employer-contacts"
          >
            This employer has no contacts to choose from.
          </p>
        ) : (
          <>
            <Select
              value={matched ? employerContactId! : ""}
              onValueChange={(v) => save(v)}
              disabled={busy}
            >
              <SelectTrigger data-testid="select-representative">
                <SelectValue placeholder="Select a representative" />
              </SelectTrigger>
              <SelectContent>
                {options.map((c) => (
                  <SelectItem
                    key={c.contactId}
                    value={c.contactId}
                    data-testid={`option-representative-${c.contactId}`}
                  >
                    {c.contact.displayName}
                    {c.contactType ? ` — ${c.contactType.name}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hasStoredValue && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => save(null)}
                data-testid="button-clear-representative"
              >
                <X size={14} className="mr-1" />
                Clear
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface SummaryProps {
  employerId: string | null;
  employerContactId: string | null;
}

function formatAddress(address: ContactPostal): string {
  return `${address.street}, ${address.city}, ${address.state} ${address.postalCode}`;
}

/**
 * Read-only display of a grievance's Company Representative for the details
 * page: the representative's name, role at the grievance's employer, address,
 * phone and email. Intentionally renders no link to the contact page. If the
 * stored contact is not (or no longer) one of the employer's contacts, a note
 * is shown instead.
 */
export function GrievanceRepresentativeSummary({
  employerId,
  employerContactId,
}: SummaryProps) {
  const hasValue = !!employerContactId;

  const { data: contacts = [], isLoading } = useQuery<EmployerContactRow[]>({
    queryKey: ["/api/employers", employerId, "contacts"],
    enabled: !!employerId && hasValue,
  });

  const matched = employerId
    ? contacts.find((c) => c.contactId === employerContactId)
    : undefined;

  const { data: phoneNumbers = [] } = useQuery<PhoneNumber[]>({
    queryKey: ["/api/contacts", employerContactId, "phone-numbers"],
    enabled: !!matched,
  });
  const { data: addresses = [] } = useQuery<ContactPostal[]>({
    queryKey: ["/api/contacts", employerContactId, "addresses"],
    enabled: !!matched,
  });

  const primaryPhone = phoneNumbers.find((p) => p.isPrimary && p.isActive);
  const primaryAddress = addresses.find((a) => a.isPrimary && a.isActive);

  return (
    <Card data-testid="card-grievance-representative-summary">
      <CardHeader>
        <CardTitle>Company Representative</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasValue ? (
          <p
            className="text-muted-foreground text-sm"
            data-testid="text-no-representative"
          >
            No company representative assigned.
          </p>
        ) : isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : !matched ? (
          <p
            className="text-muted-foreground text-sm"
            data-testid="text-representative-not-linked"
          >
            This representative is no longer linked to the current employer.
          </p>
        ) : (
          <>
            <div>
              <div className="text-sm font-medium text-muted-foreground mb-1">
                Name
              </div>
              <div className="text-base" data-testid="text-representative-name">
                {matched.contact.displayName}
              </div>
              {matched.contact.title && (
                <div className="text-sm text-muted-foreground mt-1">
                  {matched.contact.title}
                </div>
              )}
            </div>

            <Separator />

            <div>
              <div className="text-sm font-medium text-muted-foreground mb-1">
                Role
              </div>
              <div className="text-base" data-testid="text-representative-role">
                {matched.contactType ? matched.contactType.name : "None"}
              </div>
            </div>

            {matched.contact.email && (
              <>
                <Separator />
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">
                    Email
                  </div>
                  <div
                    className="text-base"
                    data-testid="text-representative-email"
                  >
                    {matched.contact.email}
                  </div>
                </div>
              </>
            )}

            {primaryPhone && (
              <>
                <Separator />
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-2">
                    <Phone size={14} />
                    Phone
                  </div>
                  <div
                    className="text-base"
                    data-testid="text-representative-phone"
                  >
                    {primaryPhone.phoneNumber}
                    {primaryPhone.friendlyName && (
                      <span className="text-sm text-muted-foreground ml-2">
                        ({primaryPhone.friendlyName})
                      </span>
                    )}
                  </div>
                </div>
              </>
            )}

            {primaryAddress && (
              <>
                <Separator />
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-2">
                    <MapPin size={14} />
                    Address
                  </div>
                  <div
                    className="text-base"
                    data-testid="text-representative-address"
                  >
                    {primaryAddress.friendlyName && (
                      <div className="font-medium text-sm text-muted-foreground">
                        {primaryAddress.friendlyName}
                      </div>
                    )}
                    <div>{formatAddress(primaryAddress)}</div>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
