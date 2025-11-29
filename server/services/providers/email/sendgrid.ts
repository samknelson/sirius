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
import { logger } from '../../../logger';

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

function getSendGridApiKey(): string {
  const apiKey = process.env.SENDGRID_API_KEY;
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
    try {
      const apiKey = getSendGridApiKey();
      sgMail.setApiKey(apiKey);
      
      return {
        success: true,
        message: 'SendGrid API key is configured',
        details: {
          provider: 'sendgrid',
          apiKeyConfigured: true,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || 'Failed to configure SendGrid',
      };
    }
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
    try {
      await this.initializeSendGrid();
      
      if (!this.initialized) {
        return {
          success: false,
          error: 'SendGrid is not initialized. Check that SENDGRID_API_KEY is set.',
        };
      }

      const toRecipients = Array.isArray(params.to) ? params.to : [params.to];
      
      const fromAddress = params.from || await this.getDefaultFromAddress();
      if (!fromAddress) {
        return {
          success: false,
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
        msg.customArgs = {
          callback_url: params.statusCallbackUrl,
        };
      }

      logger.info('Sending email via SendGrid', {
        service: 'email-provider-sendgrid',
        to: toRecipients.map(r => r.email),
        from: fromAddress.email,
        subject: params.subject,
      });

      const [response] = await sgMail.send(msg as unknown as sgMail.MailDataRequired);

      const messageId = response.headers['x-message-id'] as string | undefined;

      logger.info('Email sent successfully via SendGrid', {
        service: 'email-provider-sendgrid',
        messageId,
        statusCode: response.statusCode,
      });

      return {
        success: true,
        messageId,
        status: 'sent',
        details: {
          statusCode: response.statusCode,
        },
      };

    } catch (error: any) {
      logger.error('Failed to send email via SendGrid', {
        service: 'email-provider-sendgrid',
        error: error?.message || String(error),
        response: error?.response?.body,
      });

      return {
        success: false,
        error: error?.response?.body?.errors?.[0]?.message || error?.message || 'Failed to send email',
        details: {
          errorCode: error?.code,
          response: error?.response?.body,
        },
      };
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
    
    const envFromEmail = process.env.SENDGRID_FROM_EMAIL;
    const envFromName = process.env.SENDGRID_FROM_NAME;
    
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
