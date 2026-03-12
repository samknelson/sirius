import { FeedWizard, FeedField, ValidationError, ProcessResults } from '../feed.js';
import { WizardStatus, WizardStep, LaunchArgument } from '../base.js';
import { storage } from '../../storage/index.js';
import { createUnifiedOptionsStorage } from '../../storage/unified-options.js';

const unifiedOptionsStorage = createUnifiedOptionsStorage();

function preprocessSSN(value: any): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const digitsOnly = String(value).replace(/\D/g, '');
  if (digitsOnly.length === 0) {
    return null;
  }
  if (digitsOnly.length > 9) {
    return null;
  }
  const paddedSSN = digitsOnly.padStart(9, '0');
  return `${paddedSSN.substring(0, 3)}-${paddedSSN.substring(3, 5)}-${paddedSSN.substring(5, 9)}`;
}

function normalizeForComparison(value: string): string {
  return String(value).toLowerCase().replace(/\s+/g, '');
}

function findMatchingWorkStatus(
  statusValue: string,
  options: Array<{ id: string; name: string }>
): { id: string; name: string } | undefined {
  const normalized = normalizeForComparison(statusValue);
  let match = options.find(ws => normalizeForComparison(ws.name) === normalized);
  if (match) return match;

  const lower = statusValue.toLowerCase().trim();
  match = options.find(ws => lower.startsWith(ws.name.toLowerCase()));
  if (match) return match;

  match = options.find(ws => lower.includes(ws.name.toLowerCase()));
  return match;
}

export class HtaUnionImportWizard extends FeedWizard {
  name = 'hta_union_import';
  displayName = 'HTA Union/Apprentice Import';
  description = 'Import worker data from a spreadsheet for HTA union or apprentice members';
  isFeed = true;
  requiredComponent = 'sitespecific.hta';

  private workStatusCache: Array<{ id: string; name: string }> | null = null;
  private employmentStatusCache: Array<{ id: string; name: string; code: string; employed: boolean }> | null = null;
  private employerCache: Map<string, string> | null = null;
  private memberStatusCache: Array<{ id: string; name: string; industryId: string }> | null = null;
  currentMemberStatusType: string | null = null;

  getFields(): FeedField[] {
    return [
      {
        id: 'ssn',
        name: 'SSN',
        type: 'string',
        required: true,
        description: 'Social Security Number',
        format: 'ssn',
        pattern: '^\\d{3}-\\d{2}-\\d{4}$',
        displayOrder: 1
      },
      {
        id: 'firstName',
        name: 'First Name',
        type: 'string',
        required: false,
        requiredForCreate: true,
        description: 'Worker first name',
        maxLength: 100,
        displayOrder: 2
      },
      {
        id: 'lastName',
        name: 'Last Name',
        type: 'string',
        required: false,
        requiredForCreate: true,
        description: 'Worker last name',
        maxLength: 100,
        displayOrder: 3
      },
      {
        id: 'preferredFirstName',
        name: 'Preferred First Name',
        type: 'string',
        required: false,
        description: 'Worker preferred first name (optional)',
        maxLength: 100,
        displayOrder: 4
      },
      {
        id: 'dateOfBirth',
        name: 'Date of Birth',
        type: 'date',
        required: false,
        description: 'Worker date of birth (optional)',
        format: 'date',
        displayOrder: 5
      },
      {
        id: 'gender',
        name: 'Gender',
        type: 'string',
        required: false,
        description: 'Worker gender (optional)',
        displayOrder: 6
      },
      {
        id: 'statusReason',
        name: 'Work Status',
        type: 'string',
        required: false,
        description: 'Work status (required for Union imports, ignored for Apprentice)',
        displayOrder: 7
      },
      {
        id: 'employerName',
        name: 'Employer',
        type: 'string',
        required: true,
        description: 'Employer name (must match an existing employer)',
        displayOrder: 8
      },
      {
        id: 'primarySecondary',
        name: 'Primary/Secondary',
        type: 'string',
        required: false,
        description: 'Employment type: Primary or Secondary (maps to home boolean)',
        displayOrder: 9
      },
      {
        id: 'hireDate',
        name: 'Hire Date',
        type: 'date',
        required: false,
        description: 'Hire date (optional)',
        format: 'date',
        displayOrder: 10
      },
      {
        id: 'phoneNumber',
        name: 'Phone',
        type: 'string',
        required: false,
        description: 'Worker phone number (optional)',
        displayOrder: 11
      },
      {
        id: 'email',
        name: 'Email',
        type: 'string',
        required: false,
        description: 'Worker email address (optional)',
        format: 'email',
        displayOrder: 12
      },
      {
        id: 'addressLine1',
        name: 'Home Address',
        type: 'string',
        required: false,
        description: 'Street address (optional)',
        displayOrder: 13
      },
      {
        id: 'city',
        name: 'City',
        type: 'string',
        required: false,
        description: 'City (optional)',
        displayOrder: 14
      },
      {
        id: 'state',
        name: 'State',
        type: 'string',
        required: false,
        description: 'State (optional)',
        displayOrder: 15
      },
      {
        id: 'postalCode',
        name: 'ZIP',
        type: 'string',
        required: false,
        description: 'ZIP code (optional)',
        displayOrder: 16
      }
    ];
  }

