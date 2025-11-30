import type { ServiceProvider, ConnectionTestResult } from '../base';

export interface PostalAddress {
  name?: string;
  company?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

export interface AddressVerificationResult {
  valid: boolean;
  deliverable: boolean;
  canonicalAddress?: string;
  normalizedAddress?: PostalAddress;
  deliverabilityAnalysis?: {
    dpvMatchCode?: string;
    dpvFootnotes?: string;
    dpvCmra?: string;
    dpvVacant?: string;
    dpvActive?: string;
    lacsLinkCode?: string;
    lacsLinkIndicator?: string;
    suiteReturnCode?: string;
    primaryNumber?: string;
    streetPredirection?: string;
    streetName?: string;
    streetSuffix?: string;
    streetPostdirection?: string;
    secondaryDesignator?: string;
    secondaryNumber?: string;
    pmbDesignator?: string;
    pmbNumber?: string;
    extraSecondaryDesignator?: string;
    extraSecondaryNumber?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    zipCodePlus4?: string;
    zipCodeType?: string;
    deliveryPointBarcode?: string;
    addressType?: string;
    recordType?: string;
    defaultBuildingAddress?: boolean;
    county?: string;
    countyFips?: string;
    carrierRoute?: string;
    carrierRouteType?: string;
    latitude?: number;
    longitude?: number;
  };
  error?: string;
  rawResponse?: unknown;
}

export interface LetterDeliveryOptions {
  color?: boolean;
  doubleSided?: boolean;
  mailType?: 'usps_first_class' | 'usps_standard';
  extraService?: 'certified' | 'certified_return_receipt' | 'registered' | null;
  returnEnvelope?: boolean;
  perforatedPage?: number;
  customEnvelope?: string;
  useType?: 'marketing' | 'operational';
}

export interface SendLetterParams {
  to: PostalAddress;
  from: PostalAddress;
  description?: string;
  file?: string;
  templateId?: string;
  mergeVariables?: Record<string, string>;
  options?: LetterDeliveryOptions;
  metadata?: Record<string, string>;
}

export interface LetterSendResult {
  success: boolean;
  letterId?: string;
  status?: string;
  expectedDeliveryDate?: Date;
  trackingNumber?: string;
  carrier?: string;
  error?: string;
  details?: Record<string, unknown>;
}

export interface LetterTrackingEvent {
  id: string;
  type: string;
  name: string;
  time: Date;
  location?: string;
  details?: string;
}

export interface PostalTransport extends ServiceProvider {
  readonly category: 'postal';
  
  verifyAddress(address: PostalAddress): Promise<AddressVerificationResult>;
  
  sendLetter(params: SendLetterParams): Promise<LetterSendResult>;
  
  getLetterStatus?(letterId: string): Promise<{
    status: string;
    trackingEvents: LetterTrackingEvent[];
  }>;
  
  cancelLetter?(letterId: string): Promise<{ success: boolean; error?: string }>;
  
  supportsPostal(): boolean;
  
  getDefaultReturnAddress(): Promise<PostalAddress | undefined>;
  setDefaultReturnAddress?(address: PostalAddress): Promise<void>;
}

export interface PostalProviderSettings {
  defaultReturnAddress?: PostalAddress;
  [key: string]: unknown;
}

export function buildCanonicalAddress(address: PostalAddress): string {
  const parts = [
    address.addressLine1.trim().toUpperCase(),
    address.addressLine2?.trim().toUpperCase() || '',
    address.city.trim().toUpperCase(),
    address.state.trim().toUpperCase(),
    address.zip.trim().toUpperCase(),
    address.country.trim().toUpperCase()
  ].filter(Boolean);
  
  return parts.join('|');
}
