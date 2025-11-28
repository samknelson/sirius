import { getTwilioClient, getTwilioFromPhoneNumber } from '../lib/twilio-client';
import { storage } from '../storage';

const TWILIO_CONFIG_VARIABLE = "twilio_config";

interface TwilioConfig {
  defaultPhoneNumber?: string;
}

export async function getTwilioConfig(): Promise<TwilioConfig> {
  const configVar = await storage.variables.getByName(TWILIO_CONFIG_VARIABLE);
  if (configVar && configVar.value) {
    return configVar.value as TwilioConfig;
  }
  return {};
}

export async function setTwilioConfig(config: TwilioConfig): Promise<void> {
  const existingVar = await storage.variables.getByName(TWILIO_CONFIG_VARIABLE);
  if (existingVar) {
    await storage.variables.update(existingVar.id, { value: config });
  } else {
    await storage.variables.create({
      name: TWILIO_CONFIG_VARIABLE,
      value: config,
    });
  }
}

export async function getDefaultTwilioPhoneNumber(): Promise<string> {
  const config = await getTwilioConfig();
  if (config.defaultPhoneNumber) {
    return config.defaultPhoneNumber;
  }
  return getTwilioFromPhoneNumber();
}

export interface TwilioAccountInfo {
  connected: boolean;
  accountSid?: string;
  accountName?: string;
  configuredPhoneNumber?: string;
  defaultPhoneNumber?: string;
  error?: string;
}

export interface TwilioPhoneNumber {
  sid: string;
  phoneNumber: string;
  friendlyName: string;
  capabilities: {
    sms: boolean;
    voice: boolean;
    mms: boolean;
  };
}

export interface TestConnectionResult {
  success: boolean;
  accountSid?: string;
  accountName?: string;
  status?: string;
  error?: string;
}

export async function getTwilioAccountInfo(): Promise<TwilioAccountInfo> {
  const config = await getTwilioConfig();
  let configuredPhoneNumber: string | undefined;
  
  try {
    configuredPhoneNumber = await getTwilioFromPhoneNumber();
  } catch {
    // Phone number not configured
  }

  try {
    const client = await getTwilioClient();
    const accounts = await client.api.accounts.list({ limit: 1 });
    const account = accounts[0];
    
    if (!account) {
      return {
        connected: false,
        configuredPhoneNumber,
        defaultPhoneNumber: config.defaultPhoneNumber,
        error: 'No Twilio account found',
      };
    }
    
    return {
      connected: true,
      accountSid: account.sid ? `${account.sid.substring(0, 8)}...${account.sid.substring(account.sid.length - 4)}` : undefined,
      accountName: account.friendlyName,
      configuredPhoneNumber,
      defaultPhoneNumber: config.defaultPhoneNumber || configuredPhoneNumber,
    };
  } catch (error: any) {
    return {
      connected: false,
      configuredPhoneNumber,
      defaultPhoneNumber: config.defaultPhoneNumber,
      error: error?.message || 'Failed to connect to Twilio',
    };
  }
}

export async function testTwilioConnection(): Promise<TestConnectionResult> {
  try {
    const client = await getTwilioClient();
    const accounts = await client.api.accounts.list({ limit: 1 });
    const account = accounts[0];
    
    if (!account) {
      return {
        success: false,
        error: 'No Twilio account found',
      };
    }
    
    return {
      success: true,
      accountSid: account.sid ? `${account.sid.substring(0, 8)}...${account.sid.substring(account.sid.length - 4)}` : undefined,
      accountName: account.friendlyName,
      status: account.status,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'Failed to connect to Twilio',
    };
  }
}

export async function listTwilioPhoneNumbers(): Promise<TwilioPhoneNumber[]> {
  const client = await getTwilioClient();
  const incomingPhoneNumbers = await client.incomingPhoneNumbers.list({ limit: 50 });
  
  return incomingPhoneNumbers.map((num) => ({
    sid: num.sid,
    phoneNumber: num.phoneNumber,
    friendlyName: num.friendlyName,
    capabilities: {
      sms: num.capabilities?.sms || false,
      voice: num.capabilities?.voice || false,
      mms: num.capabilities?.mms || false,
    },
  }));
}

export async function setDefaultPhoneNumber(phoneNumber: string): Promise<void> {
  const config = await getTwilioConfig();
  config.defaultPhoneNumber = phoneNumber;
  await setTwilioConfig(config);
}
