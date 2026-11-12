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
    "communications.postal.address.verify": { args: PostalAddress; result: AddressVerificationResult };
    "communications.postal.send": { args: SendLetterParams; result: LetterSendResult };
    "communications.postal.letter.status": {
      args: { letterId: string };
      result: { status: string; trackingEvents: LetterTrackingEvent[] };
    };
    "communications.postal.letter.cancel": { args: { letterId: string }; result: { success: boolean; error?: string } };
    "communications.postal.template.list": { args: void; result: PostalTemplate[] };
    "communications.postal.return-address.default": { args: void; result: PostalAddress | undefined };
  }
}

export type PostalVendorTypesLoaded = true;
