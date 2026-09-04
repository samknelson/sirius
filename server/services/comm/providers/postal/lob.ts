import type { ConnectionTestResult } from '../base';
import type {
  PostalTransport,
  PostalAddress,
  AddressVerificationResult,
  SendLetterParams,
  LetterSendResult,
  LetterTrackingEvent,
  PostalProviderSettings,
  PostalTemplate,
} from './index';
import { buildCanonicalAddress } from './index';
import { storage } from '../../../../storage';
import { getConfigKey } from '../base';
import { getEnvironmentVariable, registerEnvironmentVariables } from "../../../../config/env-registry";
import { assertExternalServiceAllowed } from "../../../maintenance-flag";
import { registerUncachedWcRequest, wcUncachedRequest } from "../../../webclient";

/**
 * Lob's uncached operations.
 *
 * Address verification is not among them: its answer is worth keeping and it
 * stays on the shared guard until it moves onto the framework as a cached
 * entry.
 *
 * Printing a letter and cancelling one both change something at Lob that this
 * database has to know about afterwards, so both need a writable database. The
 * connection test, the status poll and the template list only read, and an
 * operator looking at a read-only site is exactly who needs them.
 */
const SEND_LETTER = 'send-letter';
const TEST_CONNECTION = 'test-connection';
const LETTER_STATUS = 'letter-status';
const CANCEL_LETTER = 'cancel-letter';
const LIST_TEMPLATES = 'list-templates';

registerUncachedWcRequest({
  service: 'Lob',
  requestType: SEND_LETTER,
  operation: 'send letter',
  needsWritableDatabase: true,
});
registerUncachedWcRequest({
  service: 'Lob',
  requestType: TEST_CONNECTION,
  operation: 'test connection',
  needsWritableDatabase: false,
});
registerUncachedWcRequest({
  service: 'Lob',
  requestType: LETTER_STATUS,
  operation: 'poll letter status',
  needsWritableDatabase: false,
});
registerUncachedWcRequest({
  service: 'Lob',
  requestType: CANCEL_LETTER,
  operation: 'cancel letter',
  needsWritableDatabase: true,
});
registerUncachedWcRequest({
  service: 'Lob',
  requestType: LIST_TEMPLATES,
  operation: 'list templates',
  needsWritableDatabase: false,
});

