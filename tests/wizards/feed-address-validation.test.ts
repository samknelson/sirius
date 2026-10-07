import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FeedWizard, type FeedField } from '../../server/plugins/wizards/engine/feed';
import { BaoMonthlyHoursWizard } from '../../server/plugins/wizards/engine/types/bao_monthly_hours';
import { GbhetLegalWorkersMonthlyWizard } from '../../server/plugins/wizards/engine/types/gbhet_legal_workers_monthly';
import { buildGbhetValidateStep } from '../../server/plugins/wizards/plugins/gbhet-legal-workers';
import { storage } from '../../server/storage/index';

const requiredAddresses = [
  ['addressLine1', 'Address 1', '123 Main St'],
  ['city', 'City', 'Boston'],
  ['state', 'State', 'MA'],
  ['postalCode', 'Postal Code', '02108'],
] as const;
const blanks = [
  ['spaces', '   '],
  ['tabs', '\t\t'],
  ['newlines', '\r\n\n'],
  ['nonbreaking spaces', '\u00a0\u00a0'],
  ['mixed whitespace', ' \t\r\n\u00a0 '],
  ['null', null],
  ['missing', undefined],
  ['empty string', ''],
] as const;
const modes = ['create', 'update'] as const;

function validRow(): Record<string, unknown> {
  return {
    ssn: '123-45-6789',
    firstName: 'Test',
    lastName: 'Worker',
    dateOfBirth: '1990-01-02',
    phoneNumber: '6175550100',
    employmentStatus: 'Active',
    numberOfHours: 160,
    ...Object.fromEntries(requiredAddresses.map(([id, , value]) => [id, value])),
  };
}

// Keep status resolution deterministic; these tests never need database data.
class BaoHarness extends BaoMonthlyHoursWizard {
  protected async getEmploymentStatusOptions() {
    return [{ id: 'active', name: 'Active', code: 'active', employed: true }];
  }
}

class OptionalAddressHarness extends GbhetLegalWorkersMonthlyWizard {
  protected async getEmploymentStatusOptions() {
    return [{ id: 'active', name: 'Active', code: 'active', employed: true }];
  }
}

beforeEach(() => {
  // Update mode requires an existing worker; isolate that lookup from the DB.
  vi.spyOn(storage.workers, 'getWorkerBySSN').mockResolvedValue({ id: 'worker' } as any);
  vi.spyOn(storage.workers, 'getWorkersBySSNs').mockImplementation(async ssns =>
    new Map(ssns.map(ssn => [ssn.replace(/\D/g, ''), { id: 'worker' } as any])));
});
afterEach(() => vi.restoreAllMocks());

describe.each(modes)('upload address validation in %s mode', (mode) => {
  describe.each(requiredAddresses)('%s', (field, name, realValue) => {
    it.each(blanks)('rejects %s with the existing required error', async (_label, value) => {
      const row = validRow();
      if (value === undefined) delete row[field];
      else row[field] = value;
      const errors = await new BaoHarness().validateRow(row, 7, mode);
      expect(errors).toEqual([{ rowIndex: 7, field, message: `${name} is required`, value }]);
      expect(row[field]).toBe(value);
      if (value === undefined) expect(row).not.toHaveProperty(field);
    });

    it('accepts surrounding whitespace without changing the address input', async () => {
      const row = validRow();
      const padded = ` \t\n\u00a0${realValue}\u00a0\r\n `;
      row[field] = padded;
      expect(await new BaoHarness().validateRow(row, 0, mode)).toEqual([]);
      expect(row[field]).toBe(padded);
    });
  });

  it.each(blanks)('keeps Address 2 optional for %s', async (_label, value) => {
    const row = { ...validRow(), addressLine2: value };
    expect(await new BaoHarness().validateRow(row, 0, mode)).toEqual([]);
    expect(row.addressLine2).toBe(value);
  });

  it.each(blanks)('keeps all legal-worker address fields optional for %s', async (_label, value) => {
    const row = validRow();
    for (const field of [...requiredAddresses.map(([id]) => id), 'addressLine2']) {
      if (value === undefined) delete row[field];
      else row[field] = value;
    }
    expect(await new OptionalAddressHarness().validateRow(row, 0, mode)).toEqual([]);
  });

  it('records whitespace as ordinary invalid rows and blocks normal progression', async () => {
    const wizard = new BaoHarness();
    const mappedRows = requiredAddresses.map(([field]) => ({ ...validRow(), [field]: ' \t\n\u00a0' }));
    mappedRows.push(validRow());
    vi.spyOn(wizard, 'loadMappedRows').mockResolvedValue({ mappedRows, mode } as any);
    vi.spyOn(storage.wizards, 'getById').mockResolvedValue({ entityId: 'employer' } as any);
    const persist = vi.spyOn(storage.wizards, 'mergeData').mockResolvedValue({ id: 'address-test' } as any);
    const results = await wizard.validateFeedData('address-test');
    expect(results).toMatchObject({ totalRows: 5, validRows: 1, invalidRows: 4 });
    expect(results.errors).toEqual(requiredAddresses.map(([field, name], rowIndex) => ({
      rowIndex, field, message: `${name} is required`, value: ' \t\n\u00a0',
    })));
    expect(results.errorSummary).toEqual(Object.fromEntries(
      requiredAddresses.map(([field, name]) => [`${field}: ${name} is required`, 1]),
    ));
    expect(persist).toHaveBeenCalledWith('address-test', { validationResults: results });
    const step = buildGbhetValidateStep(wizard);
    expect(step.getState!({ currentStep: 'validate', data: { validationResults: results } } as any))
      .toBe('in_progress');
    expect(step.getState!({ currentStep: 'validate', data: {
      validationResults: { ...results, invalidRows: 0, errors: [] },
    } } as any)).toBe('completed');
  });
});

class NonAddressHarness extends FeedWizard {
  name = 'non-address';
  displayName = 'Non-address';
  description = 'Protects unrelated field behavior';
  getFields(): FeedField[] {
    return [{ id: 'firstName', name: 'First Name', type: 'string', required: true }];
  }
}

it('does not change whitespace handling for required non-address fields', async () => {
  expect(await new NonAddressHarness().validateRow({ firstName: ' \t\n\u00a0' }, 0, 'create'))
    .toEqual([]);
});