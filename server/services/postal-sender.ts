import { serviceRegistry } from './service-registry';
import { getSystemMode } from './system-mode';
import { createCommStorage, createCommPostalStorage, createCommPostalOptinStorage } from '../storage/comm';
import type { PostalTransport, PostalAddress, SendLetterParams } from './providers/postal';
import type { Comm, CommPostal } from '@shared/schema';
import { logger } from '../logger';

export interface SendPostalRequest {
  contactId: string;
  toAddress: PostalAddress;
  fromAddress?: PostalAddress;
  description?: string;
  file?: string;
  templateId?: string;
  mergeVariables?: Record<string, string>;
  mailType?: 'usps_first_class' | 'usps_standard';
  color?: boolean;
  doubleSided?: boolean;
  userId?: string;
}

export interface SendPostalResult {
  success: boolean;
  comm?: Comm;
  commPostal?: CommPostal;
  error?: string;
  errorCode?: 'POSTAL_NOT_SUPPORTED' | 'VALIDATION_ERROR' | 'NOT_OPTED_IN' | 'NOT_ALLOWLISTED' | 'PROVIDER_ERROR' | 'UNKNOWN_ERROR' | 'NO_RETURN_ADDRESS';
  letterId?: string;
}

const commStorage = createCommStorage();
const commPostalStorage = createCommPostalStorage();
const postalOptinStorage = createCommPostalOptinStorage();

