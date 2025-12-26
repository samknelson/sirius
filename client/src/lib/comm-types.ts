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
  mailType: string | null;
  data: Record<string, unknown> | null;
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
}
