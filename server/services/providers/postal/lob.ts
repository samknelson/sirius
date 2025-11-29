import type { ConnectionTestResult } from '../base';
import type {
  PostalTransport,
  PostalAddress,
  AddressVerificationResult,
  SendLetterParams,
  LetterSendResult,
  LetterTrackingEvent,
  PostalProviderSettings,
} from './index';
import { buildCanonicalAddress } from './index';
import { db } from '../../../db';
import { variables } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { getConfigKey } from '../base';

interface LobVerificationResponse {
  id: string;
  recipient: string;
  primary_line: string;
  secondary_line: string;
  urbanization: string;
  last_line: string;
  deliverability: 'deliverable' | 'deliverable_unnecessary_unit' | 'deliverable_incorrect_unit' | 'deliverable_missing_unit' | 'undeliverable';
  valid_address: boolean;
  components: {
    primary_number: string;
    street_predirection: string;
    street_name: string;
    street_suffix: string;
    street_postdirection: string;
    secondary_designator: string;
    secondary_number: string;
    pmb_designator: string;
    pmb_number: string;
    extra_secondary_designator: string;
    extra_secondary_number: string;
    city: string;
    state: string;
    zip_code: string;
    zip_code_plus_4: string;
    zip_code_type: string;
    delivery_point_barcode: string;
    address_type: string;
    record_type: string;
    default_building_address: boolean;
    county: string;
    county_fips: string;
    carrier_route: string;
    carrier_route_type: string;
    latitude: number;
    longitude: number;
  };
  deliverability_analysis: {
    dpv_match_code: string;
    dpv_footnotes: string;
    dpv_cmra: string;
    dpv_vacant: string;
    dpv_active: string;
    lacs_link_code: string;
    lacs_link_indicator: string;
    suite_return_code: string;
  };
}

interface LobLetterResponse {
  id: string;
  description: string;
  metadata: Record<string, string>;
  to: {
    id: string;
    description: string;
    name: string;
    company: string;
    address_line1: string;
    address_line2: string;
    address_city: string;
    address_state: string;
    address_zip: string;
    address_country: string;
  };
  from: {
    id: string;
    description: string;
    name: string;
    company: string;
    address_line1: string;
    address_line2: string;
    address_city: string;
    address_state: string;
    address_zip: string;
    address_country: string;
  };
  color: boolean;
  double_sided: boolean;
  address_placement: string;
  return_envelope: boolean;
  perforated_page: number | null;
  custom_envelope: string | null;
  extra_service: string | null;
  mail_type: string;
  url: string;
  merge_variables: Record<string, string>;
  template_id: string | null;
  template_version_id: string | null;
  carrier: string;
  tracking_number: string | null;
  tracking_events: Array<{
    id: string;
    type: string;
    name: string;
    time: string;
    location: string;
    details: Record<string, string>;
  }>;
  thumbnails: string[];
  expected_delivery_date: string;
  date_created: string;
  date_modified: string;
  send_date: string;
  deleted: boolean;
  object: string;
}

export class LobPostalProvider implements PostalTransport {
  readonly id = 'lob';
  readonly displayName = 'Lob';
  readonly category = 'postal' as const;
  readonly supportedFeatures = [
    'address_verification',
    'letter_sending',
    'tracking',
    'certified_mail',
    'registered_mail',
    'color_printing',
    'double_sided',
  ];

  private apiKey: string | null = null;
  private baseUrl = 'https://api.lob.com/v1';
  private settings: PostalProviderSettings = {};

