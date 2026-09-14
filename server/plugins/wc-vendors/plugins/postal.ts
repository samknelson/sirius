import type {
  AddressVerificationResult,
  LetterSendResult,
  LetterTrackingEvent,
  PostalAddress,
  PostalTemplate,
  SendLetterParams,
} from "../../../services/comm/providers/postal";
import type {
  GatewayConnectionTest,
  WcVendorContext,
  WcVendorPlugin,
} from "../types";
import { registerWcVendorPlugin } from "../registry";
import { buildCanonicalAddress } from "../../../services/comm/providers/postal";
import type { WcAnswer } from "../../../services/webclient";
import type { PostalVendorTypesLoaded } from "../postal-types";
void (undefined as unknown as PostalVendorTypesLoaded);

type PostalConfigData = Record<string, unknown>;

function configData(ctx: WcVendorContext): PostalConfigData {
  return ctx.config.data && typeof ctx.config.data === "object"
    ? (ctx.config.data as PostalConfigData)
    : {};
}

function configuredReturnAddress(ctx: WcVendorContext): PostalAddress | undefined {
  const candidate = configData(ctx).defaultReturnAddress;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return undefined;
  return candidate as PostalAddress;
}

function authHeader(apiKey: string): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
    "Content-Type": "application/json",
  };
}

function isDeliverable(value: string | undefined): boolean {
  return value === "deliverable" ||
    value === "deliverable_unnecessary_unit" ||
    value === "deliverable_incorrect_unit" ||
    value === "deliverable_missing_unit";
}

function withoutRecipient(
  result: AddressVerificationResult,
): AddressVerificationResult {
  const stripped: AddressVerificationResult = { ...result };
  if (stripped.normalizedAddress) {
    const { name: _name, company: _company, ...rest } =
      stripped.normalizedAddress;
    stripped.normalizedAddress = rest as PostalAddress;
  }
  if (stripped.rawResponse && typeof stripped.rawResponse === "object") {
    const { recipient: _recipient, ...rest } =
      stripped.rawResponse as Record<string, unknown>;
    stripped.rawResponse = rest;
  }
  return stripped;
}

async function cachedLobVerify(
  ctx: WcVendorContext,
  address: PostalAddress,
): Promise<WcAnswer<AddressVerificationResult>> {
  const result = await lobVerify(ctx, address);
  if (result.rawResponse === undefined) {
    return {
      answered: false,
      value: result,
      error: result.error || "The provider answered without a Lob response",
    };
  }
  return {
    answered: true,
    value: withoutRecipient(result),
    store: result.valid,
  };
}

