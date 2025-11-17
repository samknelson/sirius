import { storage } from '../server/storage/database';

// Ledger account IDs
const accountIds = {
  employerContributions: 'be2b137e-8094-48f1-aa26-c16afb282304',
  invasionSlushFund: '1dbd7d28-910c-497e-9b66-5cb035ca2012'
};

// Payment type IDs
const paymentTypes = {
  adjustment: '6a0db487-386f-4e16-a873-cc03d74d9508',
  offlinePayment: 'cc81bcb3-be7f-48d4-87d7-21f4a70a8817',
  stripe: '3cd4830b-1606-449b-804e-4982712c5954'
};

// Employer IDs (from previous population)
const employerIds = [
  'bd6d9bef-4654-466f-8d86-a09e634f6c9a', // Vogon Constructor Fleet
  'ab5f98ff-90b1-4106-b332-32c73917fffd', // Invasion Suppliers LLC
  'a85edb4d-4e9d-4b58-8faf-b3a235235e07', // Tripod Logistics Corp
  '14c76f8c-ce75-418e-a748-ac5bdf51ed4f', // Red Planet Industries Inc
  '11a62cbe-e805-4f22-8304-536a3be83f63', // Death Ray Manufacturing Co
  '887afad8-f36e-48bd-8952-d75ee102ceab', // Martian Conquest Solutions
  '3264ed32-f430-424a-a507-fa00454b526a', // Interplanetary Domination Group
  '91eac9d1-1f9e-4548-8c3e-9bfc9a3eb005', // Heat-Ray Technologies LLC
  '2c323505-7049-40c7-b48a-c2a1a3fa803b', // War Machine Suppliers Inc
  '887beba3-93bf-43e5-aac2-9526d055508b'  // Alien Invasion Support Services
];

// Merchant names for sample data
const merchants = [
  'Galactic Bank Transfer',
  'Mars Payment Systems',
  'Interplanetary Wire Service',
  'Red Planet Financial',
  'Cosmic Credit Union',
  'Stellar Payment Gateway',
  'Venus Banking Corp',
  'Jupiter Financial Services',
  'Neptune Payment Solutions',
  'Saturn Trust Company',
  'Mercury Express Payments',
  'Uranus Financial Network'
];

// Memo templates
const memoTemplates = [
  'Monthly employer contribution for {month}/{year}',
  'Quarterly payment for invasion operations',
  'Annual contribution - {year}',
  'Special assessment for martian activities',
  'Regular employer payment',
  'Supplemental contribution',
  'Year-end adjustment for {year}',
  'Mid-year payment adjustment',
  'Retroactive payment for prior period',
  'Advance payment for upcoming period',
  'Settlement of outstanding balance',
  'Correction of prior payment error'
];

const paymentStatuses = ['draft', 'cleared', 'canceled', 'error'] as const;

function getRandomInt(max: number): number {
  return Math.floor(Math.random() * max);
}

function getRandomElement<T>(array: T[]): T {
  return array[getRandomInt(array.length)];
}

function generateAmount(min: number, max: number, allowNegative: boolean = false): string {
  const amount = Math.floor(Math.random() * (max - min + 1)) + min;
  const finalAmount = allowNegative && Math.random() < 0.3 ? -amount : amount;
  return finalAmount.toFixed(2);
}

function generateDate(startDate: Date, endDate: Date): Date {
  const startTime = startDate.getTime();
  const endTime = endDate.getTime();
  const randomTime = startTime + Math.random() * (endTime - startTime);
  return new Date(randomTime);
}

function generateMemo(month?: number, year?: number): string {
  const template = getRandomElement(memoTemplates);
  return template
    .replace('{month}', (month || getRandomInt(12) + 1).toString())
    .replace('{year}', (year || 2024 + getRandomInt(2)).toString());
}

function generateTransactionNumber(): string {
  const prefix = ['TXN', 'CHK', 'ACH', 'WIRE', 'REF'][getRandomInt(5)];
  const number = String(getRandomInt(1000000)).padStart(7, '0');
  return `${prefix}-${number}`;
}

function generateDetails(paymentTypeId: string): any {
  const details: any = {
    merchant: getRandomElement(merchants),
    checkTransactionNumber: generateTransactionNumber()
  };

  if (paymentTypeId === paymentTypes.stripe) {
    details.stripePaymentIntentId = `pi_${Math.random().toString(36).substring(2, 15)}`;
    details.stripeCustomerId = `cus_${Math.random().toString(36).substring(2, 15)}`;
  }

  return details;
}

async function createEaEntry(accountId: string, employerId: string): Promise<string> {
  try {
    const ea = await storage.ledger.ea.create({
      accountId,
      entityType: 'employer',
      entityId: employerId,
      data: {
        createdAt: new Date().toISOString(),
        notes: 'Auto-generated EA entry for payment population'
      }
    });
    return ea.id;
  } catch (error: any) {
    // If EA already exists, fetch it
    if (error.message?.includes('duplicate') || error.code === '23505') {
      const existing = await storage.ledger.ea.getByEntity('employer', employerId);
      const match = existing.find(e => e.accountId === accountId);
      if (match) {
        return match.id;
      }
    }
    throw error;
  }
}

