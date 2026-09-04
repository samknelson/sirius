import sgMail from '@sendgrid/mail';
import type { 
  EmailTransport, 
  EmailValidationResult, 
  EmailSendResult, 
  SendEmailParams,
  EmailProviderSettings,
  EmailRecipient
} from './index';
import type { ConnectionTestResult } from '../base';
import { logger } from '../../../../logger';
import { getEnvironmentVariable, registerEnvironmentVariables } from "../../../../config/env-registry";
import { registerUncachedWcRequest, wcUncachedRequest } from "../../../webclient";

/**
 * SendGrid's outbound operations, neither of which is ever cached: an email
 * that was already sent must not be reported as sent again without going out,
 * and a stored "the key works" is not a connection test.
 *
 * The send needs a writable database — an email that leaves while nothing can
 * be written down never appears on the comm record — and the connection test
 * does not, because it records nothing either way.
 */
const SEND_EMAIL = 'send-email';
const TEST_CONNECTION = 'test-connection';

registerUncachedWcRequest({
  service: 'SendGrid',
  requestType: SEND_EMAIL,
  operation: 'send email',
  needsWritableDatabase: true,
});
registerUncachedWcRequest({
  service: 'SendGrid',
  requestType: TEST_CONNECTION,
  operation: 'test connection',
  needsWritableDatabase: false,
});

// SENDGRID_API_KEY is "restart": initializeSendGrid() hands the key to the
// SendGrid client once and then short-circuits on `this.initialized`, and the
// provider instance itself is cached by the service registry, so a new key
// does not reach the sending path in this process. It is also registered by
// server/services/service-registry.ts — registration is last-one-wins, so both
// copies must carry the same classification.
//
// The From address parts are "immediate": getDefaultFromAddress() re-reads
// them through the registry on every send that does not carry its own From.
registerEnvironmentVariables([
  { name: "SENDGRID_API_KEY", description: "SendGrid API key for the sendgrid email provider.", secret: true, category: "core", changeTakesEffect: "restart", },
  { name: "SENDGRID_FROM_EMAIL", description: "Default From email address for SendGrid sends.", secret: false, category: "core", changeTakesEffect: "immediate", },
  { name: "SENDGRID_FROM_NAME", description: "Default From display name for SendGrid sends.", secret: false, category: "core", changeTakesEffect: "immediate", },
]);

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

function getSendGridApiKey(): string {
  const apiKey = getEnvironmentVariable("SENDGRID_API_KEY");
  if (!apiKey) {
    throw new Error('SENDGRID_API_KEY environment variable is not set');
  }
  return apiKey;
}

export class SendGridEmailProvider implements EmailTransport {
  readonly id = 'sendgrid';
  readonly displayName = 'SendGrid';
  readonly category = 'email' as const;
  readonly supportedFeatures = ['email', 'email-validation', 'delivery-status'];

  private settings: EmailProviderSettings = {};
  private initialized = false;

  async configure(config: unknown): Promise<void> {
    if (config && typeof config === 'object') {
      this.settings = config as EmailProviderSettings;
    }
    await this.initializeSendGrid();
  }

