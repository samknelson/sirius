import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostalAddress, SendLetterParams } from '../../server/services/comm/providers/postal';

vi.mock('../../server/services/webclient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/services/webclient')>();
  return {
    ...actual,
    registerUncachedWcRequest: vi.fn(),
    wcUncachedRequest: vi.fn(async (options: {
      fetch: () => Promise<{ answered: boolean; value?: unknown; error?: string }>;
    }) => {
      const answer = await options.fetch();
      return answer.answered
        ? { value: answer.value }
        : { error: answer.error };
    }),
  };
});

import { LobPostalProvider } from '../../server/services/comm/providers/postal/lob';

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
  let provider: LobPostalProvider;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    provider = new LobPostalProvider();
    await provider.configure({ apiKey: 'test_key' });
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