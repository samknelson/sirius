import { AsyncLocalStorage } from 'async_hooks';
import { FeedWizard, FeedField, ValidationError, type ValidationResults, type ProcessResults, type SsnWarning } from '../feed.js';
import { WizardStatus, WizardStep, LaunchArgument } from '../base.js';
import { storage } from '../../storage/index.js';
import { createUnifiedOptionsStorage } from '../../storage/unified-options.js';

const unifiedOptionsStorage = createUnifiedOptionsStorage();

/**
 * Preprocess SSN value to normalize format
 * - Removes all non-digit characters
 * - Prepends zeros if needed to make it 9 digits
 * - Formats as XXX-XX-XXXX
 * - Returns null if the result doesn't look like a valid SSN
 */
function preprocessSSN(value: any): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  // Convert to string and remove all non-digit characters
  const digitsOnly = String(value).replace(/\D/g, '');
  
  // If empty after removing non-digits, return null
  if (digitsOnly.length === 0) {
    return null;
  }
  
  // If more than 9 digits, it's invalid
  if (digitsOnly.length > 9) {
    return null;
  }
  
  // Prepend zeros to make it 9 digits
  const paddedSSN = digitsOnly.padStart(9, '0');
  
  // Format as XXX-XX-XXXX
  return `${paddedSSN.substring(0, 3)}-${paddedSSN.substring(3, 5)}-${paddedSSN.substring(5, 9)}`;
}

/**
 * Normalize a string for comparison (case-insensitive, whitespace removed)
 */
function normalizeForComparison(value: string): string {
  return String(value).toLowerCase().replace(/\s+/g, '');
}

interface RunContext {
  employerId: string;
  mappings: Array<{ sourceStatus: string; targetStatusId: string }> | null;
  unmappedValues: Set<string>;
  unmappedOnlyRows: Set<number>;
  ssnWarnings: SsnWarning[];
}

const runContextStorage = new AsyncLocalStorage<RunContext>();

export abstract class GbhetLegalWorkersWizard extends FeedWizard {
  entityType = 'employer';
  