async function populateLedgerPayments() {
  console.log('🚀 Starting Ledger Payment Population...\n');

  // Step 1: Create EA entries for all employer/account combinations
  console.log('Step 1: Creating EA entries for employer/account pairs...');
  const eaMap: Map<string, string> = new Map();
  
  for (const employerId of employerIds) {
    for (const [accountName, accountId] of Object.entries(accountIds)) {
      // Create EAs for 70% of combinations (not all employers will have both accounts)
      if (Math.random() < 0.7) {
        try {
          const eaId = await createEaEntry(accountId, employerId);
          const key = `${employerId}:${accountId}`;
          eaMap.set(key, eaId);
          console.log(`  ✓ EA created for employer/account pair`);
        } catch (error: any) {
          console.error(`  ✗ Error creating EA:`, error.message);
        }
      }
    }
  }
  
  console.log(`\n  Created/found ${eaMap.size} EA entries\n`);

  // Step 2: Create payments
  const eaEntries = Array.from(eaMap.values());
  if (eaEntries.length === 0) {
    console.error('No EA entries available to create payments!');
    return;
  }

  console.log('Step 2: Creating ~1000 payments...');
  
  const targetPayments = 1000;
  const startDate = new Date('2024-01-01');
  const endDate = new Date('2025-11-16');
  
  let created = 0;
  let errors = 0;

  for (let i = 0; i < targetPayments; i++) {
    try {
      // Select random EA
      const ledgerEaId = getRandomElement(eaEntries);
      
      // Select payment type with distribution:
      // 40% Stripe, 40% Offline Payment, 20% Adjustment
      const rand = Math.random();
      let paymentTypeId: string;
      let allowNegative = false;
      
      if (rand < 0.4) {
        paymentTypeId = paymentTypes.stripe;
      } else if (rand < 0.8) {
        paymentTypeId = paymentTypes.offlinePayment;
      } else {
        paymentTypeId = paymentTypes.adjustment;
        allowNegative = true;
      }

      // Generate amount ($1,000 to $1,000,000)
      const amount = generateAmount(1000, 1000000, allowNegative);

      // Generate dates
      const dateCreated = generateDate(startDate, endDate);
      
      // 80% have dateReceived (within 0-30 days after created)
      const dateReceived = Math.random() < 0.8
        ? new Date(dateCreated.getTime() + getRandomInt(30) * 24 * 60 * 60 * 1000)
        : null;

      // 60% have dateCleared (within 0-14 days after received)
      const dateCleared = dateReceived && Math.random() < 0.6
        ? new Date(dateReceived.getTime() + getRandomInt(14) * 24 * 60 * 60 * 1000)
        : null;

      // Status based on dates
      let status: typeof paymentStatuses[number];
      if (dateCleared) {
        status = 'cleared';
      } else if (Math.random() < 0.1) {
        status = getRandomElement(['draft', 'canceled', 'error'] as const);
      } else {
        status = 'draft';
      }

      // Generate details and memo
      const details = generateDetails(paymentTypeId);
      const memo = generateMemo(dateCreated.getMonth() + 1, dateCreated.getFullYear());

      // Create payment
      await storage.ledger.payments.create({
        ledgerEaId,
        paymentType: paymentTypeId,
        amount,
        status,
        allocated: Math.random() < 0.3, // 30% allocated
        dateCreated,
        dateReceived: dateReceived || undefined,
        dateCleared: dateCleared || undefined,
        memo,
        details
      });

      created++;

      // Progress indicator every 100 payments
      if ((i + 1) % 100 === 0) {
        console.log(`  Progress: ${i + 1}/${targetPayments} payments created`);
      }

    } catch (error: any) {
      errors++;
      if (errors <= 5) {
        console.error(`  ✗ Error creating payment ${i + 1}:`, error.message);
      }
    }
  }

  console.log(`\n✅ Payment Population Complete!`);
  console.log(`  Total payments created: ${created}`);
  console.log(`  Errors: ${errors}`);

  // Print summary
  const allPayments = await storage.ledger.payments.getAll();
  console.log(`\n📊 Summary:`);
  console.log(`  Total payments in database: ${allPayments.length}`);
  
  // Count by type
  const byType = allPayments.reduce((acc, p) => {
    acc[p.paymentType] = (acc[p.paymentType] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  console.log(`\n  By Payment Type:`);
  if (byType[paymentTypes.stripe]) console.log(`    Stripe: ${byType[paymentTypes.stripe]}`);
  if (byType[paymentTypes.offlinePayment]) console.log(`    Offline Payment: ${byType[paymentTypes.offlinePayment]}`);
  if (byType[paymentTypes.adjustment]) console.log(`    Adjustment: ${byType[paymentTypes.adjustment]}`);

  // Count by status
  const byStatus = allPayments.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  console.log(`\n  By Status:`);
  Object.entries(byStatus).forEach(([status, count]) => {
    console.log(`    ${status}: ${count}`);
  });
}

// Run the script
populateLedgerPayments()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