function buildCanonicalAddress(address: PostalAddress): string {
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

export async function sendPostal(request: SendPostalRequest): Promise<SendPostalResult> {
  const { contactId, toAddress, fromAddress, description, file, templateId, mergeVariables, mailType, color, doubleSided, userId } = request;

  try {
    const postalTransport = await serviceRegistry.resolve<PostalTransport>('postal');

    if (!postalTransport.supportsPostal()) {
      return {
        success: false,
        error: 'Postal mail is not supported by the current provider. Configure a provider with postal capability (e.g., Lob).',
        errorCode: 'POSTAL_NOT_SUPPORTED',
      };
    }

    const verificationResult = await postalTransport.verifyAddress(toAddress);
    if (!verificationResult.valid) {
      return {
        success: false,
        error: `Invalid address: ${verificationResult.error || 'Address verification failed'}`,
        errorCode: 'VALIDATION_ERROR',
      };
    }

    const canonicalAddress = verificationResult.canonicalAddress || buildCanonicalAddress(toAddress);
    const normalizedAddress = verificationResult.normalizedAddress || toAddress;

    let returnAddress = fromAddress;
    if (!returnAddress) {
      returnAddress = await postalTransport.getDefaultReturnAddress();
    }

    if (!returnAddress) {
      return {
        success: false,
        error: 'No return address provided and no default return address configured.',
        errorCode: 'NO_RETURN_ADDRESS',
      };
    }

    const comm = await commStorage.createComm({
      medium: 'postal',
      contactId,
      status: 'sending',
      sent: new Date(),
      data: { initiatedBy: userId || 'system' },
    });

    const commPostal = await commPostalStorage.createCommPostal({
      commId: comm.id,
      toName: toAddress.name || null,
      toCompany: toAddress.company || null,
      toAddressLine1: normalizedAddress.addressLine1,
      toAddressLine2: normalizedAddress.addressLine2 || null,
      toCity: normalizedAddress.city,
      toState: normalizedAddress.state,
      toZip: normalizedAddress.zip,
      toCountry: normalizedAddress.country,
      fromName: returnAddress.name || null,
      fromCompany: returnAddress.company || null,
      fromAddressLine1: returnAddress.addressLine1,
      fromAddressLine2: returnAddress.addressLine2 || null,
      fromCity: returnAddress.city,
      fromState: returnAddress.state,
      fromZip: returnAddress.zip,
      fromCountry: returnAddress.country,
      description: description || null,
      mailType: mailType || 'usps_first_class',
      color: color || false,
      doubleSided: doubleSided || false,
      data: {},
    });

    const optinRecord = await postalOptinStorage.getPostalOptinByCanonicalAddress(canonicalAddress);

    if (!optinRecord || !optinRecord.optin) {
      await commStorage.updateComm(comm.id, {
        status: 'failed',
        data: {
          ...comm.data as object,
          errorCode: 'NOT_OPTED_IN',
          errorMessage: 'Address has not opted in to receive postal mail',
        },
      });

      logger.warn('Postal mail not sent - not opted in', {
        service: 'postal-sender',
        commId: comm.id,
        canonicalAddress,
      });

      return {
        success: false,
        comm: { ...comm, status: 'failed' },
        commPostal,
        error: 'Address has not opted in to receive postal mail',
        errorCode: 'NOT_OPTED_IN',
      };
    }

    const systemMode = await getSystemMode();

    if (systemMode !== 'live' && !optinRecord.allowlist) {
      await commStorage.updateComm(comm.id, {
        status: 'failed',
        data: {
          ...comm.data as object,
          errorCode: 'NOT_ALLOWLISTED',
          errorMessage: `Address is not allowlisted. System mode is "${systemMode}" - only allowlisted addresses can receive mail in non-live modes.`,
          systemMode,
        },
      });

      logger.warn('Postal mail not sent - not allowlisted', {
        service: 'postal-sender',
        commId: comm.id,
        canonicalAddress,
        systemMode,
      });

      return {
        success: false,
        comm: { ...comm, status: 'failed' },
        commPostal,
        error: `Address is not allowlisted. System mode is "${systemMode}" - only allowlisted addresses can receive mail in non-live modes.`,
        errorCode: 'NOT_ALLOWLISTED',
      };
    }
    
    logger.info('Sending postal mail', {
      service: 'postal-sender',
      commId: comm.id,
      toCity: normalizedAddress.city,
      toState: normalizedAddress.state,
      fromCity: returnAddress.city,
      fromState: returnAddress.state,
      systemMode,
    });

    try {
      const sendParams: SendLetterParams = {
        to: normalizedAddress,
        from: returnAddress,
        description,
        file,
        templateId,
        mergeVariables,
        options: {
          mailType,
          color,
          doubleSided,
        },
        metadata: {
          commId: comm.id,
          contactId,
        },
      };

      const sendResult = await postalTransport.sendLetter(sendParams);

      if (!sendResult.success) {
        await commStorage.updateComm(comm.id, {
          status: 'failed',
          data: {
            ...comm.data as object,
            errorCode: 'PROVIDER_ERROR',
            errorMessage: sendResult.error,
          },
        });

        logger.error('Postal send failed', {
          service: 'postal-sender',
          commId: comm.id,
          error: sendResult.error,
        });

        return {
          success: false,
          comm: { ...comm, status: 'failed' },
          commPostal,
          error: sendResult.error,
          errorCode: 'PROVIDER_ERROR',
        };
      }

      await commStorage.updateComm(comm.id, {
        status: 'sent',
        data: {
          ...comm.data as object,
          letterId: sendResult.letterId,
          expectedDeliveryDate: sendResult.expectedDeliveryDate,
          trackingNumber: sendResult.trackingNumber,
        },
      });

      await commPostalStorage.updateCommPostal(commPostal.id, {
        letterId: sendResult.letterId || null,
        expectedDeliveryDate: sendResult.expectedDeliveryDate || null,
        trackingNumber: sendResult.trackingNumber || null,
        carrier: sendResult.carrier || null,
        data: {
          ...commPostal.data as object,
          providerDetails: sendResult.details,
        },
      });

      logger.info('Postal mail sent successfully', {
        service: 'postal-sender',
        commId: comm.id,
        letterId: sendResult.letterId,
      });

      return {
        success: true,
        comm: { ...comm, status: 'sent' },
        commPostal,
        letterId: sendResult.letterId,
      };

    } catch (error: any) {
      await commStorage.updateComm(comm.id, {
        status: 'failed',
        data: {
          ...comm.data as object,
          errorCode: 'PROVIDER_ERROR',
          errorMessage: error?.message || 'Provider error',
        },
      });

      logger.error('Postal provider error', {
        service: 'postal-sender',
        commId: comm.id,
        error: error?.message,
      });

      return {
        success: false,
        comm: { ...comm, status: 'failed' },
        commPostal,
        error: error?.message || 'Postal provider error',
        errorCode: 'PROVIDER_ERROR',
      };
    }

  } catch (error: any) {
    logger.error('Postal sending failed', {
      service: 'postal-sender',
      error: error?.message || String(error),
    });

    return {
      success: false,
      error: error?.message || 'Unknown error occurred while sending postal mail',
      errorCode: 'UNKNOWN_ERROR',
    };
  }
}