  /**
   * Get the field definitions for the GBHET Legal Workers feed
   */
  getFields(): FeedField[] {
    return [
      { 
        id: 'ssn', 
        name: 'SSN', 
        type: 'string', 
        required: true, // Always required
        description: 'Social Security Number',
        format: 'ssn',
        pattern: '^\\d{3}-\\d{2}-\\d{4}$',
        displayOrder: 1
      },
      { 
        id: 'firstName', 
        name: 'First Name', 
        type: 'string', 
        required: false, // Not always required
        requiredForCreate: true, // Required only when creating new records
        description: 'Worker first name',
        maxLength: 100,
        displayOrder: 2
      },
      { 
        id: 'middleName', 
        name: 'Middle Name', 
        type: 'string', 
        required: false,
        description: 'Worker middle name (optional)',
        maxLength: 100,
        displayOrder: 3
      },
      { 
        id: 'lastName', 
        name: 'Last Name', 
        type: 'string', 
        required: false, // Not always required
        requiredForCreate: true, // Required only when creating new records
        description: 'Worker last name',
        maxLength: 100,
        displayOrder: 4
      },
      { 
        id: 'dateOfBirth', 
        name: 'Date of Birth', 
        type: 'date', 
        required: false,
        requiredForCreate: false,
        description: 'Worker date of birth (optional)',
        format: 'date',
        displayOrder: 5
      },
      { 
        id: 'employmentStatus', 
        name: 'Employment Status', 
        type: 'string', 
        required: true, // Always required
        description: 'Current employment status',
        displayOrder: 6
      },
      { 
        id: 'numberOfHours', 
        name: 'Number of Hours', 
        type: 'number', 
        required: true, // Always required
        description: 'Number of hours worked',
        displayOrder: 7
      },
      { 
        id: 'jobTitle', 
        name: 'Job Title', 
        type: 'string', 
        required: false,
        description: 'Worker job title at this employer (optional)',
        maxLength: 255,
        displayOrder: 7.5
      },
      // Optional contact information fields
      { 
        id: 'email', 
        name: 'Email', 
        type: 'string', 
        required: false,
        description: 'Worker email address (optional)',
        format: 'email',
        displayOrder: 8
      },
      { 
        id: 'phoneNumber', 
        name: 'Phone Number', 
        type: 'string', 
        required: false,
        description: 'Worker phone number (optional)',
        displayOrder: 9
      },
      { 
        id: 'gender', 
        name: 'Gender', 
        type: 'string', 
        required: false,
        description: 'Worker gender (optional)',
        displayOrder: 10
      },
      // Optional address fields
      { 
        id: 'addressLine1', 
        name: 'Address 1', 
        type: 'string', 
        required: false,
        description: 'Street address line 1 (optional)',
        displayOrder: 11
      },
      { 
        id: 'addressLine2', 
        name: 'Address 2', 
        type: 'string', 
        required: false,
        description: 'Street address line 2 (optional)',
        displayOrder: 12
      },
      { 
        id: 'city', 
        name: 'City', 
        type: 'string', 
        required: false,
        description: 'City (optional)',
        displayOrder: 13
      },
      { 
        id: 'state', 
        name: 'State', 
        type: 'string', 
        required: false,
        description: 'State (optional)',
        displayOrder: 14
      },
      { 
        id: 'postalCode', 
        name: 'Postal Code', 
        type: 'string', 
        required: false,
        description: 'Postal/ZIP code (optional)',
        displayOrder: 15
      },
      // Benefit eligibility fields - can be mapped to file columns to create WMB records
      { 
        id: 'benefit_1', 
        name: 'Benefit Eligibility 1', 
        type: 'benefit', 
        required: false,
        description: 'Benefit eligibility indicator (Yes/Y/1/X = eligible)',
        displayOrder: 100,
        isBenefitEligibility: true
      },
      { 
        id: 'benefit_2', 
        name: 'Benefit Eligibility 2', 
        type: 'benefit', 
        required: false,
        description: 'Benefit eligibility indicator (Yes/Y/1/X = eligible)',
        displayOrder: 101,
        isBenefitEligibility: true
      },
      { 
        id: 'benefit_3', 
        name: 'Benefit Eligibility 3', 
        type: 'benefit', 
        required: false,
        description: 'Benefit eligibility indicator (Yes/Y/1/X = eligible)',
        displayOrder: 102,
        isBenefitEligibility: true
      },
      { 
        id: 'benefit_4', 
        name: 'Benefit Eligibility 4', 
        type: 'benefit', 
        required: false,
        description: 'Benefit eligibility indicator (Yes/Y/1/X = eligible)',
        displayOrder: 103,
        isBenefitEligibility: true
      },
      { 
        id: 'benefit_5', 
        name: 'Benefit Eligibility 5', 
        type: 'benefit', 
        required: false,
        description: 'Benefit eligibility indicator (Yes/Y/1/X = eligible)',
        displayOrder: 104,
        isBenefitEligibility: true
      }
    ];
  }

  getSteps(): WizardStep[] {
    return [
      { id: 'upload', name: 'Upload', description: 'Upload data file' },
      { id: 'map', name: 'Map', description: 'Map fields to schema' },
      { id: 'benefits', name: 'Benefits', description: 'Configure benefit eligibility fields' },
      { id: 'validate', name: 'Validate', description: 'Validate data integrity' },
      { id: 'process', name: 'Process', description: 'Process and transform data' },
      { id: 'review', name: 'Review', description: 'Review results' }
    ];
  }

  getStatuses(): WizardStatus[] {
    return [
      { id: 'draft', name: 'Draft', description: 'Initial draft state' },
      { id: 'complete', name: 'Complete', description: 'Feed generation complete' }
    ];
  }

  getLaunchArguments(): LaunchArgument[] {
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth() + 1;

    return [
      {
        id: 'year',
        name: 'Year',
        type: 'year',
        required: true,
        description: 'Select the year for this monthly feed',
        defaultValue: currentYear
      },
      {
        id: 'month',
        name: 'Month',
        type: 'month',
        required: true,
        description: 'Select the month for this monthly feed',
        defaultValue: currentMonth
      }
    ];
  }

  async getRecordCount(filters?: Record<string, any>): Promise<number> {
    return 0;
  }

  protected async fetchWorkerData(filters: Record<string, any>): Promise<any[]> {
    return [];
  }

