import sgMail from "@sendgrid/mail";
import type {
  WcVendorContext,
  WcVendorOperationDeclaration,
  WcVendorPlugin,
} from "../types";
import { registerWcVendorPlugin } from "../registry";
import { registerEnvironmentVariables } from "../../../config/env-registry";

export const SENDGRID_EMAIL_PLUGIN_ID = "sendgrid";
export const LOCAL_EMAIL_PLUGIN_ID = "local-email";
/** The pre-wc-vendor service registry used this provider id. */
export const LEGACY_LOCAL_EMAIL_PLUGIN_ID = "local";

// Keep these registered names available to existing wc-vendor rows and sender
// defaults. Credential values remain outside plugin configuration.
registerEnvironmentVariables([
  {
    name: "SENDGRID_API_KEY",
    description: "SendGrid API key",
    secret: true,
    category: "comm.email",
  },
  {
    name: "SENDGRID_FROM_EMAIL",
    description: "Legacy SendGrid sender email",
    secret: false,
    category: "comm.email",
  },
  {
    name: "SENDGRID_FROM_NAME",
    description: "Legacy SendGrid sender name",
    secret: false,
    category: "comm.email",
  },
]);

export interface EmailRecipient {
  email: string;
  name?: string;
}

export interface EmailSendArgs {
  to: EmailRecipient | EmailRecipient[];
  from?: EmailRecipient;
  replyTo?: EmailRecipient;
  subject: string;
  text?: string;
  html?: string;
  cc?: EmailRecipient[];
  bcc?: EmailRecipient[];
  statusCallbackUrl?: string;
}

export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  status?: string;
  error?: string;
  details?: Record<string, unknown>;
}

export interface EmailValidationResult {
  valid: boolean;
  formatted?: string;
  error?: string;
}

export interface EmailConfiguration {
  connected: boolean;
  provider: "sendgrid" | "local";
  apiKeyConfigured?: boolean;
  apiKeyMasked?: string;
  defaultFromEmail?: string;
  defaultFromName?: string;
  capabilities?: string[];
  error?: string;
}

const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

function configData(ctx: WcVendorContext): Record<string, unknown> {
  return (ctx.config.data ?? {}) as Record<string, unknown>;
}

function configuredFrom(ctx: WcVendorContext): EmailRecipient | undefined {
  const data = configData(ctx);
  return typeof data.defaultFromEmail === "string" && data.defaultFromEmail.trim()
    ? {
        email: data.defaultFromEmail.trim(),
        name:
          typeof data.defaultFromName === "string" && data.defaultFromName.trim()
            ? data.defaultFromName.trim()
            : undefined,
      }
    : undefined;
}

function validateEmail(email: string): EmailValidationResult {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) return { valid: false, error: "Email address is required" };
  if (!EMAIL_REGEX.test(trimmed)) {
    return { valid: false, error: "Invalid email address format" };
  }
  const [localPart, domain] = trimmed.split("@");
  if (!domain || !domain.includes(".")) {
    return { valid: false, error: "Email domain must include a TLD" };
  }
  if (localPart.length > 64 || trimmed.length > 254) {
    return { valid: false, error: "Email address is too long" };
  }
  return { valid: true, formatted: trimmed };
}

function sendGridKey(ctx: WcVendorContext): string {
  if (!ctx.credential.value) {
    throw new Error("SendGrid credential secret is not configured");
  }
  return ctx.credential.value;
}

async function sendGridEmail(
  ctx: WcVendorContext,
  args: EmailSendArgs,
): Promise<EmailSendResult> {
  const from = args.from ?? configuredFrom(ctx);
  if (!from) {
    return {
      success: false,
      error: "No from address specified and no default from address configured",
    };
  }

  sgMail.setApiKey(sendGridKey(ctx));
  const recipients = Array.isArray(args.to) ? args.to : [args.to];
  const message: Record<string, unknown> = {
    to: recipients.map((recipient) => ({
      email: recipient.email,
      name: recipient.name,
    })),
    from: { email: from.email, name: from.name },
    subject: args.subject,
  };
  if (args.text) message.text = args.text;
  if (args.html) message.html = args.html;
  if (args.replyTo) message.replyTo = args.replyTo;
  if (args.cc?.length) message.cc = args.cc;
  if (args.bcc?.length) message.bcc = args.bcc;
  if (args.statusCallbackUrl) {
    message.custom_args = { callback_url: args.statusCallbackUrl };
  }

  try {
    const [response] = await sgMail.send(
      message as unknown as sgMail.MailDataRequired,
    );
    return {
      success: true,
      messageId: response.headers["x-message-id"] as string | undefined,
      status: "sent",
      details: { statusCode: response.statusCode },
    };
  } catch (error: any) {
    return {
      success: false,
      error:
        error?.response?.body?.errors?.[0]?.message ||
        error?.message ||
        "Failed to send email",
      details: {
        errorCode: error?.code,
        response: error?.response?.body,
      },
    };
  }
}

type EmailOperationContract = {
  "send-email": { args: EmailSendArgs; result: EmailSendResult };
  "test-email-connection": {
    args: void;
    result: {
      success: boolean;
      message?: string;
      error?: string;
      details?: Record<string, unknown>;
    };
  };
  "validate-email": { args: { email: string }; result: EmailValidationResult };
  "get-email-configuration": { args: void; result: EmailConfiguration };
  "get-default-from": { args: void; result: EmailRecipient | undefined };
};

declare module "../types" {
  interface WcVendorOperations extends EmailOperationContract {}
}