  getSteps(): WizardStep[] {
    return [
      { id: 'upload', name: 'Upload', description: 'Upload data file' },
      { id: 'map', name: 'Map', description: 'Map fields to schema' },
      { id: 'validate', name: 'Validate', description: 'Validate data integrity' },
      { id: 'process', name: 'Process', description: 'Process and transform data' },
      { id: 'review', name: 'Review', description: 'Review results' }
    ];
  }

  getStatuses(): WizardStatus[] {
    return [
      { id: 'draft', name: 'Draft', description: 'Initial draft state' },
      { id: 'complete', name: 'Complete', description: 'Import complete' }
    ];
  }

  getLaunchArguments(): LaunchArgument[] {
    return [
      {
        id: 'memberStatusType',
        name: 'Member Status Type',
        type: 'select',
        required: true,
        description: 'Select whether this import is for Union or Apprentice members',
        options: [
          { value: 'Union', label: 'Union' },
          { value: 'Apprentice', label: 'Apprentice' }
        ]
      }
    ];
  }

  async getRecordCount(filters?: Record<string, any>): Promise<number> {
    return 0;
  }

  private async getWorkStatusOptions(): Promise<Array<{ id: string; name: string }>> {
    if (!this.workStatusCache) {
      const statuses = await unifiedOptionsStorage.list("worker-ws");
      this.workStatusCache = statuses.map((s: any) => ({ id: s.id, name: s.name }));
    }
    return this.workStatusCache;
  }

  private async getEmploymentStatusOptions(): Promise<Array<{ id: string; name: string; code: string; employed: boolean }>> {
    if (!this.employmentStatusCache) {
      const statuses = await unifiedOptionsStorage.list("employment-status");
      this.employmentStatusCache = statuses.map((s: any) => ({ id: s.id, name: s.name, code: s.code, employed: s.employed }));
    }
    return this.employmentStatusCache;
  }

  private async getEmployerMap(): Promise<Map<string, string>> {
    if (!this.employerCache) {
      const allEmployers = await storage.employers.getAllEmployers();
      this.employerCache = new Map<string, string>();
      for (const emp of allEmployers) {
        this.employerCache.set(normalizeForComparison(emp.name), emp.id);
      }
    }
    return this.employerCache;
  }

  private async getMemberStatusOptions(): Promise<Array<{ id: string; name: string; industryId: string }>> {
    if (!this.memberStatusCache) {
      const statuses = await unifiedOptionsStorage.list("worker-ms");
      this.memberStatusCache = statuses.map((s: any) => ({ id: s.id, name: s.name, industryId: s.industryId }));
    }
    return this.memberStatusCache;
  }

  private getMemberStatusType(wizard: any): string {
    const wizardData = wizard.data as any || {};
    const launchArguments = wizardData.launchArguments || {};
    return launchArguments.memberStatusType || 'Union';
  }

