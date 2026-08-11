export interface CommSmsDetails {
  id: string;
  commId: string;
  to: string | null;
  body: string | null;
  data: Record<string, unknown> | null;
}

export interface CommEmailDetails {
  id: string;
  commId: string;
  to: string | null;
  toName: string | null;
  from: string | null;
  fromName: string | null;
  replyTo: string | null;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  data: Record<string, unknown> | null;
}

export interface CommPostalDetails {
  id: string;
  commId: string;
  toName: string | null;
  toAddressLine1: string | null;
  toAddressLine2: string | null;
  toCity: string | null;
  toState: string | null;
  toZip: string | null;
  toCountry: string | null;
  fromName: string | null;
  fromAddressLine1: string | null;
  fromAddressLine2: string | null;
  fromCity: string | null;
  fromState: string | null;
  fromZip: string | null;
  fromCountry: string | null;
  description: string | null;
  body: string | null;
  mailType: string | null;
  data: Record<string, unknown> | null;
}

export interface CommInteractionDetails {
  id: string;
  commId: string;
  channel: string;
  callReasonId: string;
  notes: string | null;
  data: Record<string, unknown> | null;
  reasonName?: string | null;
}

export const INTERACTION_CHANNEL_LABELS: Record<string, string> = {
  call_from_member: "Call from member",
  call_to_member: "Call to member",
  office_visit: "Office visit",
  helpline: "Helpline",
  hotline: "Hotline",
  walk_in: "Walk-in",
  issue_reported: "Issue reported",
  letter: "Letter",
  provider_call: "Provider call",
};

export function interactionChannelLabel(channel: string | null | undefined): string {
  if (!channel) return "-";
  return INTERACTION_CHANNEL_LABELS[channel] ?? channel;
}

export interface ContactMainLink {
  type: "worker" | "employer_contact" | "trust_provider_contact";
  url: string;
  label: string;
  entityName: string;
}

export interface CommTag {
  id: string;
  name: string;
  description?: string | null;
  data?: { icon?: string; applicableCommTypes?: string[] } | null;
}

export interface CommWithDetails {
  id: string;
  medium: string;
  contactId: string;
  status: string;
  sent: string | null;
  received: string | null;
  data: Record<string, unknown> | null;
  smsDetails?: CommSmsDetails | null;
  emailDetails?: CommEmailDetails | null;
  postalDetails?: CommPostalDetails | null;
  interactionDetails?: CommInteractionDetails | null;
  tags?: CommTag[];
  contactMainLink?: ContactMainLink | null;
}

export interface CommWithSms {
  id: string;
  medium: string;
  contactId: string;
  status: string;
  sent: string | null;
  received: string | null;
  data: Record<string, unknown> | null;
  smsDetails?: CommSmsDetails | null;
  tags?: CommTag[];
}
