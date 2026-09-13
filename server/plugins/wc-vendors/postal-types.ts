import type {
  AddressVerificationResult,
  LetterSendResult,
  LetterTrackingEvent,
  PostalAddress,
  PostalTemplate,
  SendLetterParams,
} from "../../services/comm/providers/postal";

/*
 * Comm's postal vocabulary is kept outside the shared payment-oriented
 * wc-vendor type file. Both the plugin implementation and domain callers
 * import this module so the augmentation is present wherever typed requests
 * are compiled.
 */
declare module "./types" {
  interface WcVendorOperations {
    "verify-address": { args: PostalAddress; result: AddressVerificationResult };
    "send-letter": { args: SendLetterParams; result: LetterSendResult };
    "letter-status": {
      args: { letterId: string };
      result: { status: string; trackingEvents: LetterTrackingEvent[] };
    };
    "cancel-letter": { args: { letterId: string }; result: { success: boolean; error?: string } };
    "list-templates": { args: void; result: PostalTemplate[] };
    "get-default-return-address": { args: void; result: PostalAddress | undefined };
  }
}

export type PostalVendorTypesLoaded = true;