  async validateFeedData(
    wizardId: string,
    batchSize?: number,
    onProgress?: (progress: { processed: number; total: number; validRows: number; invalidRows: number }) => void
  ) {
    this.workStatusCache = null;
    this.employmentStatusCache = null;
    this.employerCache = null;
    this.memberStatusCache = null;

    const wizard = await storage.wizards.getById(wizardId);
    if (wizard) {
      this.currentMemberStatusType = this.getMemberStatusType(wizard);
    }
    return super.validateFeedData(wizardId, batchSize, onProgress);
  }

  async validateRow(row: Record<string, any>, rowIndex: number, mode: 'create' | 'update'): Promise<ValidationError[]> {
    if (row.ssn !== undefined && row.ssn !== null) {
      const preprocessed = preprocessSSN(row.ssn);
      if (preprocessed !== null) {
        row.ssn = preprocessed;
      }
    }

    const errors = await super.validateRow(row, rowIndex, mode);

    if (row.employerName !== undefined && row.employerName !== null && row.employerName !== '') {
      const employerMap = await this.getEmployerMap();
      const normalizedName = normalizeForComparison(String(row.employerName));
      if (!employerMap.has(normalizedName)) {
        errors.push({
          rowIndex,
          field: 'employerName',
          message: 'Employer name does not match any existing employer',
          value: row.employerName
        });
      }
    }

    if (this.currentMemberStatusType === 'Union') {
      const statusReason = row.statusReason?.toString().trim();
      if (!statusReason) {
        errors.push({
          rowIndex,
          field: 'statusReason',
          message: 'Work Status is required for Union imports',
          value: row.statusReason
        });
      } else {
        const workStatusOptions = await this.getWorkStatusOptions();
        const matchingOption = findMatchingWorkStatus(statusReason, workStatusOptions);
        if (!matchingOption) {
          errors.push({
            rowIndex,
            field: 'statusReason',
            message: `Work Status "${statusReason}" does not match any configured work status option`,
            value: row.statusReason
          });
        }
      }
    }

    if (mode === 'update') {
      const ssn = row.ssn;
      if (ssn && !errors.some(e => e.field === 'ssn')) {
        const existingWorker = await storage.workers.getWorkerBySSN(ssn);
        if (!existingWorker) {
          errors.push({
            rowIndex,
            field: 'ssn',
            message: 'Worker with this SSN does not exist',
            value: ssn
          });
        }
      }
    }

    return errors;
  }

  private processedWorkStatusWorkers = new Set<string>();

  protected async processWorkerWorkStatus(workerId: string, row: Record<string, any>, wizard: any): Promise<void> {
    if (this.processedWorkStatusWorkers.has(workerId)) {
      return;
    }

    const memberStatusType = this.getMemberStatusType(wizard);
    const workStatusOptions = await this.getWorkStatusOptions();

    let targetStatusName: string;
    if (memberStatusType === 'Apprentice') {
      targetStatusName = 'Active';
    } else {
      const statusReason = row.statusReason?.toString().trim();
      if (!statusReason) {
        return;
      }
      targetStatusName = statusReason;
    }

    const matchingWsOption = findMatchingWorkStatus(targetStatusName, workStatusOptions);

    if (!matchingWsOption) {
      return;
    }

    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    await storage.workerWsh.createWorkerWsh({
      workerId,
      date: dateStr,
      wsId: matchingWsOption.id,
      data: { source: 'hta_union_import' }
    });

    this.processedWorkStatusWorkers.add(workerId);
  }

