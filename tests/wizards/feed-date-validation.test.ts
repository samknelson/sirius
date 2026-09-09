import { describe, expect, it } from 'vitest';

import { FeedWizard } from '../../server/plugins/wizards/engine/feed';
import { GbhetLegalWorkersMonthlyWizard } from '../../server/plugins/wizards/engine/types/gbhet_legal_workers_monthly';
import { HtaUnionImportWizard } from '../../server/plugins/wizards/engine/types/hta_union_import';
import { BtuCardcheckImportWizard } from '../../server/plugins/wizards/engine/types/btu_cardcheck_import';
import { BtuDuesAllocationWizard } from '../../server/plugins/wizards/engine/types/btu_dues_allocation';

class SharedDateParserHarness extends FeedWizard {
  name = 'shared-date-parser-harness';
  displayName = 'Shared date parser harness';
  description = 'Exercises shared non-BAO date behavior';

  parse(value: unknown): string | null {
    return this.parseDate(value);
  }
}

describe('shared feed date validation', () => {
  const parser = new SharedDateParserHarness();

  it.each([
    ['2/30/2024'],
    ['02-29-2023'],
    ['2023/13/01'],
    ['2023-02-29'],
  ])('rejects impossible four-digit calendar date %s', (value) => {
    expect(() => parser.parse(value)).toThrow(`Invalid calendar date: ${value}`);
  });

  it.each([
    ['2/29/2024', '2024-02-29'],
    ['02-28-2023', '2023-02-28'],
    ['2024/02/29', '2024-02-29'],
    ['2024-02-29', '2024-02-29'],
    [33202, '1990-11-24'],
  ])('continues to normalize supported value %s', (value, expected) => {
    expect(parser.parse(value)).toBe(expected);
  });

  it('keeps two-digit years unsupported outside BAO', () => {
    expect(() => parser.parse('11/24/90')).toThrow(/Invalid date format/);
  });

  it.each([
    ['legal-worker birth date', new GbhetLegalWorkersMonthlyWizard(), 'dateOfBirth'],
    ['HTA worker birth date', new HtaUnionImportWizard(), 'dateOfBirth'],
    ['HTA worker hire date', new HtaUnionImportWizard(), 'hireDate'],
  ])('rejects an impossible %s during row validation', async (_label, wizard, field) => {
    const errors = await wizard.validateRow({ [field]: '2/30/2024' }, 4, 'update');

    expect(errors).toContainEqual(expect.objectContaining({
      rowIndex: 4,
      field,
      message: 'Invalid calendar date: 2/30/2024',
    }));
  });

  it.each([
    [
      'BTU card-check short year',
      new BtuCardcheckImportWizard(),
      { bpsEmployeeId: '123', signatureDate: '2/29/24' },
      'signatureDate',
    ],
    [
      'BTU card-check timestamp suffix',
      new BtuCardcheckImportWizard(),
      { bpsEmployeeId: '123', signatureDate: '2/29/2024 10:30 AM' },
      'signatureDate',
    ],
    [
      'BTU card-check ISO timestamp',
      new BtuCardcheckImportWizard(),
      { bpsEmployeeId: '123', signatureDate: '2024-02-29T10:30:00Z' },
      'signatureDate',
    ],
    [
      'BTU dues short year',
      new BtuDuesAllocationWizard(),
      { bpsEmployeeId: '123', amount: 10, date: '2/29/24' },
      'date',
    ],
    [
      'BTU dues timestamp suffix',
      new BtuDuesAllocationWizard(),
      { bpsEmployeeId: '123', amount: 10, date: '2/29/2024 10:30 AM' },
      'date',
    ],
    [
      'BTU dues ISO timestamp',
      new BtuDuesAllocationWizard(),
      { bpsEmployeeId: '123', amount: 10, date: '2024-02-29T10:30:00Z' },
      'date',
    ],
    [
      'BTU dues extended Excel serial',
      new BtuDuesAllocationWizard(),
      { bpsEmployeeId: '123', amount: 10, date: 80000 },
      'date',
    ],
  ])('preserves established %s support', async (_label, wizard, row, field) => {
    const errors = await wizard.validateRow(row, 0, 'create');
    expect(errors.some((error) => error.field === field)).toBe(false);
  });

  it.each([
    [
      'BTU card-check',
      new BtuCardcheckImportWizard(),
      { bpsEmployeeId: '123', signatureDate: '2/30/2024 10:30 AM' },
      'signatureDate',
    ],
    [
      'BTU dues allocation',
      new BtuDuesAllocationWizard(),
      { bpsEmployeeId: '123', amount: 10, date: '2/30/24' },
      'date',
    ],
    [
      'BTU dues dash date',
      new BtuDuesAllocationWizard(),
      { bpsEmployeeId: '123', amount: 10, date: '2-30-2024' },
      'date',
    ],
    [
      'BTU dues timestamp date',
      new BtuDuesAllocationWizard(),
      { bpsEmployeeId: '123', amount: 10, date: '2/30/2024 10:30' },
      'date',
    ],
    [
      'BTU card-check fallback text',
      new BtuCardcheckImportWizard(),
      { bpsEmployeeId: '123', signatureDate: 'February 30, 2024' },
      'signatureDate',
    ],
    [
      'BTU dues malformed ISO timestamp',
      new BtuDuesAllocationWizard(),
      { bpsEmployeeId: '123', amount: 10, date: '2024-02-29Tgarbage' },
      'date',
    ],
    [
      'BTU dues impossible clock time',
      new BtuDuesAllocationWizard(),
      { bpsEmployeeId: '123', amount: 10, date: '2/29/2024 99:99' },
      'date',
    ],
    [
      'BTU card-check impossible clock time',
      new BtuCardcheckImportWizard(),
      { bpsEmployeeId: '123', signatureDate: '2/29/2024 24:00' },
      'signatureDate',
    ],
    [
      'BTU card-check impossible ISO hour',
      new BtuCardcheckImportWizard(),
      { bpsEmployeeId: '123', signatureDate: '2024-02-29T24:00:00Z' },
      'signatureDate',
    ],
    [
      'BTU card-check impossible ISO minute',
      new BtuCardcheckImportWizard(),
      { bpsEmployeeId: '123', signatureDate: '2024-02-29T23:60:00Z' },
      'signatureDate',
    ],
    [
      'BTU dues impossible ISO hour',
      new BtuDuesAllocationWizard(),
      { bpsEmployeeId: '123', amount: 10, date: '2024-02-29T24:00:00Z' },
      'date',
    ],
    [
      'BTU dues impossible ISO second',
      new BtuDuesAllocationWizard(),
      { bpsEmployeeId: '123', amount: 10, date: '2024-02-29T23:59:60Z' },
      'date',
    ],
  ])('rejects an impossible date in the %s feed', async (_label, wizard, row, field) => {
    const errors = await wizard.validateRow(row, 0, 'create');
    expect(errors.some((error) =>
      error.field === field && error.message.includes('Invalid calendar date'),
    )).toBe(true);
  });
});