async function lobVerify(ctx: WcVendorContext, address: PostalAddress): Promise<AddressVerificationResult> {
  const key = ctx.credential.value;
  if (!key) return { valid: false, deliverable: false, error: "Lob credential is not configured" };

  const response = await fetch("https://api.lob.com/v1/us_verifications", {
    method: "POST",
    headers: authHeader(key),
    body: JSON.stringify({
      recipient: address.name,
      primary_line: address.addressLine1,
      secondary_line: address.addressLine2 || "",
      city: address.city,
      state: address.state,
      zip_code: address.zip,
    }),
  });
  const data = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok) {
    return {
      valid: false,
      deliverable: false,
      error: `Lob API error: ${response.status} - ${JSON.stringify(data)}`,
      rawResponse: data,
    };
  }

  const components = data.components || {};
  const analysis = data.deliverability_analysis || {};
  const hasComponents = components.city && components.state && components.zip_code;
  const normalizedAddress: PostalAddress = hasComponents
    ? {
        name: address.name,
        company: address.company,
        addressLine1: data.primary_line,
        addressLine2: data.secondary_line || undefined,
        city: components.city,
        state: components.state,
        zip: components.zip_code + (components.zip_code_plus_4 ? `-${components.zip_code_plus_4}` : ""),
        country: "US",
      }
    : { ...address };

  const testMode = key.startsWith("test_");
  const hasOriginalFields = Boolean(
    address.addressLine1 && address.city && address.state && address.zip,
  );
  const testModeValid = testMode && hasOriginalFields;

  return {
    valid: data.valid_address === true || testModeValid,
    deliverable: isDeliverable(data.deliverability) || testModeValid,
    canonicalAddress: buildCanonicalAddress(normalizedAddress),
    normalizedAddress,
    deliverabilityAnalysis: {
      dpvMatchCode: analysis.dpv_match_code,
      dpvFootnotes: analysis.dpv_footnotes,
      dpvCmra: analysis.dpv_cmra,
      dpvVacant: analysis.dpv_vacant,
      dpvActive: analysis.dpv_active,
      lacsLinkCode: analysis.lacs_link_code,
      lacsLinkIndicator: analysis.lacs_link_indicator,
      suiteReturnCode: analysis.suite_return_code,
      primaryNumber: components.primary_number,
      streetPredirection: components.street_predirection,
      streetName: components.street_name,
      streetSuffix: components.street_suffix,
      streetPostdirection: components.street_postdirection,
      secondaryDesignator: components.secondary_designator,
      secondaryNumber: components.secondary_number,
      pmbDesignator: components.pmb_designator,
      pmbNumber: components.pmb_number,
      extraSecondaryDesignator: components.extra_secondary_designator,
      extraSecondaryNumber: components.extra_secondary_number,
      city: components.city,
      state: components.state,
      zipCode: components.zip_code,
      zipCodePlus4: components.zip_code_plus_4,
      zipCodeType: components.zip_code_type,
      deliveryPointBarcode: components.delivery_point_barcode,
      addressType: components.address_type,
      recordType: components.record_type,
      defaultBuildingAddress: components.default_building_address,
      county: components.county,
      countyFips: components.county_fips,
      carrierRoute: components.carrier_route,
      carrierRouteType: components.carrier_route_type,
      latitude: components.latitude,
      longitude: components.longitude,
    },
    rawResponse: data,
  };
}

async function lobSend(ctx: WcVendorContext, params: SendLetterParams): Promise<LetterSendResult> {
  const key = ctx.credential.value;
  if (!key) return { success: false, error: "Lob credential is not configured" };
  const options = params.options;
  const letterData: Record<string, unknown> = {
    description: params.description || "Letter",
    to: {
      name: params.to.name,
      company: params.to.company,
      address_line1: params.to.addressLine1,
      address_line2: params.to.addressLine2,
      address_city: params.to.city,
      address_state: params.to.state,
      address_zip: params.to.zip,
      address_country: params.to.country || "US",
    },
    from: {
      name: params.from.name,
      company: params.from.company,
      address_line1: params.from.addressLine1,
      address_line2: params.from.addressLine2,
      address_city: params.from.city,
      address_state: params.from.state,
      address_zip: params.from.zip,
      address_country: params.from.country || "US",
    },
    color: options?.color || false,
    double_sided: options?.doubleSided || false,
    mail_type: options?.mailType || "usps_first_class",
    use_type: options?.useType || "operational",
  };
  if (options?.extraService) letterData.extra_service = options.extraService;
  if (options?.returnEnvelope !== undefined) letterData.return_envelope = options.returnEnvelope;
  if (options?.perforatedPage !== undefined) letterData.perforated_page = options.perforatedPage;
  if (options?.customEnvelope) letterData.custom_envelope = options.customEnvelope;
  if (params.templateId) {
    letterData.template_id = params.templateId;
    if (params.mergeVariables) letterData.merge_variables = params.mergeVariables;
  } else if (params.file) {
    letterData.file = params.file;
  }
  if (params.metadata) letterData.metadata = params.metadata;

  const response = await fetch("https://api.lob.com/v1/letters", {
    method: "POST",
    headers: authHeader(key),
    body: JSON.stringify(letterData),
  });
  const data = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok) {
    return {
      success: false,
      error: `Lob API error: ${response.status} - ${JSON.stringify(data)}`,
    };
  }
  return {
    success: true,
    letterId: data.id,
    status: "created",
    expectedDeliveryDate: data.expected_delivery_date ? new Date(data.expected_delivery_date) : undefined,
    trackingNumber: data.tracking_number || undefined,
    carrier: data.carrier,
    details: {
      url: data.url,
      dateCreated: data.date_created,
      sendDate: data.send_date,
      thumbnails: data.thumbnails,
    },
  };
}

