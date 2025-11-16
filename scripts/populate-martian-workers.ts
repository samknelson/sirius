import { storage } from '../server/storage/database';

// Martian-themed worker names
const martianTitles = [
  "Vinnie The Venusian",
  "Zork The Destroyer",
  "Klaatu From Mars",
  "Zephyr The Invader",
  "Gorblax The Terrible",
  "Xander The Conqueror",
  "Morpheus The Red",
  "Kronos The Mighty",
  "Vextor The Cruel",
  "Nexus The Swift",
  "Zorblax The Fearsome",
  "Kraven The Bold",
  "Qort The Ruthless",
  "Nyx The Silent",
  "Rax The Fierce",
  "Myx The Cunning",
  "Traz The Strong",
  "Vox The Wise",
  "Xul The Dark",
  "Zar The Merciless"
];

const martianFirstNames = [
  "Zyx", "Klar", "Vex", "Qort", "Nyx", "Zar", "Xul", "Rax", "Myx", "Kron",
  "Vox", "Traz", "Gorb", "Klat", "Morph", "Zeph", "Nexi", "Zorb", "Krav", "Vext",
  "Qorx", "Nyxa", "Zarx", "Xula", "Raxa", "Myxa", "Trax", "Voxa", "Kron", "Zark"
];

const martianLastNames = [
  "Zorblax", "Kraven", "Vextor", "Morlok", "Xander", "Kryton", "Morpheus", "Nexus",
  "Zephyr", "Kronos", "Vector", "Maximus", "Blazor", "Krynn", "Vortex", "Quantum",
  "Nebula", "Cosmos", "Stellar", "Galax", "Meteor", "Comet", "Pulsar", "Quasar"
];

// Employer IDs from database
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

// Employment status IDs
const employmentStatusIds = {
  active: 'd73eb3ed-9837-4b7d-9504-b17c64f4ee33',
  terminated: '0c3080d5-a137-49ec-9d2d-a93687cafac6',
  disability: 'a31b3341-d052-45c2-9f79-c01155a61896'
};

// US States for addresses
const states = ['CA', 'TX', 'NY', 'FL', 'IL', 'PA', 'OH', 'GA', 'NC', 'MI', 'NJ', 'VA', 'WA', 'AZ', 'MA'];
const cities: { [key: string]: string[] } = {
  'CA': ['Los Angeles', 'San Diego', 'San Jose', 'San Francisco', 'Fresno'],
  'TX': ['Houston', 'San Antonio', 'Dallas', 'Austin', 'Fort Worth'],
  'NY': ['New York', 'Buffalo', 'Rochester', 'Yonkers', 'Syracuse'],
  'FL': ['Miami', 'Tampa', 'Orlando', 'Jacksonville', 'St Petersburg'],
  'IL': ['Chicago', 'Aurora', 'Naperville', 'Joliet', 'Rockford']
};

function getRandomInt(max: number): number {
  return Math.floor(Math.random() * max);
}

function getRandomElement<T>(array: T[]): T {
  return array[getRandomInt(array.length)];
}

function generateSSN(): string {
  const area = String(getRandomInt(900) + 100).padStart(3, '0');
  const group = String(getRandomInt(100)).padStart(2, '0');
  const serial = String(getRandomInt(10000)).padStart(4, '0');
  return `${area}-${group}-${serial}`;
}

function generatePhone(): string {
  const area = String(getRandomInt(900) + 100);
  const exchange = String(getRandomInt(900) + 100);
  const number = String(getRandomInt(10000)).padStart(4, '0');
  return `+1${area}${exchange}${number}`;
}

function generateAddress(): { street: string; city: string; state: string; postalCode: string; country: string } {
  const state = getRandomElement(states);
  const cityList = cities[state] || ['Springfield', 'Georgetown', 'Franklin'];
  const city = getRandomElement(cityList);
  const streetNumber = getRandomInt(9999) + 1;
  const streetNames = ['Mars Ave', 'Venus Blvd', 'Jupiter St', 'Saturn Way', 'Neptune Dr', 'Pluto Ln', 'Uranus Ct'];
  const street = `${streetNumber} ${getRandomElement(streetNames)}`;
  const postalCode = String(getRandomInt(90000) + 10000);
  
  return {
    street,
    city,
    state,
    postalCode,
    country: 'US'
  };
}

function generateWorkerName(): string {
  // 30% chance for a title-based name, 70% for first+last name
  if (Math.random() < 0.3) {
    return getRandomElement(martianTitles);
  } else {
    const firstName = getRandomElement(martianFirstNames);
    const lastName = getRandomElement(martianLastNames);
    return `${firstName} ${lastName}`;
  }
}