  protected async processWorkerHours(workerId: string, row: Record<string, any>, wizard: any): Promise<void> {
    const errors: string[] = [];

    try {
      const employerMap = await this.getEmployerMap();
      const employerNameRaw = row.employerName?.toString().trim();
      if (!employerNameRaw) {
        throw new Error('Employer name is required');
      }

      const normalizedName = normalizeForComparison(employerNameRaw);
      const employerId = employerMap.get(normalizedName);
      if (!employerId) {
        throw new Error(`Employer "${employerNameRaw}" not found`);
      }

      const memberStatusType = this.getMemberStatusType(wizard);
      let statusReason: string;
      if (memberStatusType === 'Apprentice') {
        statusReason = 'Active';
      } else {
        statusReason = row.statusReason?.toString().trim() || '';
        if (!statusReason) {
          throw new Error('Work Status is required for Union imports');
        }
      }

      const employmentStatusOptions = await this.getEmploymentStatusOptions();

      let matchingEsOption = employmentStatusOptions.find(option =>
        normalizeForComparison(option.name) === normalizeForComparison(statusReason)
      );
      if (!matchingEsOption) {
        matchingEsOption = employmentStatusOptions.find(option =>
          option.code && normalizeForComparison(option.code) === normalizeForComparison(statusReason)
        );
      }
      if (!matchingEsOption) {
        const lower = statusReason.toLowerCase().trim();
        matchingEsOption = employmentStatusOptions.find(option =>
          lower.includes(option.name.toLowerCase()) || option.name.toLowerCase().includes(lower)
        );
      }
      if (!matchingEsOption) {
        matchingEsOption = employmentStatusOptions.find(option => option.employed === true);
      }
      if (!matchingEsOption && employmentStatusOptions.length > 0) {
        matchingEsOption = employmentStatusOptions[0];
      }

      if (!matchingEsOption) {
        errors.push(`No employment status options configured`);
      } else {
        const today = new Date();
        const year = today.getFullYear();
        const month = today.getMonth() + 1;

        const primarySecondary = row.primarySecondary?.toString().trim().toLowerCase();
        const isHome = primarySecondary === 'primary' ? true : (primarySecondary === 'secondary' ? false : undefined);

        await storage.workerHours.upsertWorkerHours({
          workerId,
          employerId,
          employmentStatusId: matchingEsOption.id,
          year,
          month,
          hours: 0,
          home: isHome
        });
      }
    } catch (err: any) {
      errors.push(err.message || 'Employment record creation failed');
    }

    try {
      await this.processWorkerWorkStatus(workerId, row, wizard);
    } catch (err: any) {
      errors.push(`Work status: ${err.message}`);
    }

    try {
      await this.processWorkerMemberStatus(workerId, wizard);
    } catch (err: any) {
      errors.push(`Member status: ${err.message}`);
    }

    if (errors.length > 0) {
      throw new Error(errors.join('; '));
    }
  }

  protected async processWorkerContactInfo(workerId: string, row: Record<string, any>): Promise<void> {
    const worker = await storage.workers.getWorker(workerId);
    if (!worker) {
      throw new Error(`Worker not found: ${workerId}`);
    }

    const contactId = worker.contactId;

    const genderValue = row.gender?.toString().trim();
    if (genderValue) {
      const genderOptions = await unifiedOptionsStorage.list("gender");
      const normalizedInput = normalizeForComparison(genderValue);
      const matchingGender = genderOptions.find((option: { id: string; name: string; code: string }) => {
        if (normalizeForComparison(option.name) === normalizedInput) return true;
        if (option.code && normalizeForComparison(option.code) === normalizedInput) return true;
        return false;
      });
      if (matchingGender) {
        await storage.workers.updateWorkerContactGender(workerId, matchingGender.id, null);
      }
    }

    const email = row.email?.toString().trim();
    if (email) {
      await storage.workers.updateWorkerContactEmail(workerId, email);
    }

    const phoneNumber = row.phoneNumber?.toString().trim();
    if (phoneNumber) {
      const existingPhones = await storage.contacts.phoneNumbers.getPhoneNumbersByContact(contactId);
      if (existingPhones.length > 0) {
        const primaryPhone = existingPhones.find((p: any) => p.isPrimary) || existingPhones[0];
        await storage.contacts.phoneNumbers.updatePhoneNumber(primaryPhone.id, {
          phoneNumber: phoneNumber
        });
      } else {
        await storage.contacts.phoneNumbers.createPhoneNumber({
          contactId,
          phoneNumber: phoneNumber,
          isPrimary: true
        });
      }
    }

    const addressLine1 = row.addressLine1?.toString().trim();
    const city = row.city?.toString().trim();
    const state = row.state?.toString().trim();
    const postalCode = row.postalCode?.toString().trim();

    if (addressLine1 || city || state || postalCode) {
      const existingAddresses = await storage.contacts.addresses.getContactPostalByContact(contactId);
      if (existingAddresses.length > 0) {
        const primaryAddress = existingAddresses.find((a: { isPrimary: boolean }) => a.isPrimary) || existingAddresses[0];
        await storage.contacts.addresses.updateContactPostal(primaryAddress.id, {
          street: addressLine1,
          city,
          state,
          postalCode,
          country: 'US'
        });
      } else {
        await storage.contacts.addresses.createContactPostal({
          contactId,
          street: addressLine1,
          city,
          state,
          postalCode,
          country: 'US',
          isPrimary: true
        });
      }
    }
  }