  private async initializeSendGrid(): Promise<void> {
    if (this.initialized) return;
    
    try {
      const apiKey = getSendGridApiKey();
      sgMail.setApiKey(apiKey);
      this.initialized = true;
    } catch (error) {
      logger.warn('SendGrid API key not configured', {
        service: 'email-provider-sendgrid',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async testConnection(): Promise<ConnectionTestResult> {
    // The framework's refusal comes back out of here rather than becoming a
    // connection result: a maintenance refusal is not a failed connection.
    const { value, error } = await wcUncachedRequest<ConnectionTestResult>({
      service: 'SendGrid',
      requestType: TEST_CONNECTION,
      fetch: async () => {
        try {
          const apiKey = getSendGridApiKey();
          sgMail.setApiKey(apiKey);

          return {
            answered: true,
            value: {
              success: true,
              message: 'SendGrid API key is configured',
              details: {
                provider: 'sendgrid',
                apiKeyConfigured: true,
              },
            },
          };
        } catch (error: any) {
          return { answered: false, error: error?.message || 'Failed to configure SendGrid' };
        }
      },
    });

    return value ?? { success: false, error: error || 'Failed to configure SendGrid' };
  }

  async getConfiguration(): Promise<Record<string, unknown>> {
    try {
      const apiKey = getSendGridApiKey();
      const maskedKey = apiKey.substring(0, 8) + '...' + apiKey.substring(apiKey.length - 4);
      
      return {
        connected: true,
        provider: 'sendgrid',
        apiKeyMasked: maskedKey,
        defaultFromEmail: this.settings.defaultFromEmail,
        defaultFromName: this.settings.defaultFromName,
      };
    } catch (error: any) {
      return {
        connected: false,
        error: error?.message || 'SendGrid not configured',
      };
    }
  }

  async validateEmail(email: string): Promise<EmailValidationResult> {
    const trimmed = email.trim().toLowerCase();
    
    if (!trimmed) {
      return {
        valid: false,
        error: 'Email address is required',
      };
    }

    if (!EMAIL_REGEX.test(trimmed)) {
      return {
        valid: false,
        error: 'Invalid email address format',
      };
    }

    const [localPart, domain] = trimmed.split('@');
    
    if (!domain || !domain.includes('.')) {
      return {
        valid: false,
        error: 'Email domain must include a TLD',
      };
    }

    if (localPart.length > 64 || trimmed.length > 254) {
      return {
        valid: false,
        error: 'Email address is too long',
      };
    }

    return {
      valid: true,
      formatted: trimmed,
    };
  }

  async sendEmail(params: SendEmailParams): Promise<EmailSendResult> {
    // SendGrid's own error carries a code and the response body the send
    // screens read. The framework hands back only the message, so the full
    // shape is kept here, where it is built.
    let failure: EmailSendResult | undefined;

    // The framework refuses before this callback runs, so a maintenance
    // refusal never hands the API key to the SendGrid client and is never
    // reported as a failed send.
    const { value, error } = await wcUncachedRequest<EmailSendResult>({
      service: 'SendGrid',
      requestType: SEND_EMAIL,
      fetch: () => this.sendEmailToSendGrid(params, (result) => { failure = result; }),
    });

    return (
      value ??
      failure ?? {
        success: false,
        error: error || 'Failed to send email',
      }
    );
  }

  /**
   * The send itself. Declares whether SendGrid answered: everything below that
   * is not a `202` from SendGrid is a non-answer, including our own refusals
   * to attempt it.
   */
  private async sendEmailToSendGrid(
    params: SendEmailParams,
    recordFailure: (result: EmailSendResult) => void,
  ): Promise<{ answered: boolean; value?: EmailSendResult; error?: string }> {
    try {
      await this.initializeSendGrid();
      
      if (!this.initialized) {
        return {
          answered: false,
          error: 'SendGrid is not initialized. Check that SENDGRID_API_KEY is set.',
        };
      }

      const toRecipients = Array.isArray(params.to) ? params.to : [params.to];
      
      const fromAddress = params.from || await this.getDefaultFromAddress();
      if (!fromAddress) {
        return {
          answered: false,
          error: 'No from address specified and no default from address configured',
        };
      }

      const msg: Record<string, unknown> = {
        to: toRecipients.map(r => ({ email: r.email, name: r.name })),
        from: { email: fromAddress.email, name: fromAddress.name },
        subject: params.subject,
      };

      if (params.text) {
        msg.text = params.text;
      }

      if (params.html) {
        msg.html = params.html;
      }

      if (params.replyTo) {
        msg.replyTo = { email: params.replyTo.email, name: params.replyTo.name };
      }

      if (params.cc && params.cc.length > 0) {
        msg.cc = params.cc.map(r => ({ email: r.email, name: r.name }));
      }

      if (params.bcc && params.bcc.length > 0) {
        msg.bcc = params.bcc.map(r => ({ email: r.email, name: r.name }));
      }

      if (params.attachments && params.attachments.length > 0) {
        msg.attachments = params.attachments.map(a => ({
          filename: a.filename,
          content: a.content,
          type: a.type,
          disposition: a.disposition || 'attachment',
          contentId: a.contentId,
        }));
      }

      if (params.statusCallbackUrl) {
        msg.custom_args = {
          callback_url: params.statusCallbackUrl,
        };
      }

      // PII triage: addresses and staff-entered subject text stay out of
      // logs; the comm record stores the full message if needed.
      logger.info('Sending email via SendGrid', {
        service: 'email-provider-sendgrid',
        toCount: toRecipients.length,
      });

      const [response] = await sgMail.send(msg as unknown as sgMail.MailDataRequired);

      const messageId = response.headers['x-message-id'] as string | undefined;

      logger.info('Email sent successfully via SendGrid', {
        service: 'email-provider-sendgrid',
        messageId,
        statusCode: response.statusCode,
      });

      return {
        answered: true,
        value: {
          success: true,
          messageId,
          status: 'sent',
          details: {
            statusCode: response.statusCode,
          },
        },
      };

    } catch (error: any) {
      logger.error('Failed to send email via SendGrid', {
        service: 'email-provider-sendgrid',
        error: error?.message || String(error),
        response: error?.response?.body,
      });

      const result: EmailSendResult = {
        success: false,
        error: error?.response?.body?.errors?.[0]?.message || error?.message || 'Failed to send email',
        details: {
          errorCode: error?.code,
          response: error?.response?.body,
        },
      };
      recordFailure(result);
      return { answered: false, error: result.error };
    }
  }

  supportsEmail(): boolean {
    return true;
  }

  async getDefaultFromAddress(): Promise<EmailRecipient | undefined> {
    if (this.settings.defaultFromEmail) {
      return {
        email: this.settings.defaultFromEmail,
        name: this.settings.defaultFromName,
      };
    }
    
    const envFromEmail = getEnvironmentVariable("SENDGRID_FROM_EMAIL");
    const envFromName = getEnvironmentVariable("SENDGRID_FROM_NAME");
    
    if (envFromEmail) {
      return {
        email: envFromEmail,
        name: envFromName,
      };
    }
    
    return undefined;
  }

  async setDefaultFromAddress(recipient: EmailRecipient): Promise<void> {
    this.settings.defaultFromEmail = recipient.email;
    this.settings.defaultFromName = recipient.name;
  }
}