async function populateWorkers() {
  // Check how many workers already exist
  const existingWorkers = await storage.workers.getAllWorkers();
  const startCount = existingWorkers.length;
  const targetTotal = 100;
  const workersToCreate = Math.max(0, targetTotal - startCount);
  
  console.log(`🚀 Starting Martian Worker Population...`);
  console.log(`  Existing workers: ${startCount}`);
  console.log(`  Target total: ${targetTotal}`);
  console.log(`  Creating: ${workersToCreate} new workers\n`);

  if (workersToCreate === 0) {
    console.log('✅ Already have 100 or more workers. Nothing to do.');
    return;
  }

  for (let i = 0; i < workersToCreate; i++) {
    const workerName = generateWorkerName();
    
    try {
      console.log(`[${i + 1}/${workersToCreate}] Creating worker: ${workerName}`);
      
      // Create worker
      const worker = await storage.workers.createWorker(workerName);
      const contactId = worker.contactId;

      // 85% chance of SSN
      if (Math.random() < 0.85) {
        const ssn = generateSSN();
        await storage.workers.updateWorkerSSN(worker.id, ssn);
        console.log(`  ✓ SSN: ${ssn}`);
      }

      // 85% chance of primary phone
      if (Math.random() < 0.85) {
        const phone = generatePhone();
        await storage.contacts.phoneNumbers.createPhoneNumber({
          contactId,
          phoneNumber: phone,
          friendlyName: 'Primary',
          isPrimary: true,
          isActive: true
        });
        console.log(`  ✓ Phone: ${phone} (Primary)`);

        // 20% chance of additional phone
        if (Math.random() < 0.2) {
          const phone2 = generatePhone();
          const phoneTypes = ['Work', 'Mobile', 'Emergency'];
          await storage.contacts.phoneNumbers.createPhoneNumber({
            contactId,
            phoneNumber: phone2,
            friendlyName: getRandomElement(phoneTypes),
            isPrimary: false,
            isActive: true
          });
          console.log(`  ✓ Phone: ${phone2} (${getRandomElement(phoneTypes)})`);
        }
      }

      // 85% chance of primary address
      if (Math.random() < 0.85) {
        const address = generateAddress();
        await storage.contacts.addresses.createPostalAddress({
          contactId,
          ...address,
          friendlyName: 'Home',
          isPrimary: true,
          isActive: true
        });
        console.log(`  ✓ Address: ${address.street}, ${address.city}, ${address.state}`);

        // 20% chance of additional address
        if (Math.random() < 0.2) {
          const address2 = generateAddress();
          const addressTypes = ['Work', 'Mailing', 'Seasonal'];
          await storage.contacts.addresses.createPostalAddress({
            contactId,
            ...address2,
            friendlyName: getRandomElement(addressTypes),
            isPrimary: false,
            isActive: true
          });
          console.log(`  ✓ Address: ${address2.street}, ${address2.city}, ${address2.state} (Secondary)`);
        }
      }

      // 85% chance of work history
      if (Math.random() < 0.85) {
        // Randomly select 1 or 2 employers
        const numEmployers = Math.random() < 0.7 ? 1 : 2;
        const selectedEmployers: string[] = [];
        
        for (let e = 0; e < numEmployers; e++) {
          let employerId = getRandomElement(employerIds);
          // Make sure we don't select the same employer twice
          while (selectedEmployers.includes(employerId) && numEmployers > 1) {
            employerId = getRandomElement(employerIds);
          }
          selectedEmployers.push(employerId);
        }

        // Generate work history for the last 3-8 months
        const numMonths = getRandomInt(6) + 3; // 3-8 months
        const currentYear = 2025;
        const currentMonth = 11; // November

        let hoursCount = 0;
        for (const employerId of selectedEmployers) {
          // For each employer, generate a subset of the months
          const employerMonths = numEmployers === 1 
            ? numMonths 
            : Math.floor(numMonths / numEmployers) + getRandomInt(2);

          for (let m = 0; m < employerMonths; m++) {
            const monthOffset = numMonths - m - 1;
            let month = currentMonth - monthOffset;
            let year = currentYear;

            if (month <= 0) {
              month += 12;
              year -= 1;
            }

            // Generate random hours between 80-180 per month
            const hours = Math.floor(Math.random() * 100) + 80;
            
            // Most workers are active, some terminated
            const employmentStatusId = Math.random() < 0.9 
              ? employmentStatusIds.active 
              : employmentStatusIds.terminated;

            try {
              await storage.workers.createWorkerHours({
                workerId: worker.id,
                year,
                month,
                day: 1,
                employerId,
                employmentStatusId,
                hours
              });
              hoursCount++;
            } catch (error) {
              // Skip if hours already exist (shouldn't happen but just in case)
            }
          }
        }

        if (hoursCount > 0) {
          console.log(`  ✓ Work history: ${hoursCount} months across ${selectedEmployers.length} employer(s)`);
        }
      }

      console.log(`  ✅ Worker created successfully\n`);

    } catch (error: any) {
      console.error(`  ✗ Error creating ${workerName}:`, error.message);
    }
  }

  console.log('✅ Martian Worker Population Complete!');
  
  // Print summary
  const allWorkers = await storage.workers.getAllWorkers();
  console.log(`\n📊 Summary:`);
  console.log(`  Total workers: ${allWorkers.length}`);
}

// Run the script
populateWorkers()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