  private processedMemberStatusWorkers = new Set<string>();

  protected async processWorkerMemberStatus(workerId: string, wizard: any): Promise<void> {
    if (this.processedMemberStatusWorkers.has(workerId)) {
      return;
    }

    const memberStatusType = this.getMemberStatusType(wizard);
    const memberStatusOptions = await this.getMemberStatusOptions();

    const normalizedType = normalizeForComparison(memberStatusType);
    const matchingMsOption = memberStatusOptions.find(ms =>
      normalizeForComparison(ms.name) === normalizedType
    );

    if (!matchingMsOption) {
      return;
    }

    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    try {
      await storage.workerMsh.createWorkerMsh({
        workerId,
        date: dateStr,
        msId: matchingMsOption.id,
        industryId: matchingMsOption.industryId,
        data: { source: 'hta_union_import' }
      });
    } catch (err: any) {
      if (err?.message?.includes('duplicate') || err?.code === '23505') {
        // ignore
      } else {
        throw err;
      }
    }

    this.processedMemberStatusWorkers.add(workerId);
  }

  async processFeedData(
    wizardId: string,
    batchSize: number = 100,
    onProgress?: (progress: {
      processed: number;
      total: number;
      createdCount: number;
      updatedCount: number;
      successCount: number;
      failureCount: number;
      currentRow?: { index: number; status: 'success' | 'error'; error?: string };
      phase?: string;
      phaseMessage?: string;
    }) => void
  ): Promise<ProcessResults> {
    this.workStatusCache = null;
    this.employmentStatusCache = null;
    this.employerCache = null;
    this.memberStatusCache = null;
    this.processedWorkStatusWorkers.clear();
    this.processedMemberStatusWorkers.clear();

    const results = await super.processFeedData(wizardId, batchSize, onProgress);

    const wizard = await storage.wizards.getById(wizardId);
    if (wizard) {
      const memberStatusType = this.getMemberStatusType(wizard);
      if (memberStatusType === 'Union') {
        try {
          if (onProgress) {
            onProgress({
              processed: results.totalRows,
              total: results.totalRows,
              createdCount: results.createdCount,
              updatedCount: results.updatedCount,
              successCount: results.successCount,
              failureCount: results.failureCount,
              phase: 'inactivity_scan',
              phaseMessage: 'Running inactivity scan...',
            });
          }

          const { runInactivityScan } = await import('../../services/hta-inactivity-scan.js');
          const scanResult = await runInactivityScan({ mode: 'live' });

          results.inactivityScan = {
            ran: true,
            scanned: scanResult.scanned,
            deactivated: scanResult.deactivated,
            alreadyInactive: scanResult.alreadyInactive,
            stillActive: scanResult.stillActive,
            errors: scanResult.errors,
            details: scanResult.details,
          };
        } catch (err) {
          console.error('Failed to run inactivity scan after union import:', err);
          results.inactivityScan = {
            ran: false,
            scanned: 0,
            deactivated: 0,
            alreadyInactive: 0,
            stillActive: 0,
            errors: [err instanceof Error ? err.message : 'Unknown error'],
            details: [],
          };
        }
      }
    }

    return results;
  }
}

export const htaUnionImport = new HtaUnionImportWizard();
