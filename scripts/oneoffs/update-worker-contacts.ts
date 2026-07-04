import { db } from "../../server/db";
import { sql } from "drizzle-orm";

// DC Public Buildings for addresses
const dcPublicBuildings = [
  { name: "Martin Luther King Jr. Memorial Library", street: "901 G St NW", city: "Washington", state: "DC", zip: "20001" },
  { name: "DC Public Library - Georgetown", street: "3260 R St NW", city: "Washington", state: "DC", zip: "20007" },
  { name: "Anacostia Community Museum", street: "1901 Fort Pl SE", city: "Washington", state: "DC", zip: "20020" },
  { name: "National Museum of African American History", street: "1400 Constitution Ave NW", city: "Washington", state: "DC", zip: "20560" },
  { name: "Smithsonian National Air and Space Museum", street: "600 Independence Ave SW", city: "Washington", state: "DC", zip: "20560" },
  { name: "Library of Congress", street: "101 Independence Ave SE", city: "Washington", state: "DC", zip: "20540" },
  { name: "Union Station", street: "50 Massachusetts Ave NE", city: "Washington", state: "DC", zip: "20002" },
  { name: "Ronald Reagan Building", street: "1300 Pennsylvania Ave NW", city: "Washington", state: "DC", zip: "20004" },
  { name: "National Archives", street: "700 Pennsylvania Ave NW", city: "Washington", state: "DC", zip: "20408" },
  { name: "US Capitol Visitor Center", street: "1st St SE", city: "Washington", state: "DC", zip: "20515" },
  { name: "DC Department of Employment Services", street: "4058 Minnesota Ave NE", city: "Washington", state: "DC", zip: "20019" },
  { name: "DC Public Library - Petworth", street: "4200 Kansas Ave NW", city: "Washington", state: "DC", zip: "20011" },
  { name: "DC Recreation Center - Capitol Hill", street: "635 North Carolina Ave SE", city: "Washington", state: "DC", zip: "20003" },
  { name: "DC Public Library - Woodridge", street: "1801 Hamlin St NE", city: "Washington", state: "DC", zip: "20018" },
  { name: "National Postal Museum", street: "2 Massachusetts Ave NE", city: "Washington", state: "DC", zip: "20002" },
  { name: "Smithsonian Castle", street: "1000 Jefferson Dr SW", city: "Washington", state: "DC", zip: "20560" },
  { name: "DC Public Library - West End", street: "2301 L St NW", city: "Washington", state: "DC", zip: "20037" },
  { name: "DC Public Library - Southeast", street: "403 7th St SE", city: "Washington", state: "DC", zip: "20003" },
  { name: "DC Public Library - Shaw", street: "1630 7th St NW", city: "Washington", state: "DC", zip: "20001" },
  { name: "National Building Museum", street: "401 F St NW", city: "Washington", state: "DC", zip: "20001" },
  { name: "DC Public Library - Chevy Chase", street: "5625 Connecticut Ave NW", city: "Washington", state: "DC", zip: "20015" },
  { name: "DC Recreation Center - Marie Reed", street: "2200 Champlain St NW", city: "Washington", state: "DC", zip: "20009" },
  { name: "DC Public Library - Tenley-Friendship", street: "4450 Wisconsin Ave NW", city: "Washington", state: "DC", zip: "20016" },
  { name: "DC Public Library - Mount Pleasant", street: "3160 16th St NW", city: "Washington", state: "DC", zip: "20010" },
  { name: "DC Public Library - Northeast", street: "330 7th St NE", city: "Washington", state: "DC", zip: "20002" },
];

// Generate random DC phone number (202 area code)
function generateDCPhone(): string {
  const exchange = Math.floor(Math.random() * 900) + 100; // 100-999
  const lineNumber = Math.floor(Math.random() * 9000) + 1000; // 1000-9999
  return `+1202${exchange}${lineNumber}`;
}

// Track used emails to handle duplicates
const usedEmails = new Set<string>();

// Generate email from name
function generateEmail(given: string | null, family: string | null): string {
  if (!given || !family) {
    const randomEmail = `worker${Math.random().toString(36).substring(7)}@dclegal.fake`;
    usedEmails.add(randomEmail);
    return randomEmail;
  }
  
  const firstInitial = given.charAt(0).toLowerCase();
  const lastName = family.toLowerCase().replace(/\s+/g, '');
  let email = `${firstInitial}${lastName}@dclegal.fake`;
  
  // Handle duplicates by adding a number
  let counter = 1;
  while (usedEmails.has(email)) {
    email = `${firstInitial}${lastName}${counter}@dclegal.fake`;
    counter++;
  }
  
  usedEmails.add(email);
  return email;
}

async function updateWorkerContacts() {
  console.log("Fetching all workers...");
  
  // Get all workers with their contact info
  const workers = await db.execute(sql`
    SELECT w.id as worker_id, w.contact_id, c.given, c.family, c.email
    FROM workers w
    INNER JOIN contacts c ON w.contact_id = c.id
    ORDER BY c.family, c.given
  `);
  
  console.log(`Found ${workers.rows.length} workers`);
  
  let updatedContacts = 0;
  let updatedPhones = 0;
  let updatedAddresses = 0;
  
  for (let i = 0; i < workers.rows.length; i++) {
    const worker = workers.rows[i] as any;
    const building = dcPublicBuildings[i % dcPublicBuildings.length];
    
    // Generate contact info
    const email = generateEmail(worker.given, worker.family);
    const phone = generateDCPhone();
    
    try {
      // Update email in contacts table
      await db.execute(sql`
        UPDATE contacts
        SET email = ${email}
        WHERE id = ${worker.contact_id}
      `);
      updatedContacts++;
      
      // Delete existing phone numbers for this contact
      await db.execute(sql`
        DELETE FROM contact_phone
        WHERE contact_id = ${worker.contact_id}
      `);
      
      // Insert new phone number
      await db.execute(sql`
        INSERT INTO contact_phone (id, contact_id, phone_number, is_primary, created_at)
        VALUES (gen_random_uuid(), ${worker.contact_id}, ${phone}, true, now())
      `);
      updatedPhones++;
      
      // Delete existing addresses for this contact
      await db.execute(sql`
        DELETE FROM contact_postal
        WHERE contact_id = ${worker.contact_id}
      `);
      
      // Insert new address
      await db.execute(sql`
        INSERT INTO contact_postal (
          id, contact_id, friendly_name, street, city, state, 
          postal_code, country, is_primary, is_active, created_at
        )
        VALUES (
          gen_random_uuid(), ${worker.contact_id}, ${building.name}, ${building.street}, 
          ${building.city}, ${building.state}, ${building.zip}, 
          'US', true, true, now()
        )
      `);
      updatedAddresses++;
      
      if ((i + 1) % 50 === 0) {
        console.log(`Progress: ${i + 1}/${workers.rows.length} workers updated`);
      }
    } catch (error) {
      console.error(`Error updating worker ${worker.worker_id}:`, error);
    }
  }
  
  console.log("\n=== Update Complete ===");
  console.log(`Updated ${updatedContacts} contact emails`);
  console.log(`Updated ${updatedPhones} phone numbers`);
  console.log(`Updated ${updatedAddresses} addresses`);
  console.log(`Total workers processed: ${workers.rows.length}`);
}

// Run the update
updateWorkerContacts()
  .then(() => {
    console.log("\nScript completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\nScript failed:", error);
    process.exit(1);
  });
