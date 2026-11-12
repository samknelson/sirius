import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostalAddress, SendLetterParams } from '../../server/services/comm/providers/postal';

import "../../server/plugins/wc-vendors/plugins/postal";
import { getWcVendorHandler } from "../../server/plugins/wc-vendors/registry";
import type { LetterSendResult } from "../../server/services/comm/providers/postal";
import type { WcVendorContext } from "../../server/plugins/wc-vendors/types";
import { wcRequest } from "../../server/services/webclient";
import { storage } from "../../server/storage";
import { wcCacheStorage } from "../../server/storage/wc-cache";
import { MaintenanceModeError, setMaintenanceActive } from "../../server/services/maintenance-flag";

const context = {
  credential: { secretName: "LOB_TEST_SECRET", value: "test_key" },
  config: { id: "lob-config", pluginKind: "wc-vendors", pluginId: "lob", enabled: true, ordering: 0, data: {} },
} as WcVendorContext;
const provider = {
  sendLetter: (args: SendLetterParams) =>
    getWcVendorHandler("lob", "communications.postal.send")!(context, args as never) as Promise<LetterSendResult>,
};

afterEach(() => {
  setMaintenanceActive(false);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Lob WC delivery safeguards", () => {
  it("refuses delivery in maintenance before resolving a connection or contacting Lob", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    setMaintenanceActive(true);
    await expect(wcRequest({
      vendor: { pluginId: "lob" },
      operation: "communications.postal.send",
      args: params({ pdfFile: Buffer.from("%PDF-fixture") }),
    })).rejects.toBeInstanceOf(MaintenanceModeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not print a letter when the database cannot record the result", async () => {
    vi.stubEnv("LOB_TEST_SECRET", "test_key");
    vi.spyOn(storage.pluginConfigs, "get").mockResolvedValue({
      ...context.config, data: { secretName: "LOB_TEST_SECRET" },
    });
    vi.spyOn(wcCacheStorage, "canStore").mockResolvedValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await wcRequest({
      vendor: { configId: "lob-config" },
      operation: "communications.postal.send",
      args: params({ pdfFile: Buffer.from("%PDF-fixture") }),
    });
    expect(result.outcome).not.toBe("success");
    expect(result.error).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

const ADDRESS: PostalAddress = {
  name: 'Test Person',
  addressLine1: '1 Main St',
  city: 'Boston',
  state: 'MA',
  zip: '02108',
  country: 'US',
};

function params(
  content: Pick<SendLetterParams, 'file' | 'pdfFile' | 'templateId'>,
): SendLetterParams {
  return {
    to: ADDRESS,
    from: ADDRESS,
    ...content,
  };
}

function lobResponse() {
  return {
    ok: true,
    json: async () => ({
      id: 'ltr_test',
      carrier: 'USPS',
      tracking_number: null,
      expected_delivery_date: null,
      url: 'https://example.test/letter',
      thumbnails: [],
    }),
  } as Response;
}

describe('LobPostalProvider letter content', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    fetchMock = vi.fn(async () => lobResponse());
    vi.stubGlobal('fetch', fetchMock);
  });

  it('uploads PDF bytes as native multipart with Lob field names', async () => {
    const pdf = Buffer.from('%PDF-1.7\npdf bytes');

    const result = await provider.sendLetter({
      ...params({ pdfFile: pdf }),
      metadata: { communicationId: 'comm_123' },
      mergeVariables: { firstName: 'Ada' },
      options: {
        color: true,
        doubleSided: true,
        returnEnvelope: false,
        perforatedPage: 2,
        mailType: 'usps_first_class',
        useType: 'operational',
      },
    });

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.headers).toEqual({
      Authorization: `Basic ${Buffer.from('test_key:').toString('base64')}`,
    });

    const form = init.body as FormData;
    expect(form.get('to[address_line1]')).toBe('1 Main St');
    expect(form.get('from[address_city]')).toBe('Boston');
    expect(form.get('metadata[communicationId]')).toBe('comm_123');
    expect(form.get('merge_variables[firstName]')).toBe('Ada');
    expect(form.get('color')).toBe('true');
    expect(form.get('double_sided')).toBe('true');
    expect(form.get('return_envelope')).toBe('false');
    expect(form.get('perforated_page')).toBe('2');

    const uploaded = form.get('file');
    expect(uploaded).toBeInstanceOf(Blob);
    expect((uploaded as Blob).type).toBe('application/pdf');
    expect(Buffer.from(await (uploaded as Blob).arrayBuffer())).toEqual(pdf);
  });

  it.each([
    ['empty content', Buffer.alloc(0)],
    ['non-PDF content', Buffer.from('<html>not a pdf</html>')],
  ])('refuses %s before making a network request', async (_label, pdfFile) => {
    const result = await provider.sendLetter(params({ pdfFile }));

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/pdfFile/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['HTML', '<html>letter</html>'],
    ['shell markup', '#!/bin/sh\nrm -rf /'],
    ['remote URL', 'https://example.test/letter.pdf'],
    ['empty string', ''],
  ])('refuses string file input (%s)', async (_label, file) => {
    const result = await provider.sendLetter(params({ file }));

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/does not accept string file content/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps template requests on the existing JSON path', async () => {
    const result = await provider.sendLetter({
      ...params({ templateId: 'tmpl_123' }),
      mergeVariables: { firstName: 'Ada' },
      metadata: { communicationId: 'comm_123' },
    });

    expect(result.success).toBe(true);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.headers).toEqual({
      Authorization: `Basic ${Buffer.from('test_key:').toString('base64')}`,
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init.body as string)).toMatchObject({
      file: 'tmpl_123',
      merge_variables: { firstName: 'Ada' },
      metadata: { communicationId: 'comm_123' },
    });
  });

  it('requires exactly one supported content source', async () => {
    const missing = await provider.sendLetter(params({}));
    const conflicting = await provider.sendLetter(params({
      pdfFile: Buffer.from('%PDF-1.7\npdf bytes'),
      templateId: 'tmpl_123',
    }));

    expect(missing.error).toMatch(/Exactly one/);
    expect(conflicting.error).toMatch(/Exactly one/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});