  protected validatePeriod(year: number, month: number): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];
    
    if (year < 2000 || year > 2100) {
      errors.push('Year must be between 2000 and 2100');
    }
    
    if (month < 1 || month > 12) {
      errors.push('Month must be between 1 and 12');
    }
    
    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  /**
   * Get employment status options from the database
   */
  private async getEmploymentStatusOptions(): Promise<Array<{ id: string; name: string; code: string; employed: boolean }>> {
    const statuses = await unifiedOptionsStorage.list("employment-status");
    return statuses.map(s => ({ id: s.id, name: s.name, code: s.code, employed: s.employed }));
  }

  private async getEmployerStatusMappings(): Promise<Array<{ sourceStatus: string; targetStatusId: string }>> {
    const ctx = runContextStorage.getStore();
    if (!ctx) return [];
    if (ctx.mappings) return ctx.mappings;
    const mappings = await storage.wizardEmploymentStatusMappings.getByEmployer(ctx.employerId);
    ctx.mappings = mappings.map(m => ({ sourceStatus: m.sourceStatus, targetStatusId: m.targetStatusId }));
    return ctx.mappings;
  }

  /**
   * Get work status options from the database
   */
  private async getWorkStatusOptions(): Promise<Array<{ id: string; name: string }>> {
    const statuses = await unifiedOptionsStorage.list("worker-ws");
    return statuses.map(s => ({ id: s.id, name: s.name }));
  }

  /**
   * Check if a status name indicates "Deceased" (handles variations like "Deceased - Worker")
   */
  private isDeceasedStatus(name: string): boolean {
    const normalized = normalizeForComparison(name);
    return normalized.includes('deceased');
  }

  /**
   * Sync work status from employment status
   * Rules:
   * - If current work status is "Deceased", never change it
   * - If employment status is "Deceased", set work status to "Deceased"
   * - If employment status is active (employed=true), set work status to match
   * - If employment status is not active (e.g., Terminated), only set if worker has no other active employment records
   */
  protected async syncWorkStatusFromEmployment(
    workerId: string,
    employmentStatusOption: { id: string; name: string; code: string; employed: boolean },
    year: number,
    month: number
  ): Promise<void> {
    // Get worker's current work status
    const worker = await storage.workers.getWorker(workerId);
    if (!worker) {
      return;
    }

    // Get current work status name if it exists
    let currentWorkStatusName: string | null = null;
    if (worker.denormWsId) {
      const currentWs = await unifiedOptionsStorage.get("worker-ws", worker.denormWsId);
      currentWorkStatusName = currentWs?.name || null;
    }

    // Rule: Never change if current status is "Deceased" (using robust pattern matching)
    if (currentWorkStatusName && this.isDeceasedStatus(currentWorkStatusName)) {
      return;
    }

    // Find matching work status option by name
    const workStatusOptions = await this.getWorkStatusOptions();
    const normalizedEsName = normalizeForComparison(employmentStatusOption.name);
    
    const matchingWsOption = workStatusOptions.find(ws => 
      normalizeForComparison(ws.name) === normalizedEsName
    );

    if (!matchingWsOption) {
      // No matching work status option found - skip silently
      return;
    }

    const isDeceased = this.isDeceasedStatus(employmentStatusOption.name);
    const isEmployed = employmentStatusOption.employed;

    // Rule: If employment status is "Deceased", set it
    if (isDeceased) {
      await this.createWorkStatusHistoryEntry(workerId, matchingWsOption.id, year, month);
      return;
    }

    // Rule: If employment status is active (employed=true), set it
    if (isEmployed) {
      await this.createWorkStatusHistoryEntry(workerId, matchingWsOption.id, year, month);
      return;
    }

    // Rule: For non-active statuses (e.g., Terminated), only set if no other active employment records
    const currentEmploymentRecords = await storage.workerHours.getWorkerHoursCurrent(workerId);
    
    // Check if any of the current employment records show an active (employed=true) status
    const hasActiveEmployment = currentEmploymentRecords.some(record => 
      record.employmentStatus?.employed === true
    );

    if (!hasActiveEmployment) {
      // No active employment anywhere - safe to set the non-active status
      await this.createWorkStatusHistoryEntry(workerId, matchingWsOption.id, year, month);
    }
    // If there are active records elsewhere, don't change the work status
  }

  /**
   * Create a work status history entry for a worker
   */
  private async createWorkStatusHistoryEntry(
    workerId: string,
    wsId: string,
    year: number,
    month: number
  ): Promise<void> {
    // Use the last day of the month as the date
    const lastDayOfMonth = new Date(year, month, 0).getDate();
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(lastDayOfMonth).padStart(2, '0')}`;

    await storage.workerWsh.createWorkerWsh({
      workerId,
      date: dateStr,
      wsId,
      data: { source: 'hours_upload' }
    });
  }

  async validateFeedData(
    wizardId: string,
    batchSize: number = 100,
    onProgress?: (progress: { processed: number; total: number; validRows: number; invalidRows: number }) => void
  ): Promise<ValidationResults> {
    const wizard = await storage.wizards.getById(wizardId);
    const ctx: RunContext = { employerId: wizard?.entityId || '', mappings: null, unmappedValues: new Set(), unmappedOnlyRows: new Set(), ssnWarnings: [] };

    return runContextStorage.run(ctx, async () => {
      const results = await super.validateFeedData(wizardId, batchSize, onProgress);

      let needsResave = false;

      if (ctx.unmappedValues.size > 0) {
        results.unmappedStatuses = Array.from(ctx.unmappedValues);

        results.errors = results.errors.filter(
          e => !(e.field === 'employmentStatus' && e.message === 'unmapped_employment_status')
        );

        const reclassifiedCount = ctx.unmappedOnlyRows.size;
        results.invalidRows -= reclassifiedCount;
        results.validRows += reclassifiedCount;

        for (const key of Object.keys(results.errorSummary)) {
          if (key.includes('unmapped_employment_status')) {
            delete results.errorSummary[key];
          }
        }

        needsResave = true;
      }

      // Bad-format SSN errors were demoted to warnings in validateRow (removed
      // from the row's blocking errors), so those rows already count as valid.
      // Surface the collected warnings on the results for the UI.
      if (ctx.ssnWarnings.length > 0) {
        results.ssnWarnings = ctx.ssnWarnings;
        needsResave = true;
      }

      if (needsResave) {
        const wizardObj = await storage.wizards.getById(wizardId);
        if (wizardObj) {
          const wizardData = wizardObj.data as any;
          await storage.wizards.update(wizardId, {
            data: { ...wizardData, validationResults: results }
          });
        }
      }

      return results;
    });
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
    const wizard = await storage.wizards.getById(wizardId);
    const ctx: RunContext = { employerId: wizard?.entityId || '', mappings: null, unmappedValues: new Set(), unmappedOnlyRows: new Set(), ssnWarnings: [] };
    return runContextStorage.run(ctx, () => super.processFeedData(wizardId, batchSize, onProgress));
  }

  async validateRow(row: Record<string, any>, rowIndex: number, mode: 'create' | 'update'): Promise<ValidationError[]> {
    // Preprocess SSN if present
    if (row.ssn !== undefined && row.ssn !== null) {
      const preprocessed = preprocessSSN(row.ssn);
      
      // If preprocessing fails (returns null), keep original value so parent validation catches it
      if (preprocessed !== null) {
        row.ssn = preprocessed;
      }
    }

    // Treat a blank "Number of Hours" as 0 so it passes the required-field
    // check; it is recorded as zero hours during processing.
    if (row.numberOfHours === undefined || row.numberOfHours === null || row.numberOfHours === '') {
      row.numberOfHours = 0;
    }
    
    // Call parent validation to get standard field validation errors
    const errors = await super.validateRow(row, rowIndex, mode);

    // Demote bad-format SSN errors to warnings so they don't block the file.
    // A completely missing SSN ("SSN is required") stays a blocking error.
    const ssnCtx = runContextStorage.getStore();
    let hasSsnWarning = false;
    for (let i = errors.length - 1; i >= 0; i--) {
      const e = errors[i];
      if (e.field === 'ssn' && e.message !== 'SSN is required') {
        hasSsnWarning = true;
        if (ssnCtx) {
          ssnCtx.ssnWarnings.push({ rowIndex, value: e.value, message: e.message });
        }
        errors.splice(i, 1);
      }
    }
    
    if (row.employmentStatus !== undefined && row.employmentStatus !== null && row.employmentStatus !== '') {
      const employmentStatusOptions = await this.getEmploymentStatusOptions();
      const normalizedInput = normalizeForComparison(String(row.employmentStatus));
      
      const matchingOption = employmentStatusOptions.find(option => {
        if (normalizeForComparison(option.name) === normalizedInput) return true;
        if (option.code && normalizeForComparison(option.code) === normalizedInput) return true;
        return false;
      });
      
      if (matchingOption) {
        row.employmentStatus = matchingOption.name;
      } else {
        const mappings = await this.getEmployerStatusMappings();
        const mappedEntry = mappings.find(m => normalizeForComparison(m.sourceStatus) === normalizedInput);
        
        if (mappedEntry) {
          const targetOption = employmentStatusOptions.find(o => o.id === mappedEntry.targetStatusId);
          if (targetOption) {
            row.employmentStatus = targetOption.name;
          } else {
            errors.push({
              rowIndex,
              field: 'employmentStatus',
              message: 'Mapped employment status target no longer exists',
              value: row.employmentStatus
            });
          }
        } else {
          const ctx = runContextStorage.getStore();
          if (ctx) {
            ctx.unmappedValues.add(String(row.employmentStatus));
          }
          errors.push({
            rowIndex,
            field: 'employmentStatus',
            message: 'unmapped_employment_status',
            value: row.employmentStatus
          });
        }
      }
    }
    
    // For update mode, verify that a worker with the given SSN exists
    if (mode === 'update') {
      const ssn = row.ssn;
      
      // Only check if SSN is present and passed format validation. A bad-format
      // SSN was demoted to a warning above, so skip the existence check for it.
      if (ssn && !hasSsnWarning && !errors.some(e => e.field === 'ssn')) {
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
    
    const ctx = runContextStorage.getStore();
    if (ctx && errors.length > 0) {
      const hasUnmapped = errors.some(e => e.message === 'unmapped_employment_status');
      const hasOtherErrors = errors.some(e => e.message !== 'unmapped_employment_status');
      if (hasUnmapped && !hasOtherErrors) {
        ctx.unmappedOnlyRows.add(rowIndex);
      }
    }

    return errors;
  }

  /**
   * Process worker hours for a row during feed processing
   * This method is called by the processFeedData method when processing each worker
   */
  protected async processWorkerHours(workerId: string, row: Record<string, any>, wizard: any): Promise<void> {

    const rawHours = row.numberOfHours;
    const employmentStatusValue = row.employmentStatus;

    // A blank/missing hours value is treated as 0 (recorded as a zero-hour
    // entry) rather than being skipped.
    const isBlankHours = rawHours === undefined || rawHours === null || rawHours === '';

    // Parse hours as number
    const hours = isBlankHours
      ? 0
      : (typeof rawHours === 'number' ? rawHours : parseFloat(String(rawHours)));
    if (!isBlankHours && !isFinite(hours)) {
      throw new Error(`Invalid hours value: ${rawHours}`);
    }

    // Validate employment status - it should already be normalized from validation step
    if (!employmentStatusValue || employmentStatusValue === '') {
      throw new Error('Employment status is required when hours are provided');
    }

    // Get employer ID from wizard entity
    const employerId = wizard.entityId;
    if (!employerId) {
      throw new Error('Wizard is not linked to an employer');
    }

    // Get year and month from wizard data (launch arguments are stored in the data JSONB field)
    const wizardData = wizard.data as any || {};
    const launchArguments = wizardData.launchArguments || {};
    const yearValue = launchArguments.year;
    const monthValue = launchArguments.month;

    if (yearValue === undefined || yearValue === null || monthValue === undefined || monthValue === null) {
      throw new Error('Year and month are required in wizard launch arguments');
    }

    const year = typeof yearValue === 'number' ? yearValue : parseInt(String(yearValue), 10);
    const month = typeof monthValue === 'number' ? monthValue : parseInt(String(monthValue), 10);

    if (!isFinite(year) || !isFinite(month) || year < 2000 || year > 2100 || month < 1 || month > 12) {
      throw new Error(`Invalid year/month in wizard launch arguments: ${yearValue}/${monthValue}`);
    }

    // Look up employment status ID by direct ID, name, or code
    const employmentStatusOptions = await this.getEmploymentStatusOptions();
    
    // First, check if the value is a direct ID match
    let matchingOption = employmentStatusOptions.find(option => option.id === employmentStatusValue);
    
    // If not a direct ID, try normalized name/code matching
    if (!matchingOption) {
      const normalizedInput = normalizeForComparison(String(employmentStatusValue));
      matchingOption = employmentStatusOptions.find(option => {
        if (normalizeForComparison(option.name) === normalizedInput) {
          return true;
        }
        if (option.code && normalizeForComparison(option.code) === normalizedInput) {
          return true;
        }
        return false;
      });
    }

    if (!matchingOption) {
      const mappings = await this.getEmployerStatusMappings();
      const normalizedInput2 = normalizeForComparison(String(employmentStatusValue));
      const mappedEntry = mappings.find(m => normalizeForComparison(m.sourceStatus) === normalizedInput2);
      if (mappedEntry) {
        matchingOption = employmentStatusOptions.find(o => o.id === mappedEntry.targetStatusId);
      }
    }

    if (!matchingOption) {
      throw new Error(`Employment status "${employmentStatusValue}" not found; verify name, code, or ID`);
    }

    const jobTitle = row.jobTitle?.toString().trim() || null;

    await storage.workerHours.upsertWorkerHours({
      workerId,
      employerId,
      employmentStatusId: matchingOption.id,
      year,
      month,
      hours,
      jobTitle
    });

    // Sync work status from employment status
    await this.syncWorkStatusFromEmployment(workerId, matchingOption, year, month);
  }

  /**
   * Process optional contact information fields for a worker
   * Handles email, phone number, gender, and address fields
   */
  protected async processWorkerContactInfo(workerId: string, row: Record<string, any>): Promise<void> {
    // Get the worker to find its contact ID
    const worker = await storage.workers.getWorker(workerId);
    if (!worker) {
      throw new Error(`Worker not found: ${workerId}`);
    }

    const contactId = worker.contactId;

    // Process email if provided
    const email = row.email?.toString().trim();
    if (email) {
      await storage.workers.updateWorkerContactEmail(workerId, email);
    }

    // Process gender if provided
    const genderValue = row.gender?.toString().trim();
    if (genderValue) {
      // Look up gender option by name or code
      const genderOptions = await unifiedOptionsStorage.list("gender");
      const normalizedInput = normalizeForComparison(genderValue);
      
      const matchingGender = genderOptions.find((option: { id: string; name: string; code: string }) => {
        if (normalizeForComparison(option.name) === normalizedInput) {
          return true;
        }
        if (option.code && normalizeForComparison(option.code) === normalizedInput) {
          return true;
        }
        return false;
      });

      if (matchingGender) {
        await storage.workers.updateWorkerContactGender(workerId, matchingGender.id, null);
      }
      // If no match found, skip silently (optional field)
    }

    // Process phone number if provided
    const phoneNumber = row.phoneNumber?.toString().trim();
    if (phoneNumber) {
      // Check if contact already has phone numbers
      const existingPhones = await storage.contacts.phoneNumbers.getPhoneNumbersByContact(contactId);
      
      if (existingPhones.length > 0) {
        // Update the primary phone number
        const primaryPhone = existingPhones.find(p => p.isPrimary) || existingPhones[0];
        await storage.contacts.phoneNumbers.updatePhoneNumber(primaryPhone.id, {
          phoneNumber: phoneNumber
        });
      } else {
        // Create a new primary phone number
        await storage.contacts.phoneNumbers.createPhoneNumber({
          contactId,
          phoneNumber: phoneNumber,
          isPrimary: true
        });
      }
    }

    // Process address if any address fields are provided
    const addressLine1 = row.addressLine1?.toString().trim();
    const addressLine2 = row.addressLine2?.toString().trim() || null;
    const city = row.city?.toString().trim();
    const state = row.state?.toString().trim();
    const postalCode = row.postalCode?.toString().trim();

    // Only process address if at least street (addressLine1) and city are provided
    // These are minimum required fields for a valid address
    if (addressLine1 && city && state && postalCode) {
      // Check if contact already has addresses
      const existingAddresses = await storage.contacts.addresses.getContactPostalByContact(contactId);
      
      if (existingAddresses.length > 0) {
        // Update the primary address
        const primaryAddress = existingAddresses.find((a: { isPrimary: boolean }) => a.isPrimary) || existingAddresses[0];
        await storage.contacts.addresses.updateContactPostal(primaryAddress.id, {
          street: addressLine1,
          city,
          state,
          postalCode,
          country: 'US' // Default to US
        });
      } else {
        // Create a new primary address
        await storage.contacts.addresses.createContactPostal({
          contactId,
          street: addressLine1,
          city,
          state,
          postalCode,
          country: 'US', // Default to US
          isPrimary: true
        });
      }
    }
  }

  /**
   * Check if a value indicates benefit eligibility (truthy values)
   * Truthy: Yes, Y, 1, X, True, or any non-empty non-zero value
   * Falsy: No, N, 0, False, empty, null, undefined
   */
  protected isBenefitEligible(value: any): boolean {
    if (value === null || value === undefined) {
      return false;
    }
    
    const strValue = String(value).toLowerCase().trim();
    
    // Explicit falsy values
    if (strValue === '' || strValue === '0' || strValue === 'no' || strValue === 'n' || strValue === 'false') {
      return false;
    }
    
    // Explicit truthy values
    if (strValue === '1' || strValue === 'yes' || strValue === 'y' || strValue === 'x' || strValue === 'true') {
      return true;
    }
    
    // Any other non-empty value is considered truthy
    return strValue.length > 0;
  }

  /**
   * Calculate the target month for WMB records (3 months after upload month)
   * e.g., January 2025 upload -> April 2025 WMB
   */
  protected calculateBenefitMonth(uploadYear: number, uploadMonth: number): { year: number; month: number } {
    let targetMonth = uploadMonth + 3;
    let targetYear = uploadYear;
    
    if (targetMonth > 12) {
      targetMonth -= 12;
      targetYear += 1;
    }
    
    return { year: targetYear, month: targetMonth };
  }

  /**
   * Process benefit eligibility fields for a worker
   * Creates WMB records for the target month (3 months after upload) if eligibility is truthy
   */
  protected async processWorkerBenefits(
    workerId: string, 
    row: Record<string, any>, 
    wizard: any
  ): Promise<{ created: number; skipped: number; errors: string[]; createdBenefits: Array<{ benefitId: string; benefitName: string; wmbId: string }> }> {
    const result = { 
      created: 0, 
      skipped: 0, 
      errors: [] as string[],
      createdBenefits: [] as Array<{ benefitId: string; benefitName: string; wmbId: string }>
    };
    
    const wizardData = wizard.data as any || {};
    const benefitConfig = wizardData.benefitConfig as Array<{ fieldId: string; benefitId: string; benefitName?: string }> || [];
    
    // If no benefit configuration, skip
    if (benefitConfig.length === 0) {
      return result;
    }
    
    // Get upload year/month from wizard launch arguments
    const launchArguments = wizardData.launchArguments || {};
    const uploadYear = typeof launchArguments.year === 'number' ? launchArguments.year : parseInt(String(launchArguments.year), 10);
    const uploadMonth = typeof launchArguments.month === 'number' ? launchArguments.month : parseInt(String(launchArguments.month), 10);
    
    if (!isFinite(uploadYear) || !isFinite(uploadMonth)) {
      result.errors.push('Year and month are required in wizard launch arguments for benefit processing');
      return result;
    }
    
    // Calculate target month (3 months after upload)
    const { year: targetYear, month: targetMonth } = this.calculateBenefitMonth(uploadYear, uploadMonth);
    
    // Get employer ID from wizard entity
    const employerId = wizard.entityId;
    if (!employerId) {
      result.errors.push('Wizard is not linked to an employer');
      return result;
    }
    
    // Process each configured benefit field
    for (const config of benefitConfig) {
      const { fieldId, benefitId, benefitName } = config;
      const eligibilityValue = row[fieldId];
      
      // Check if this worker is eligible for the benefit
      if (this.isBenefitEligible(eligibilityValue)) {
        try {
          // Check if WMB already exists
          const exists = await storage.trust.wmb.workerBenefitExists(workerId, benefitId, targetMonth, targetYear);
          
          if (exists) {
            result.skipped++;
          } else {
            // Create WMB record via storage layer (includes logging and charge plugin execution)
            const wmb = await storage.trust.wmb.createWorkerBenefit({
              workerId,
              month: targetMonth,
              year: targetYear,
              employerId,
              benefitId
            });
            result.created++;
            result.createdBenefits.push({
              benefitId,
              benefitName: benefitName || benefitId,
              wmbId: wmb.id
            });
          }
        } catch (error) {
          result.errors.push(`Failed to create WMB for benefit ${benefitId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    
    return result;
  }

}