  async configure(config: unknown): Promise<void> {
    const cfg = config as PostalProviderSettings;
    this.settings = cfg;
    if (cfg.apiKey) {
      this.apiKey = cfg.apiKey as string;
    }
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const apiKey = await this.getApiKey();
      if (!apiKey) {
        return {
          success: false,
          error: 'LOB_API_KEY not configured',
        };
      }

      const response = await fetch(`${this.baseUrl}/us_verifications`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          primary_line: 'deliverable',
          zip_code: '11111',
        }),
      });

      if (response.ok) {
        const isTestMode = apiKey.startsWith('test_');
        return { 
          success: true, 
          message: `Successfully connected to Lob API${isTestMode ? ' (test mode)' : ''}`,
          details: { isTestMode },
        };
      } else {
        const errorData = await response.json().catch(() => ({}));
        return {
          success: false,
          error: `API returned ${response.status}: ${JSON.stringify(errorData)}`,
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async getConfiguration(): Promise<Record<string, unknown>> {
    const apiKey = await this.getApiKey();
    const hasApiKey = !!apiKey;
    const isTestMode = apiKey?.startsWith('test_') ?? false;
    
    return {
      hasApiKey,
      apiKeyConfigured: hasApiKey,
      isTestMode,
      connected: hasApiKey,
      defaultReturnAddress: this.settings.defaultReturnAddress,
    };
  }

  private async getApiKey(): Promise<string | null> {
    if (this.apiKey) return this.apiKey;
    return process.env.LOB_API_KEY || null;
  }

  async verifyAddress(address: PostalAddress): Promise<AddressVerificationResult> {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      return {
        valid: false,
        deliverable: false,
        error: 'LOB_API_KEY not configured',
      };
    }

    try {
      const response = await fetch(`${this.baseUrl}/us_verifications`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipient: address.name,
          primary_line: address.addressLine1,
          secondary_line: address.addressLine2 || '',
          city: address.city,
          state: address.state,
          zip_code: address.zip,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          valid: false,
          deliverable: false,
          error: `Lob API error: ${response.status} - ${JSON.stringify(errorData)}`,
        };
      }

      const data: LobVerificationResponse = await response.json();
      
      const normalizedAddress: PostalAddress = {
        name: address.name,
        company: address.company,
        addressLine1: data.primary_line,
        addressLine2: data.secondary_line || undefined,
        city: data.components.city,
        state: data.components.state,
        zip: data.components.zip_code + (data.components.zip_code_plus_4 ? `-${data.components.zip_code_plus_4}` : ''),
        country: 'US',
      };

      const canonicalAddress = buildCanonicalAddress(normalizedAddress);

      const isDeliverable = data.deliverability === 'deliverable' ||
        data.deliverability === 'deliverable_unnecessary_unit' ||
        data.deliverability === 'deliverable_incorrect_unit' ||
        data.deliverability === 'deliverable_missing_unit';

      return {
        valid: data.valid_address,
        deliverable: isDeliverable,
        canonicalAddress,
        normalizedAddress,
        deliverabilityAnalysis: {
          dpvMatchCode: data.deliverability_analysis.dpv_match_code,
          dpvFootnotes: data.deliverability_analysis.dpv_footnotes,
          dpvCmra: data.deliverability_analysis.dpv_cmra,
          dpvVacant: data.deliverability_analysis.dpv_vacant,
          dpvActive: data.deliverability_analysis.dpv_active,
          lacsLinkCode: data.deliverability_analysis.lacs_link_code,
          lacsLinkIndicator: data.deliverability_analysis.lacs_link_indicator,
          suiteReturnCode: data.deliverability_analysis.suite_return_code,
          primaryNumber: data.components.primary_number,
          streetPredirection: data.components.street_predirection,
          streetName: data.components.street_name,
          streetSuffix: data.components.street_suffix,
          streetPostdirection: data.components.street_postdirection,
          secondaryDesignator: data.components.secondary_designator,
          secondaryNumber: data.components.secondary_number,
          pmbDesignator: data.components.pmb_designator,
          pmbNumber: data.components.pmb_number,
          extraSecondaryDesignator: data.components.extra_secondary_designator,
          extraSecondaryNumber: data.components.extra_secondary_number,
          city: data.components.city,
          state: data.components.state,
          zipCode: data.components.zip_code,
          zipCodePlus4: data.components.zip_code_plus_4,
          zipCodeType: data.components.zip_code_type,
          deliveryPointBarcode: data.components.delivery_point_barcode,
          addressType: data.components.address_type,
          recordType: data.components.record_type,
          defaultBuildingAddress: data.components.default_building_address,
          county: data.components.county,
          countyFips: data.components.county_fips,
          carrierRoute: data.components.carrier_route,
          carrierRouteType: data.components.carrier_route_type,
          latitude: data.components.latitude,
          longitude: data.components.longitude,
        },
        rawResponse: data,
      };
    } catch (error) {
      return {
        valid: false,
        deliverable: false,
        error: error instanceof Error ? error.message : 'Unknown error during address verification',
      };
    }
  }

  async sendLetter(params: SendLetterParams): Promise<LetterSendResult> {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      return {
        success: false,
        error: 'LOB_API_KEY not configured',
      };
    }

    try {
      const mailType = params.options?.mailType || 'usps_first_class';
      
      const letterData: Record<string, unknown> = {
        description: params.description || 'Letter',
        to: {
          name: params.to.name,
          company: params.to.company,
          address_line1: params.to.addressLine1,
          address_line2: params.to.addressLine2,
          address_city: params.to.city,
          address_state: params.to.state,
          address_zip: params.to.zip,
          address_country: params.to.country || 'US',
        },
        from: {
          name: params.from.name,
          company: params.from.company,
          address_line1: params.from.addressLine1,
          address_line2: params.from.addressLine2,
          address_city: params.from.city,
          address_state: params.from.state,
          address_zip: params.from.zip,
          address_country: params.from.country || 'US',
        },
        color: params.options?.color || false,
        double_sided: params.options?.doubleSided || false,
        mail_type: mailType,
      };

      if (params.options?.extraService) {
        letterData.extra_service = params.options.extraService;
      }

      if (params.options?.returnEnvelope !== undefined) {
        letterData.return_envelope = params.options.returnEnvelope;
      }

      if (params.options?.perforatedPage !== undefined) {
        letterData.perforated_page = params.options.perforatedPage;
      }

      if (params.options?.customEnvelope) {
        letterData.custom_envelope = params.options.customEnvelope;
      }

      if (params.templateId) {
        letterData.template_id = params.templateId;
        if (params.mergeVariables) {
          letterData.merge_variables = params.mergeVariables;
        }
      } else if (params.file) {
        letterData.file = params.file;
      }

      if (params.metadata) {
        letterData.metadata = params.metadata;
      }

      const response = await fetch(`${this.baseUrl}/letters`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(letterData),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          success: false,
          error: `Lob API error: ${response.status} - ${JSON.stringify(errorData)}`,
        };
      }

      const data: LobLetterResponse = await response.json();

      return {
        success: true,
        letterId: data.id,
        status: 'created',
        expectedDeliveryDate: data.expected_delivery_date ? new Date(data.expected_delivery_date) : undefined,
        trackingNumber: data.tracking_number || undefined,
        carrier: data.carrier,
        details: {
          url: data.url,
          dateCreated: data.date_created,
          sendDate: data.send_date,
          thumbnails: data.thumbnails,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error sending letter',
      };
    }
  }

  async getLetterStatus(letterId: string): Promise<{ status: string; trackingEvents: LetterTrackingEvent[] }> {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      throw new Error('LOB_API_KEY not configured');
    }

    const response = await fetch(`${this.baseUrl}/letters/${letterId}`, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Lob API error: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    const data: LobLetterResponse = await response.json();

    const trackingEvents: LetterTrackingEvent[] = (data.tracking_events || []).map((event) => ({
      id: event.id,
      type: event.type,
      name: event.name,
      time: new Date(event.time),
      location: event.location,
      details: JSON.stringify(event.details),
    }));

    let status = 'unknown';
    if (data.deleted) {
      status = 'cancelled';
    } else if (trackingEvents.length > 0) {
      const lastEvent = trackingEvents[trackingEvents.length - 1];
      status = lastEvent.type;
    } else {
      status = 'processing';
    }

    return { status, trackingEvents };
  }

  async cancelLetter(letterId: string): Promise<{ success: boolean; error?: string }> {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      return { success: false, error: 'LOB_API_KEY not configured' };
    }

    try {
      const response = await fetch(`${this.baseUrl}/letters/${letterId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          success: false,
          error: `Lob API error: ${response.status} - ${JSON.stringify(errorData)}`,
        };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error cancelling letter',
      };
    }
  }

  supportsPostal(): boolean {
    return true;
  }

  async getDefaultReturnAddress(): Promise<PostalAddress | undefined> {
    return this.settings.defaultReturnAddress;
  }

  async setDefaultReturnAddress(address: PostalAddress): Promise<void> {
    this.settings.defaultReturnAddress = address;
    
    const configKey = getConfigKey('postal');
    const existingConfig = await db.select().from(variables).where(eq(variables.name, configKey)).limit(1);
    
    if (existingConfig.length > 0) {
      const currentConfig = existingConfig[0].value as Record<string, unknown>;
      const providers = (currentConfig.providers || {}) as Record<string, { enabled: boolean; settings: Record<string, unknown> }>;
      
      if (!providers.lob) {
        providers.lob = { enabled: true, settings: {} };
      }
      providers.lob.settings.defaultReturnAddress = address;
      
      await db.update(variables)
        .set({ value: { ...currentConfig, providers } })
        .where(eq(variables.name, configKey));
    }
  }
}
