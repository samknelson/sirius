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
import { log } from '../../../../logger';

export class LocalPostalProvider implements PostalTransport {
  readonly id = 'local';
  readonly displayName = 'Local (Testing Only)';
  readonly category = 'postal' as const;
  readonly supportedFeatures = [
    'address_verification',
  ];

  private settings: PostalProviderSettings = {};

  async configure(config: unknown): Promise<void> {
    const cfg = config as PostalProviderSettings;
    this.settings = cfg;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    return {
      success: true,
      message: 'Local postal provider is available (testing mode - no actual mailing)',
    };
  }

  async getConfiguration(): Promise<Record<string, unknown>> {
    return {
      mode: 'local',
      defaultReturnAddress: this.settings.defaultReturnAddress,
    };
  }

  async verifyAddress(address: PostalAddress): Promise<AddressVerificationResult> {
    log.info('Local postal provider: verifying address', { 
      service: 'postal-local',
      address: {
        addressLine1: address.addressLine1,
        city: address.city,
        state: address.state,
        zip: address.zip,
      }
    });

    const hasRequiredFields = !!(
      address.addressLine1 &&
      address.city &&
      address.state &&
      address.zip &&
      address.country
    );

    if (!hasRequiredFields) {
      return {
        valid: false,
        deliverable: false,
        error: 'Missing required address fields',
      };
    }

    const zipRegex = /^\d{5}(-\d{4})?$/;
    const isValidZip = zipRegex.test(address.zip);

    const stateRegex = /^[A-Z]{2}$/i;
    const isValidState = stateRegex.test(address.state);

    if (!isValidZip) {
      return {
        valid: false,
        deliverable: false,
        error: 'Invalid ZIP code format (expected 5 digits or 5+4)',
      };
    }

    if (!isValidState) {
      return {
        valid: false,
        deliverable: false,
        error: 'Invalid state format (expected 2-letter state code)',
      };
    }

    const normalizedAddress: PostalAddress = {
      name: address.name,
      company: address.company,
      addressLine1: address.addressLine1.trim().toUpperCase(),
      addressLine2: address.addressLine2?.trim().toUpperCase(),
      city: address.city.trim().toUpperCase(),
      state: address.state.trim().toUpperCase(),
      zip: address.zip.trim(),
      country: (address.country || 'US').trim().toUpperCase(),
    };

    const canonicalAddress = buildCanonicalAddress(normalizedAddress);

    return {
      valid: true,
      deliverable: true,
      canonicalAddress,
      normalizedAddress,
      deliverabilityAnalysis: {
        dpvMatchCode: 'Y',
        city: normalizedAddress.city,
        state: normalizedAddress.state,
        zipCode: normalizedAddress.zip.substring(0, 5),
        zipCodePlus4: normalizedAddress.zip.length > 5 ? normalizedAddress.zip.substring(6) : undefined,
        addressType: 'residential',
      },
    };
  }

  async sendLetter(params: SendLetterParams): Promise<LetterSendResult> {
    log.warn('Local postal provider: sendLetter called but no actual mailing will occur', {
      service: 'postal-local',
      to: {
        name: params.to.name,
        addressLine1: params.to.addressLine1,
        city: params.to.city,
        state: params.to.state,
        zip: params.to.zip,
      },
      from: {
        name: params.from.name,
        addressLine1: params.from.addressLine1,
        city: params.from.city,
        state: params.from.state,
        zip: params.from.zip,
      },
      options: params.options,
      description: params.description,
    });

    const mockLetterId = `local_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const expectedDelivery = new Date();
    expectedDelivery.setDate(expectedDelivery.getDate() + 5);

    return {
      success: true,
      letterId: mockLetterId,
      status: 'simulated',
      expectedDeliveryDate: expectedDelivery,
      carrier: 'USPS (simulated)',
      details: {
        note: 'This is a simulated letter from the local testing provider. No actual mail will be sent.',
        params: {
          to: params.to,
          from: params.from,
          options: params.options,
        },
      },
    };
  }

  async getLetterStatus(letterId: string): Promise<{ status: string; trackingEvents: LetterTrackingEvent[] }> {
    log.info('Local postal provider: getLetterStatus called', {
      service: 'postal-local',
      letterId,
    });

    return {
      status: 'simulated',
      trackingEvents: [
        {
          id: `${letterId}_event_1`,
          type: 'Created',
          name: 'Letter Created',
          time: new Date(Date.now() - 86400000),
          details: 'Simulated tracking event',
        },
        {
          id: `${letterId}_event_2`,
          type: 'In Transit',
          name: 'In Transit to Destination',
          time: new Date(),
          location: 'Distribution Center',
          details: 'Simulated tracking event',
        },
      ],
    };
  }

  async cancelLetter(letterId: string): Promise<{ success: boolean; error?: string }> {
    log.info('Local postal provider: cancelLetter called', {
      service: 'postal-local',
      letterId,
    });

    return {
      success: true,
    };
  }

  supportsPostal(): boolean {
    return false;
  }

  async getDefaultReturnAddress(): Promise<PostalAddress | undefined> {
    return this.settings.defaultReturnAddress;
  }

  async setDefaultReturnAddress(address: PostalAddress): Promise<void> {
    this.settings.defaultReturnAddress = address;
  }
}
