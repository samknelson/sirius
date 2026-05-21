import { storage } from '../server/storage/database';

// Martian invasion-themed company names
const companyNames = [
  "Invaders Transportation LLC",
  "Ray Gun Services LTD",
  "Tripod Logistics Corp",
  "Red Planet Industries Inc",
  "Death Ray Manufacturing Co",
  "Martian Conquest Solutions",
  "Interplanetary Domination Group",
  "Heat-Ray Technologies LLC",
  "War Machine Suppliers Inc",
  "Alien Invasion Support Services"
];

// Contact type IDs
const contactTypes = {
  overlord: "c15754f0-74c8-4b01-9413-7c4b6c82eaab",
  underlord: "72f3c29f-3ea5-436a-b2d1-d381c5000199"
};

// Generate random first and last names
const firstNames = ["Zyx", "Klar", "Vex", "Qort", "Nyx", "Zar", "Xul", "Rax", "Myx", "Kron", "Vox", "Traz"];
const lastNames = ["Zorblax", "Kraven", "Vextor", "Morlok", "Xander", "Kryton", "Morpheus", "Nexus", "Zephyr", "Kronos", "Vector", "Maximus"];

function getRandomInt(max: number): number {
  return Math.floor(Math.random() * max);
}

function getRandomElement<T>(array: T[]): T {
  return array[getRandomInt(array.length)];
}

function generateEmail(firstName: string, lastName: string, companyName: string): string {
  const domain = companyName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(' ')
    .slice(0, 2)
    .join('');
  return `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${domain}.mars`;
}

async function populateEmployers() {
  console.log('🚀 Starting Martian Invasion Employer Population...\n');

  for (let i = 0; i < companyNames.length; i++) {
    const companyName = companyNames[i];
    
    try {
      // Create employer
      console.log(`Creating employer ${i + 1}/10: ${companyName}`);
      const employer = await storage.employers.createEmployer({
        name: companyName,
        isActive: true
      });

      // Randomly determine number of contacts (0-3)
      const numContacts = getRandomInt(4);
      console.log(`  Creating ${numContacts} contact(s)...`);

      // Create contacts
      for (let j = 0; j < numContacts; j++) {
        const firstName = getRandomElement(firstNames);
        const lastName = getRandomElement(lastNames);
        const email = generateEmail(firstName, lastName, companyName);
        const contactTypeId = Math.random() > 0.5 ? contactTypes.overlord : contactTypes.underlord;
        const contactTypeName = contactTypeId === contactTypes.overlord ? 'Overlord' : 'Underlord';

        const contact = await storage.contacts.createContact({
          given: firstName,
          family: lastName,
          displayName: `${firstName} ${lastName}`,
          email
        });

        await storage.employerContacts.create({
          contactId: contact.id,
          employerId: employer.id,
          contactTypeId
        });

        console.log(`    ✓ ${firstName} ${lastName} (${contactTypeName}) - ${email}`);
      }

      console.log(`  ✓ ${companyName} created with ${numContacts} contact(s)\n`);
    } catch (error: any) {
      console.error(`  ✗ Error creating ${companyName}:`, error.message);
    }
  }

  console.log('✅ Martian Invasion Employer Population Complete!');
}

// Run the script
populateEmployers()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
