import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertCircle, Send } from "lucide-react";
import { legalPayerSchema, type LegalConfirmationData, type LegalPayer, type LegalPayerHandoff } from "@shared/legal-payment";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, getApiErrorMessage, queryClient } from "@/lib/queryClient";

interface Props {
  wizardId: string;
  eaId: string;
  contacts: NonNullable<LegalConfirmationData["payerContacts"]>;
  canSaveContact: boolean;
  handoff?: LegalPayerHandoff | null;
  delegated: boolean;
  onDelegate: (value: boolean) => void;
}

export function LegalPayerOptions({ wizardId, eaId, contacts, canSaveContact, handoff, delegated, onDelegate }: Props) {
  const savedContact = contacts.find(contact => contact.contactId === handoff?.contactId);
  const [source, setSource] = useState<"contact" | "new">(handoff && !savedContact ? "new" : "contact");
  const [contactId, setContactId] = useState(savedContact?.contactId ?? "");
  const [name, setName] = useState(handoff?.name ?? "");
  const [email, setEmail] = useState(handoff?.email ?? "");
  const [saveContact, setSaveContact] = useState(false);
  const payer: LegalPayer = source === "contact" ? { source, contactId } : { source, name, email, saveContact };
  const selected = contacts.find(contact => contact.contactId === contactId);
  const mutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/wizards/${wizardId}/dispatch/confirmation/submit`, {
      input: { eaId, action: "notify_payer", payer: legalPayerSchema.parse(payer) },
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}/dispatch/confirmation/data`] });
      queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
    },
  });
  const requestedEmail = source === "contact" ? selected?.email : email.trim().toLowerCase();
  const alreadySent = handoff?.status === "sent" && requestedEmail === handoff.email;
  const pending = mutation.isPending || (handoff?.status === "queued" && Date.now() - Date.parse(handoff.requestedAt) < 120_000);
  const id = `legal-payer-${eaId}`;
  return <div className="space-y-4 border-t pt-4">
    <div>
      <p className="text-sm font-medium" id={`${id}-label`}>How would you like to handle payment?</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-3" role="group" aria-labelledby={`${id}-label`}>
        <Button type="button" className="h-auto whitespace-normal py-3" variant={!delegated ? "default" : "outline"} aria-pressed={!delegated} disabled={pending} onClick={() => onDelegate(false)}>I will pay by check or wire</Button>
        <Button type="button" className="h-auto flex-col whitespace-normal py-3" variant="outline" disabled><span>Pay Online</span><span className="text-xs">Coming soon</span></Button>
        <Button type="button" className="h-auto whitespace-normal py-3" variant={delegated ? "default" : "outline"} aria-pressed={delegated} disabled={pending} onClick={() => onDelegate(true)}>Someone else will pay</Button>
      </div>
    </div>
    {handoff && <Alert variant={["blocked", "failed"].includes(handoff.status) ? "destructive" : "default"} role="status">
      <AlertCircle className="h-4 w-4" /><AlertTitle>{handoff.status === "queued" ? "Notification queued" : handoff.status === "sent" ? "Payer notified" : "Payer notification needs attention"}</AlertTitle>
      <AlertDescription>
        <span className="block">{handoff.name} · {handoff.email}</span>
        <span className="block">{handoff.message}</span>
        {handoff.savedContact && <span className="block">This person is saved as an employer contact.</span>}
        {handoff.status === "queued" && <span className="block">If this remains queued, refresh in two minutes and retry. Check communication history before retrying an uncertain send.</span>}
      </AlertDescription>
    </Alert>}
    {delegated && <div className="space-y-4 rounded-md border bg-muted/20 p-4">
      <div><h3 className="font-medium">Notify the person who will pay</h3><p className="mt-1 text-sm text-muted-foreground">We will email a link to this account's invoices. No payment is submitted or credited, and this does not grant access or create a login.</p></div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-source`}>Who should we notify?</Label>
        <Select value={source} disabled={pending} onValueChange={value => setSource(value as "contact" | "new")}>
          <SelectTrigger id={`${id}-source`}><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="contact">An existing employer contact</SelectItem><SelectItem value="new">Enter a name and email</SelectItem></SelectContent>
        </Select>
      </div>
      {source === "contact" ? <div className="space-y-2">
        <Label htmlFor={`${id}-contact`}>Employer contact</Label>
        <Select value={contactId} onValueChange={setContactId} disabled={pending || !contacts.length}>
          <SelectTrigger id={`${id}-contact`}><SelectValue placeholder={contacts.length ? "Choose a contact" : "No employer contacts available"} /></SelectTrigger>
          <SelectContent>{contacts.map(contact => <SelectItem key={contact.contactId} value={contact.contactId} disabled={!contact.email}>{contact.name} — {contact.email ?? "No email address"}{contact.email && !contact.optedIn ? " (not opted in)" : ""}</SelectItem>)}</SelectContent>
        </Select>
        {!contacts.length && <p className="text-sm text-muted-foreground">Enter a name and email instead, or ask staff to add an employer contact.</p>}
        {selected?.email && !selected.optedIn && <p className="text-sm text-destructive">This address has not opted in. No email will be sent until authorized staff enable email opt-in.</p>}
      </div> : <>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2"><Label htmlFor={`${id}-name`}>Payer's full name</Label><Input id={`${id}-name`} value={name} maxLength={200} disabled={pending} onChange={event => setName(event.target.value)} autoComplete="name" /></div>
          <div className="space-y-2"><Label htmlFor={`${id}-email`}>Payer's email</Label><Input id={`${id}-email`} type="email" value={email} maxLength={254} disabled={pending} onChange={event => setEmail(event.target.value)} autoComplete="email" /></div>
        </div>
        <div className="flex items-start gap-2">
          <Checkbox id={`${id}-save`} checked={saveContact} disabled={!canSaveContact || pending} onCheckedChange={value => setSaveContact(value === true)} />
          <Label htmlFor={`${id}-save`} className="leading-5">Also save this person as an employer contact for future use</Label>
        </div>
        {!canSaveContact && <p className="text-xs text-muted-foreground">Your account can notify a payer but cannot save employer contacts. Ask staff to save the contact if needed.</p>}
      </>}
      <p className="text-xs text-muted-foreground">Existing email opt-in rules apply, including for a newly entered address. Saving a contact does not opt them in. An authorized employer login is needed to open the invoice.</p>
      {mutation.isError && <Alert variant="destructive"><AlertDescription>{getApiErrorMessage(mutation.error, "Could not request the invoice notification. Please try again.")}</AlertDescription></Alert>}
      <div className="flex justify-end"><Button type="button" disabled={pending || alreadySent || !legalPayerSchema.safeParse(payer).success} onClick={() => mutation.mutate()}><Send className="mr-2 h-4 w-4" />{pending ? "Sending notification…" : alreadySent ? "Payer already notified" : source === "new" && saveContact ? "Save contact and notify payer" : "Notify payer"}</Button></div>
    </div>}
  </div>;
}
