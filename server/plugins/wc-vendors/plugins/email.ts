import sgMail from "@sendgrid/mail";
import type {
  WcVendorContext,
  WcVendorOperationDeclaration,
  WcVendorPlugin,
} from "../types";
import { registerWcVendorPlugin } from "../registry";

export const SENDGRID_EMAIL_PLUGIN_ID = "sendgrid";
export const LOCAL_EMAIL_PLUGIN_ID = "local-email";
/** The pre-wc-vendor service registry used this provider id. */
export const LEGACY_LOCAL_EMAIL_PLUGIN_ID = "local";

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
  const key = ctx.credential.value.trim();
  if (!key) {
    throw new Error("SendGrid credential secret is not configured");
  }
  if (!key.startsWith("SG.")) {
    throw new Error("SendGrid credential is malformed");
  }
  return key;
}

async function testSendGridConnection(ctx: WcVendorContext) {
  let key: string;
  try {
    key = sendGridKey(ctx);
  } catch (error) {
    return {
      status: "misconfigured" as const,
      error: {
        message:
          error instanceof Error
            ? error.message
            : "SendGrid credential is not configured.",
      },
    };
  }
  try {
    const response = await fetch("https://api.sendgrid.com/v3/user/profile", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (response.ok) return { status: "connected" as const };
    if (response.status === 401 || response.status === 403) {
      return {
        status: "misconfigured" as const,
        error: { message: `SendGrid rejected the credential (HTTP ${response.status}).` },
      };
    }
    return {
      status: "unreachable" as const,
      error: { message: `SendGrid profile probe returned HTTP ${response.status}.` },
    };
  } catch (error) {
    return {
      status: "unreachable" as const,
      error: {
        message: error instanceof Error
          ? error.message
          : "SendGrid profile probe failed.",
      },
    };
  }
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
  "communications.email.send": { args: EmailSendArgs; result: EmailSendResult };
  "communications.email.validate": { args: { email: string }; result: EmailValidationResult };
  "communications.email.configuration.read": { args: void; result: EmailConfiguration };
  "communications.email.sender.default": { args: void; result: EmailRecipient | undefined };
};

declare module "../types" {
  interface WcVendorOperations extends EmailOperationContract {}
}

const commonOperations = {
  "communications.email.validate": {
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
  "communications.email.sender.default": {
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
  "communications.email.send": {
    description: "send an email",
    needsWritableDatabase: true,
    async run(ctx: WcVendorContext, args: EmailSendArgs): Promise<EmailSendResult> {
      return sendGridEmail(ctx, args);
    },
  },
  "service.test-connection": {
    description: "test the SendGrid connection",
    needsWritableDatabase: false,
    manualRun: {
      argsSchema: { type: "object", properties: {}, additionalProperties: false },
      effect: "read",
    },
    async run(ctx: WcVendorContext, _args: void) {
      return testSendGridConnection(ctx);
    },
  },
  "communications.email.configuration.read": {
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
  "service.test-connection": {
    description: "test the local email provider",
    needsWritableDatabase: false,
    manualRun: {
      argsSchema: { type: "object", properties: {}, additionalProperties: false },
      effect: "read",
    },
    async run(_ctx: WcVendorContext, _args: void) {
      return {
        status: "connected" as const,
      };
    },
  },
  "communications.email.configuration.read": {
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