async function lobStatus(ctx: WcVendorContext, letterId: string) {
  const key = ctx.credential.value;
  if (!key) throw new Error("Lob credential is not configured");
  const response = await fetch(`https://api.lob.com/v1/letters/${encodeURIComponent(letterId)}`, {
    headers: authHeader(key),
  });
  const data = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok) throw new Error(`Lob API error: ${response.status} - ${JSON.stringify(data)}`);
  const trackingEvents: LetterTrackingEvent[] = (data.tracking_events || []).map((event: any) => ({
    id: event.id,
    type: event.type,
    name: event.name,
    time: new Date(event.time),
    location: event.location,
    details: JSON.stringify(event.details),
  }));
  return {
    status: data.deleted ? "cancelled" : trackingEvents.length
      ? trackingEvents[trackingEvents.length - 1].type
      : "processing",
    trackingEvents,
  };
}

async function lobTest(ctx: WcVendorContext): Promise<GatewayConnectionTest> {
  const key = ctx.credential.value;
  if (!key) return { connected: false, error: { message: "Lob credential is not configured" } };
  try {
    const response = await fetch("https://api.lob.com/v1/us_verifications", {
      method: "POST",
      headers: authHeader(key),
      body: JSON.stringify({ primary_line: "deliverable", zip_code: "11111" }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      return {
        connected: false,
        testMode: key.startsWith("test_"),
        error: { message: `Lob API returned ${response.status}: ${JSON.stringify(error)}` },
      };
    }
    return {
      connected: true,
      testMode: key.startsWith("test_"),
      account: { id: "lob", type: "postal" },
    };
  } catch (error) {
    return {
      connected: false,
      error: { message: error instanceof Error ? error.message : "Failed to connect to Lob" },
    };
  }
}

export const LOB_POSTAL_PLUGIN_ID = "lob";
export const LOCAL_POSTAL_PLUGIN_ID = "local-postal";

const lobWcVendorPlugin: WcVendorPlugin = {
  id: LOB_POSTAL_PLUGIN_ID,
  name: "Lob",
  description: "Lob postal mail and address verification.",
  credential: {
    secretName: "required",
    setupGuidance: "The named secret must contain a Lob API key (test_... or live_...).",
  },
  service: "Lob",
  operations: {
    "test-connection": {
      description: "test connection",
      needsWritableDatabase: false,
      manualRun: {
        argsSchema: { type: "object", properties: {}, additionalProperties: false },
        effect: "read",
      },
      run: (ctx) => lobTest(ctx),
    },
    "verify-address": {
      description: "verify a postal address",
      needsWritableDatabase: true,
      cache: {
        mode: "cached",
        freshFor: 180 * 24 * 60 * 60 * 1000,
        failureRememberedFor: 5 * 60 * 1000,
        requestKey: (address) => buildCanonicalAddress(address),
      },
      run: cachedLobVerify,
    },
    "send-letter": {
      description: "send a postal letter",
      needsWritableDatabase: true,
      run: (ctx, params) => lobSend(ctx, params),
    },
    "letter-status": {
      description: "poll letter status",
      needsWritableDatabase: false,
      manualRun: {
        argsSchema: {
          type: "object",
          properties: {
            letterId: {
              type: "string",
              title: "Letter ID",
              minLength: 1,
              pattern: "\\S",
            },
          },
          required: ["letterId"],
          additionalProperties: false,
        },
        effect: "read",
      },
      run: (ctx, { letterId }) => lobStatus(ctx, letterId),
    },
    "cancel-letter": {
      description: "cancel a postal letter",
      needsWritableDatabase: true,
      run: async (ctx, { letterId }) => {
        const key = ctx.credential.value;
        if (!key) return { success: false, error: "Lob credential is not configured" };
        const response = await fetch(`https://api.lob.com/v1/letters/${encodeURIComponent(letterId)}`, {
          method: "DELETE",
          headers: authHeader(key),
        });
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          return { success: false, error: `Lob API error: ${response.status} - ${JSON.stringify(error)}` };
        }
        return { success: true };
      },
    },
    "list-templates": {
      description: "list postal templates",
      needsWritableDatabase: false,
      run: async (ctx) => {
        const key = ctx.credential.value;
        if (!key) return [];
        const response = await fetch("https://api.lob.com/v1/templates?limit=100", {
          headers: authHeader(key),
        });
        const data = await response.json().catch(() => ({})) as Record<string, any>;
        if (!response.ok) throw new Error(`Lob API error: ${response.status} - ${JSON.stringify(data)}`);
        return (data.data || []).map((template: any) => ({
          id: template.id,
          description: template.description || "Untitled Template",
          dateCreated: new Date(template.date_created),
          dateModified: new Date(template.date_modified),
          metadata: template.metadata,
        }));
      },
    },
    "get-default-return-address": {
      description: "read the default postal return address",
      needsWritableDatabase: false,
      run: async (ctx) => configuredReturnAddress(ctx),
    },
  },
};

function localVerify(address: PostalAddress): AddressVerificationResult {
  if (!address.addressLine1 || !address.city || !address.state || !address.zip || !address.country) {
    return { valid: false, deliverable: false, error: "Missing required address fields" };
  }
  if (!/^\d{5}(-\d{4})?$/.test(address.zip)) {
    return { valid: false, deliverable: false, error: "Invalid ZIP code format (expected 5 digits or 5+4)" };
  }
  if (!/^[A-Z]{2}$/i.test(address.state)) {
    return { valid: false, deliverable: false, error: "Invalid state format (expected 2-letter state code)" };
  }
  const normalizedAddress: PostalAddress = {
    ...address,
    addressLine1: address.addressLine1.trim().toUpperCase(),
    addressLine2: address.addressLine2?.trim().toUpperCase(),
    city: address.city.trim().toUpperCase(),
    state: address.state.trim().toUpperCase(),
    zip: address.zip.trim(),
    country: address.country.trim().toUpperCase(),
  };
  return {
    valid: true,
    deliverable: true,
    canonicalAddress: buildCanonicalAddress(normalizedAddress),
    normalizedAddress,
    deliverabilityAnalysis: {
      dpvMatchCode: "Y",
      city: normalizedAddress.city,
      state: normalizedAddress.state,
      zipCode: normalizedAddress.zip.substring(0, 5),
      zipCodePlus4: normalizedAddress.zip.length > 5 ? normalizedAddress.zip.substring(6) : undefined,
      addressType: "residential",
    },
  };
}

const localWcVendorPlugin: WcVendorPlugin = {
  id: LOCAL_POSTAL_PLUGIN_ID,
  name: "Local Postal (Testing Only)",
  description: "In-process postal provider for testing; no mail is sent.",
  credential: { secretName: "none" },
  singleton: true,
  operations: {
    "test-connection": {
      description: "test connection",
      needsWritableDatabase: false,
      manualRun: {
        argsSchema: { type: "object", properties: {}, additionalProperties: false },
        effect: "read",
      },
      run: async () => ({
        connected: true,
        testMode: true,
        account: { id: "local-postal", type: "test" },
      }),
    },
    "verify-address": {
      description: "verify a postal address",
      needsWritableDatabase: false,
      run: async (_ctx, address) => localVerify(address),
    },
    "list-templates": {
      description: "list postal templates",
      needsWritableDatabase: false,
      run: async () => [],
    },
    "get-default-return-address": {
      description: "read the default postal return address",
      needsWritableDatabase: false,
      run: async (ctx) => configuredReturnAddress(ctx),
    },
  },
};

registerWcVendorPlugin(lobWcVendorPlugin);
registerWcVendorPlugin(localWcVendorPlugin);
