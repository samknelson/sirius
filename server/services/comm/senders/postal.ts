import { serviceRegistry } from '../../service-registry';
import { getSystemMode } from '../../system-mode';
import { createCommStorage, createCommPostalStorage, createCommPostalOptinStorage } from '../../../storage/comm';
import { storage } from '../../../storage';
import { runInTransaction } from '../../../storage/transaction-context';
import type { PostalTransport, PostalAddress, SendLetterParams } from '../providers/postal';
import { verifyPostalAddress } from '../validators/address-verification';
import type { Comm, CommPostal } from '@shared/schema';
import { logger } from '../../../logger';
import { buildStatusCallbackUrl } from '../callback-handlers/url-builder';
import { isMaintenanceModeError } from "../../maintenance-flag";
import { ALREADY_SENT, findSentWithKey, type AlreadySentCode } from '../send-key';

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
  tagIds?: string[];
  sendOffline?: boolean;
  /**
   * Optional send-once key. See `comm.sendKey` in `shared/schema.ts`: the
   * first send with this key to this contact goes out, every later one is
   * refused with {@link ALREADY_SENT} and nothing reaches the provider.
   */
  sendKey?: string;
}

export interface SendPostalResult {
  success: boolean;
  comm?: Comm;
  commPostal?: CommPostal;
  error?: string;
  errorCode?: 'POSTAL_NOT_SUPPORTED' | 'VALIDATION_ERROR' | 'NOT_OPTED_IN' | 'NOT_ALLOWLISTED' | 'PROVIDER_ERROR' | 'UNKNOWN_ERROR' | 'NO_RETURN_ADDRESS' | AlreadySentCode;
  /**
   * The send was refused because its key was already spent. This is NOT a
   * failure — nothing was attempted and nothing broke. `comm` carries the
   * message that did go out, when it can still be read.
   */
  alreadySent?: boolean;
  letterId?: string;
}

const commStorage = createCommStorage();
const commPostalStorage = createCommPostalStorage();
const postalOptinStorage = createCommPostalOptinStorage();

/**
 * The answer when the claim insert came back empty: this key is spent, so the
 * letter already went out and nothing may be handed to the provider again.
 */
async function alreadySent(contactId: string, sendKey: string): Promise<SendPostalResult> {
  const existing = await findSentWithKey({ medium: 'postal', contactId, sendKey });
  return {
    success: false,
    alreadySent: true,
    comm: existing,
    error: 'A letter with this send key has already been sent to this contact',
    errorCode: ALREADY_SENT,
  };
}

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
  const { contactId, toAddress, fromAddress, description, file, templateId, mergeVariables, mailType, color, doubleSided, userId, tagIds, sendOffline, sendKey } = request;

  if (sendOffline) {
    try {
      const returnAddress = fromAddress;
      const claimed = await runInTransaction(async () => {
        const comm = await commStorage.createComm({
          medium: 'postal',
          contactId,
          status: 'offline',
          sent: new Date(),
          data: { initiatedBy: userId || 'system', offline: true },
          sendKey: sendKey ?? null,
        });
        if (!comm) return null;

        const commPostal = await commPostalStorage.createCommPostal({
          commId: comm.id,
          toName: toAddress.name || null,
          toCompany: toAddress.company || null,
          toAddressLine1: toAddress.addressLine1,
          toAddressLine2: toAddress.addressLine2 || null,
          toCity: toAddress.city,
          toState: toAddress.state,
          toZip: toAddress.zip,
          toCountry: toAddress.country,
          fromName: returnAddress?.name || null,
          fromCompany: returnAddress?.company || null,
          fromAddressLine1: returnAddress?.addressLine1 || null,
          fromAddressLine2: returnAddress?.addressLine2 || null,
          fromCity: returnAddress?.city || null,
          fromState: returnAddress?.state || null,
          fromZip: returnAddress?.zip || null,
          fromCountry: returnAddress?.country || null,
          description: description || null,
          body: file || null,
          mailType: mailType || 'usps_first_class',
          color: color || false,
          doubleSided: doubleSided || false,
          data: {
            ...(templateId ? { templateId } : {}),
            ...(mergeVariables ? { mergeVariables } : {}),
          },
        });

        if (tagIds && tagIds.length > 0) {
          await storage.commTags.setTags(comm.id, tagIds);
        }

        return { comm, commPostal };
      });

      if (!claimed) return await alreadySent(contactId, sendKey!);
      const { comm, commPostal } = claimed;

      return { success: true, comm, commPostal };
    } catch (error: any) {
      logger.error('Postal offline record failed', {
        service: 'postal-sender',
        error: error?.message || String(error),
      });
      return {
        success: false,
        error: error?.message || 'Unknown error occurred while recording offline postal mail',
        errorCode: 'UNKNOWN_ERROR',
      };
    }
  }

  try {
    const postalTransport = await serviceRegistry.resolve<PostalTransport>('postal');

    if (!postalTransport.supportsPostal()) {
      return {
        success: false,
        error: 'Postal mail is not supported by the current provider. Configure a provider with postal capability (e.g., Lob).',
        errorCode: 'POSTAL_NOT_SUPPORTED',
      };
    }

    const verificationResult = await verifyPostalAddress(postalTransport, toAddress);
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

    // This insert is the send-once claim: if a key was supplied and it is
    // already spent, nothing is written and nothing is sent.
    const claimed = await runInTransaction(async () => {
      const comm = await commStorage.createComm({
        medium: 'postal',
        contactId,
        status: 'sending',
        sent: new Date(),
        data: { initiatedBy: userId || 'system' },
        sendKey: sendKey ?? null,
      });
      if (!comm) return null;

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
        body: file || null,
        mailType: mailType || 'usps_first_class',
        color: color || false,
        doubleSided: doubleSided || false,
        data: {},
      });

      if (tagIds && tagIds.length > 0) {
        await storage.commTags.setTags(comm.id, tagIds);
      }

      return { comm, commPostal };
    });

    if (!claimed) return await alreadySent(contactId, sendKey!);
    const { comm, commPostal } = claimed;

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

      // PII triage: commId identifies the message; the address stays out of logs.
      logger.warn('Postal mail not sent - not opted in', {
        service: 'postal-sender',
        commId: comm.id,
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

      // PII triage: commId identifies the message; the address stays out of logs.
      logger.warn('Postal mail not sent - not allowlisted', {
        service: 'postal-sender',
        commId: comm.id,
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
    
    // PII triage: commId identifies the message; address fields stay out of logs.
    logger.info('Sending postal mail', {
      service: 'postal-sender',
      commId: comm.id,
      systemMode,
    });

    try {
      const statusCallbackUrl = buildStatusCallbackUrl(comm.id);
      
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
          ...(statusCallbackUrl && { callback_url: statusCallbackUrl }),
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
        lobLetterId: sendResult.letterId || null,
        expectedDeliveryDate: sendResult.expectedDeliveryDate || null,
        data: {
          ...commPostal.data as object,
          providerDetails: sendResult.details,
          trackingNumber: sendResult.trackingNumber || null,
          carrier: sendResult.carrier || null,
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
      // A maintenance refusal is not a provider failure. Let it out so the
      // route answers 503 with the maintenance message instead of burying it
      // in a PROVIDER_ERROR/UNKNOWN_ERROR result.
      if (isMaintenanceModeError(error)) throw error;
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
    // See above: the refusal is the answer, not a failed send.
    if (isMaintenanceModeError(error)) throw error;
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