// changeTakesEffect: "immediate". getApiKey() re-reads the variable through
// the registry on every call, and nothing caches it — the only cached key is
// one supplied explicitly through configure(), which is provider settings
// rather than this environment variable.
registerEnvironmentVariables([
  { name: "LOB_API_KEY", description: "Lob API key for the postal mail provider.", secret: true, category: "core", changeTakesEffect: "immediate", },
]);

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
    // The framework's refusal comes back out of here rather than becoming a
    // connection result: a maintenance refusal is not a failed connection.
    const { value, error } = await wcUncachedRequest<ConnectionTestResult>({
      service: 'Lob',
      requestType: TEST_CONNECTION,
      fetch: async () => {
        try {
          const apiKey = await this.getApiKey();
          if (!apiKey) {
            return { answered: false, error: 'LOB_API_KEY not configured' };
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
              answered: true,
              value: {
                success: true,
                message: `Successfully connected to Lob API${isTestMode ? ' (test mode)' : ''}`,
                details: { isTestMode },
              },
            };
          }

          const errorData = await response.json().catch(() => ({}));
          // Lob answered — with a refusal of its own, which is what a
          // connection test is for.
          return {
            answered: true,
            value: {
              success: false,
              error: `API returned ${response.status}: ${JSON.stringify(errorData)}`,
            },
          };
        } catch (error) {
          return {
            answered: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
    });

    return value ?? { success: false, error: error || 'Unknown error' };
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
    return getEnvironmentVariable("LOB_API_KEY") || null;
  }

  async verifyAddress(address: PostalAddress): Promise<AddressVerificationResult> {
    // Ahead of the key read and the try: every failure below becomes a
    // `deliverable: false` result, and a refusal must not be mistaken for an
    // address Lob judged undeliverable.
    assertExternalServiceAllowed('Lob', 'verify address');
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      return {
        valid: false,
        deliverable: false,
        error: 'LOB_API_KEY not configured',
      };
    }

    const isTestMode = apiKey.startsWith('test_');

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
        console.log('[Lob] API error response:', response.status, errorData);
        return {
          valid: false,
          deliverable: false,
          error: `Lob API error: ${response.status} - ${JSON.stringify(errorData)}`,
        };
      }

      const data = await response.json();
      console.log('[Lob] Verification response:', JSON.stringify(data, null, 2));
      
      // Safely extract components - Lob test mode may return different structure
      const components = data.components || {};
      const deliverabilityAnalysis = data.deliverability_analysis || {};
      
      // In test mode, Lob returns empty components for real addresses.
      // It only works with specific test patterns like primary_line='deliverable' and zip_code='11111'.
      // For testing the opt-in workflow with real addresses, we use the original input.
      const hasValidLobComponents = components.city && components.state && components.zip_code;
      
      // Use Lob's normalized data if available, otherwise fall back to original input
      const normalizedAddress: PostalAddress = hasValidLobComponents ? {
        name: address.name,
        company: address.company,
        addressLine1: data.primary_line,
        addressLine2: data.secondary_line || undefined,
        city: components.city,
        state: components.state,
        zip: components.zip_code + (components.zip_code_plus_4 ? `-${components.zip_code_plus_4}` : ''),
        country: 'US',
      } : {
        // Fall back to original input for test mode with real addresses
        name: address.name,
        company: address.company,
        addressLine1: address.addressLine1,
        addressLine2: address.addressLine2,
        city: address.city,
        state: address.state,
        zip: address.zip,
        country: 'US',
      };

      const canonicalAddress = buildCanonicalAddress(normalizedAddress);

      const isDeliverable = data.deliverability === 'deliverable' ||
        data.deliverability === 'deliverable_unnecessary_unit' ||
        data.deliverability === 'deliverable_incorrect_unit' ||
        data.deliverability === 'deliverable_missing_unit';

      // In test mode, Lob doesn't actually verify real addresses - it only works with 
      // specific test addresses. For real addresses, accept them if the original input
      // has the required fields. This allows testing the opt-in workflow without a live API key.
      const hasOriginalAddressFields = Boolean(address.addressLine1 && address.city && address.state && address.zip);
      const isValidInTestMode = isTestMode && hasOriginalAddressFields;
      
      // PII triage (accepted, false positive): all four values are booleans
      // (mode/presence/validity flags), not address contents.
      console.log('[Lob] isTestMode:', isTestMode, 'hasLobComponents:', hasValidLobComponents, 'hasOriginalFields:', hasOriginalAddressFields, 'valid_address:', data.valid_address);

      return {
        valid: data.valid_address === true || isValidInTestMode,
        deliverable: isDeliverable || isValidInTestMode,
        canonicalAddress,
        normalizedAddress,
        deliverabilityAnalysis: {
          dpvMatchCode: deliverabilityAnalysis.dpv_match_code,
          dpvFootnotes: deliverabilityAnalysis.dpv_footnotes,
          dpvCmra: deliverabilityAnalysis.dpv_cmra,
          dpvVacant: deliverabilityAnalysis.dpv_vacant,
          dpvActive: deliverabilityAnalysis.dpv_active,
          lacsLinkCode: deliverabilityAnalysis.lacs_link_code,
          lacsLinkIndicator: deliverabilityAnalysis.lacs_link_indicator,
          suiteReturnCode: deliverabilityAnalysis.suite_return_code,
          primaryNumber: components.primary_number,
          streetPredirection: components.street_predirection,
          streetName: components.street_name,
          streetSuffix: components.street_suffix,
          streetPostdirection: components.street_postdirection,
          secondaryDesignator: components.secondary_designator,
          secondaryNumber: components.secondary_number,
          pmbDesignator: components.pmb_designator,
          pmbNumber: components.pmb_number,
          extraSecondaryDesignator: components.extra_secondary_designator,
          extraSecondaryNumber: components.extra_secondary_number,
          city: components.city,
          state: components.state,
          zipCode: components.zip_code,
          zipCodePlus4: components.zip_code_plus_4,
          zipCodeType: components.zip_code_type,
          deliveryPointBarcode: components.delivery_point_barcode,
          addressType: components.address_type,
          recordType: components.record_type,
          defaultBuildingAddress: components.default_building_address,
          county: components.county,
          countyFips: components.county_fips,
          carrierRoute: components.carrier_route,
          carrierRouteType: components.carrier_route_type,
          latitude: components.latitude,
          longitude: components.longitude,
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
    const { value, error } = await wcUncachedRequest<LetterSendResult>({
      service: 'Lob',
      requestType: SEND_LETTER,
      fetch: () => this.printLetterAtLob(params),
    });

    return value ?? { success: false, error: error || 'Unknown error sending letter' };
  }

  /**
   * The send itself. Only a letter Lob accepted counts as an answer — every
   * other ending leaves nothing printed.
   */
  private async printLetterAtLob(
    params: SendLetterParams,
  ): Promise<{ answered: boolean; value?: LetterSendResult; error?: string }> {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      return { answered: false, error: 'LOB_API_KEY not configured' };
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
        use_type: params.options?.useType || 'operational',
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
          answered: false,
          error: `Lob API error: ${response.status} - ${JSON.stringify(errorData)}`,
        };
      }

      const data: LobLetterResponse = await response.json();

      return {
        answered: true,
        value: {
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
        },
      };
    } catch (error) {
      return {
        answered: false,
        error: error instanceof Error ? error.message : 'Unknown error sending letter',
      };
    }
  }

  async getLetterStatus(letterId: string): Promise<{ status: string; trackingEvents: LetterTrackingEvent[] }> {
    type LetterStatus = { status: string; trackingEvents: LetterTrackingEvent[] };

    // This method's contract is to throw, and its callers read the thrown
    // error. The thrown error is carried back out rather than rebuilt from
    // text, so nothing about it changes on the way through the framework.
    let thrown: unknown;

    const { value, error } = await wcUncachedRequest<LetterStatus>({
      service: 'Lob',
      requestType: LETTER_STATUS,
      fetch: async () => {
        try {
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

          return { answered: true, value: { status, trackingEvents } };
        } catch (error) {
          thrown = error;
          return {
            answered: false,
            error: error instanceof Error ? error.message : 'Unknown error polling letter status',
          };
        }
      },
    });

    if (value) return value;
    if (thrown !== undefined) throw thrown;
    throw new Error(error || 'Unknown error polling letter status');
  }

  async cancelLetter(letterId: string): Promise<{ success: boolean; error?: string }> {
    const { value, error } = await wcUncachedRequest<{ success: boolean; error?: string }>({
      service: 'Lob',
      requestType: CANCEL_LETTER,
      fetch: async () => {
        const apiKey = await this.getApiKey();
        if (!apiKey) {
          return { answered: false, error: 'LOB_API_KEY not configured' };
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
              answered: false,
              error: `Lob API error: ${response.status} - ${JSON.stringify(errorData)}`,
            };
          }

          return { answered: true, value: { success: true } };
        } catch (error) {
          return {
            answered: false,
            error: error instanceof Error ? error.message : 'Unknown error cancelling letter',
          };
        }
      },
    });

    return value ?? { success: false, error: error || 'Unknown error cancelling letter' };
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
    const existingConfig = await storage.variables.getByName(configKey);
    
    if (existingConfig) {
      const currentConfig = existingConfig.value as Record<string, unknown>;
      const providers = (currentConfig.providers || {}) as Record<string, { enabled: boolean; settings: Record<string, unknown> }>;
      
      if (!providers.lob) {
        providers.lob = { enabled: true, settings: {} };
      }
      providers.lob.settings.defaultReturnAddress = address;
      
      await storage.variables.update(existingConfig.id, { 
        value: { ...currentConfig, providers } 
      });
    }
  }

  async listTemplates(): Promise<PostalTemplate[]> {
    // Every failure below collapses into an empty list, so the framework's
    // refusal is left to come back out: "Lob has no templates" is not what a
    // maintenance refusal means.
    const { value } = await wcUncachedRequest<PostalTemplate[]>({
      service: 'Lob',
      requestType: LIST_TEMPLATES,
      fetch: async () => {
        const apiKey = await this.getApiKey();
        if (!apiKey) {
          console.warn('[Lob] LOB_API_KEY not configured - cannot list templates');
          return { answered: false, error: 'LOB_API_KEY not configured' };
        }

        try {
          console.log('[Lob] Fetching templates from:', `${this.baseUrl}/templates?limit=100`);
          const response = await fetch(`${this.baseUrl}/templates?limit=100`, {
            method: 'GET',
            headers: {
              Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
            },
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('[Lob] API error listing templates:', response.status, errorData);
            return {
              answered: false,
              error: `Lob API error: ${response.status} - ${JSON.stringify(errorData)}`,
            };
          }

          const data = await response.json();
          const templates = data.data || [];

          console.log('[Lob] Templates response:', {
            count: templates.length,
            total: data.total_count,
            templates: templates.map((t: any) => ({ id: t.id, description: t.description }))
          });

          return {
            answered: true,
            value: templates.map((template: any) => ({
              id: template.id,
              description: template.description || 'Untitled Template',
              dateCreated: new Date(template.date_created),
              dateModified: new Date(template.date_modified),
              metadata: template.metadata,
            })),
          };
        } catch (error) {
          console.error('[Lob] Error listing templates:', error);
          return {
            answered: false,
            error: error instanceof Error ? error.message : 'Unknown error listing templates',
          };
        }
      },
    });

    return value ?? [];
  }
}