const commonOperations = {
  "validate-email": {
    description: "validate an email address",
    needsWritableDatabase: false,
    manualRun: {
      argsSchema: {
        type: "object",
        properties: { email: { type: "string", format: "email" } },
        required: ["email"],
        additionalProperties: false,
      },
      effect: "read",
    },
    async run(
      _ctx: WcVendorContext,
      args: { email: string },
    ): Promise<EmailValidationResult> {
      return validateEmail(args.email);
    },
  },
  "get-default-from": {
    description: "read the configured default sender",
    needsWritableDatabase: false,
    manualRun: {
      argsSchema: { type: "object", properties: {}, additionalProperties: false },
      effect: "read",
    },
    async run(
      ctx: WcVendorContext,
      _args: void,
    ): Promise<EmailRecipient | undefined> {
      return configuredFrom(ctx);
    },
  },
} satisfies Record<string, WcVendorOperationDeclaration<any, any>>;

const sendGridOperations = {
  ...commonOperations,
  "send-email": {
    description: "send an email",
    needsWritableDatabase: true,
    async run(ctx: WcVendorContext, args: EmailSendArgs): Promise<EmailSendResult> {
      return sendGridEmail(ctx, args);
    },
  },
  "test-email-connection": {
    description: "test the SendGrid connection",
    needsWritableDatabase: false,
    manualRun: {
      argsSchema: { type: "object", properties: {}, additionalProperties: false },
      effect: "read",
    },
    async run(ctx: WcVendorContext, _args: void) {
      try {
        const key = sendGridKey(ctx);
        sgMail.setApiKey(key);
        return {
          success: true,
          message: "SendGrid API key is configured",
          details: { provider: "sendgrid", apiKeyConfigured: true },
        };
      } catch (error: any) {
        return {
          success: false,
          error: error?.message || "Failed to configure SendGrid",
        };
      }
    },
  },
  "get-email-configuration": {
    description: "read SendGrid configuration",
    needsWritableDatabase: false,
    async run(ctx: WcVendorContext, _args: void): Promise<EmailConfiguration> {
      try {
        const key = sendGridKey(ctx);
        const from = configuredFrom(ctx);
        return {
          connected: true,
          provider: "sendgrid",
          apiKeyConfigured: true,
          apiKeyMasked: `${key.substring(0, 8)}...${key.substring(key.length - 4)}`,
          defaultFromEmail: from?.email,
          defaultFromName: from?.name,
        };
      } catch (error: any) {
        return {
          connected: false,
          provider: "sendgrid",
          error: error?.message || "SendGrid not configured",
        };
      }
    },
  },
} satisfies Record<string, WcVendorOperationDeclaration<any, any>>;

const localOperations = {
  ...commonOperations,
  "test-email-connection": {
    description: "test the local email provider",
    needsWritableDatabase: false,
    manualRun: {
      argsSchema: { type: "object", properties: {}, additionalProperties: false },
      effect: "read",
    },
    async run(_ctx: WcVendorContext, _args: void) {
      return {
        success: true,
        message: "Local provider is always available (no external connection required)",
      };
    },
  },
  "get-email-configuration": {
    description: "read local email configuration",
    needsWritableDatabase: false,
    async run(ctx: WcVendorContext, _args: void): Promise<EmailConfiguration> {
      const from = configuredFrom(ctx);
      return {
        connected: true,
        provider: "local",
        capabilities: ["email-validation"],
        defaultFromEmail: from?.email,
        defaultFromName: from?.name,
      };
    },
  },
} satisfies Record<string, WcVendorOperationDeclaration<any, any>>;

const sendGridPlugin: WcVendorPlugin = {
  id: SENDGRID_EMAIL_PLUGIN_ID,
  name: "SendGrid Email",
  description: "Send email through SendGrid.",
  credential: {
    secretName: "required",
    setupGuidance:
      "Name the secret containing the SendGrid API key. The secret value is never stored in plugin configuration.",
    setupExample: "SENDGRID_API_KEY",
  },
  configFields: [
    {
      name: "defaultFromEmail",
      label: "Default From Email",
      type: "string",
      description: "Sender address used when a message does not provide one.",
    },
    {
      name: "defaultFromName",
      label: "Default From Name",
      type: "string",
    },
  ],
  validateConfig(data) {
    const email = typeof data.defaultFromEmail === "string"
      ? data.defaultFromEmail.trim()
      : "";
    if (email && !validateEmail(email).valid) {
      return { valid: false, errors: ["Default From Email must be a valid email address."] };
    }
    return { valid: true };
  },
  service: "SendGrid",
  operations: sendGridOperations,
};

const localPlugin: WcVendorPlugin = {
  id: LOCAL_EMAIL_PLUGIN_ID,
  name: "Local Email",
  description: "Validate email locally without an external delivery service.",
  credential: { secretName: "none" },
  configFields: [
    {
      name: "defaultFromEmail",
      label: "Default From Email",
      type: "string",
    },
    {
      name: "defaultFromName",
      label: "Default From Name",
      type: "string",
    },
  ],
  validateConfig(data) {
    const email = typeof data.defaultFromEmail === "string"
      ? data.defaultFromEmail.trim()
      : "";
    if (email && !validateEmail(email).valid) {
      return { valid: false, errors: ["Default From Email must be a valid email address."] };
    }
    return { valid: true };
  },
  operations: localOperations,
};

registerWcVendorPlugin(sendGridPlugin);
registerWcVendorPlugin(localPlugin);
// Keep rows created during the migration window addressable. New rows use the
// namespaced id above, but old rows may still carry the legacy provider id.
registerWcVendorPlugin({
  ...localPlugin,
  id: LEGACY_LOCAL_EMAIL_PLUGIN_ID,
});