import { wcRequest } from "./webclient";
import {
  BTU_CARDCHECK_PLUGIN_ID,
  closeBtuCardcheckSession,
  type BtuScrapeCardcheckResult,
  type BtuScrapeLoginResult,
} from "../plugins/wc-vendors/plugins/btu-cardcheck";

function requireValue<T>(
  result: { value?: T; error?: string; cause?: unknown },
  action: string,
): T {
  if (result.value !== undefined) return result.value;
  if (result.cause instanceof Error) throw result.cause;
  throw new Error(result.error || `BTU could not ${action}.`);
}

export async function startBtuCardcheckScrape(): Promise<string> {
  const result = await wcRequest({
    vendor: { pluginId: BTU_CARDCHECK_PLUGIN_ID },
    operation: "login",
    args: undefined,
  });
  return requireValue<BtuScrapeLoginResult>(result, "start the scrape").sessionId;
}

export async function fetchBtuCardcheckPdf(
  sessionId: string,
  nid: string,
): Promise<Buffer> {
  const result = await wcRequest({
    vendor: { pluginId: BTU_CARDCHECK_PLUGIN_ID },
    operation: "fetch-cardcheck",
    args: { sessionId, nid },
  });
  const value = requireValue<BtuScrapeCardcheckResult>(
    result,
    `fetch the card check page for NID ${nid}`,
  );
  return Buffer.from(value.pdfBase64, "base64");
}

export async function closeBtuCardcheckScrape(sessionId: string): Promise<void> {
  await closeBtuCardcheckSession(sessionId);
}