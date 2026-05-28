import type { 
  EmailTransport, 
  EmailValidationResult, 
  EmailSendResult, 
  SendEmailParams,
  EmailProviderSettings,
  EmailRecipient
} from './index';
import type { ConnectionTestResult } from '../base';

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

export class LocalEmailProvider implements EmailTransport {
  readonly id = 'local';
  readonly displayName = 'Local (Validation Only)';
  readonly category = 'email' as const;
  readonly supportedFeatures = ['email-validation'];

  private settings: EmailProviderSettings = {};

  async configure(config: unknown): Promise<void> {
    if (config && typeof config === 'object') {
      this.settings = config as EmailProviderSettings;
    }
  }

  async testConnection(): Promise<ConnectionTestResult> {
    return {
      success: true,
      message: 'Local provider is always available (no external connection required)',
    };
  }

  async getConfiguration(): Promise<Record<string, unknown>> {
    return {
      connected: true,
      provider: 'local',
      capabilities: this.supportedFeatures,
    };
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
        error: 'Email domain must include a TLD (e.g., .com, .org)',
      };
    }

    if (localPart.length > 64) {
      return {
        valid: false,
        error: 'Local part of email address is too long (max 64 characters)',
      };
    }

    if (trimmed.length > 254) {
      return {
        valid: false,
        error: 'Email address is too long (max 254 characters)',
      };
    }

    return {
      valid: true,
      formatted: trimmed,
    };
  }

  async sendEmail(params: SendEmailParams): Promise<EmailSendResult> {
    return {
      success: false,
      error: 'Local provider does not support sending emails. Configure an email provider (e.g., SendGrid).',
    };
  }

  supportsEmail(): boolean {
    return false;
  }

  async getDefaultFromAddress(): Promise<EmailRecipient | undefined> {
    if (this.settings.defaultFromEmail) {
      return {
        email: this.settings.defaultFromEmail,
        name: this.settings.defaultFromName,
      };
    }
    return undefined;
  }

  async setDefaultFromAddress(recipient: EmailRecipient): Promise<void> {
    this.settings.defaultFromEmail = recipient.email;
    this.settings.defaultFromName = recipient.name;
  }
}
