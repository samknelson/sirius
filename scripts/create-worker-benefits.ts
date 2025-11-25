import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function createWorkerBenefits() {
  console.log("Creating legal benefits for 349 workers...");
  
  // Get legal benefit type ID
  const benefitTypeResult = await db.execute(sql`
    SELECT id FROM options_trust_benefit_type WHERE name = 'Legal' LIMIT 1
  `);
  
  if (benefitTypeResult.rows.length === 0) {
    console.error("Legal benefit type not found!");
    process.exit(1);
  }
  
  const legalTypeId = benefitTypeResult.rows[0].id as string;
  console.log(`Legal benefit type ID: ${legalTypeId}`);
  
  // Get or create a legal benefit
  let benefitResult = await db.execute(sql`
    SELECT id FROM trust_benefits 
    WHERE benefit_type = ${legalTypeId} 
    AND is_active = true
    LIMIT 1
  `);
  
  let benefitId: string;
  
  if (benefitResult.rows.length === 0) {
    console.log("Creating new legal benefit...");
    const newBenefit = await db.execute(sql`
      INSERT INTO trust_benefits (name, benefit_type, is_active)
      VALUES ('Legal Representation Services', ${legalTypeId}, true)
      RETURNING id
    `);
    benefitId = newBenefit.rows[0].id as string;
    console.log(`Created benefit ID: ${benefitId}`);
  } else {
    benefitId = benefitResult.rows[0].id as string;
    console.log(`Using existing benefit ID: ${benefitId}`);
  }
  
  // Get all employers
  const employers = await db.execute(sql`
    SELECT id, name FROM employers WHERE is_active = true ORDER BY name
  `);
  
  console.log(`Found ${employers.rows.length} active employers`);
  
  // Get 349 workers with their employer relationships
  const workersWithEmployers = await db.execute(sql`
    SELECT
      w.id as worker_id,
      wh.employer_id,
      e.name as employer_name,
      ROW_NUMBER() OVER (PARTITION BY w.id ORDER BY RANDOM()) as rn
    FROM workers w
    INNER JOIN worker_hours wh ON w.id = wh.worker_id
    INNER JOIN employers e ON wh.employer_id = e.id
    WHERE e.is_active = true
  `);
  
  // Filter to get only one relationship per worker (randomly chosen) and limit to 349
  const uniqueWorkerRelationships = workersWithEmployers.rows
    .filter((row: any) => Number(row.rn) === 1)
    .slice(0, 349);
  
  console.log(`Selected ${uniqueWorkerRelationships.length} unique worker-employer relationships`);
  
  // Current date info for benefits
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  
  let created = 0;
  let skipped = 0;
  let errors = 0;
  
  for (const row of uniqueWorkerRelationships) {
    const workerId = row.worker_id as string;
    const employerId = row.employer_id as string;
    const employerName = row.employer_name as string;
    
    try {
      // Check if benefit already exists for this worker/employer/month/year
      const existing = await db.execute(sql`
        SELECT id FROM trust_wmb
        WHERE worker_id = ${workerId}
          AND employer_id = ${employerId}
          AND benefit_id = ${benefitId}
          AND month = ${month}
          AND year = ${year}
      `);
      
      if (existing.rows.length > 0) {
        skipped++;
        continue;
      }
      
      // Create the benefit assignment
      await db.execute(sql`
        INSERT INTO trust_wmb (worker_id, month, year, employer_id, benefit_id)
        VALUES (${workerId}, ${month}, ${year}, ${employerId}, ${benefitId})
      `);
      
      created++;
      if (created % 50 === 0) {
        console.log(`Progress: ${created} benefits created (${employerName})...`);
      }
    } catch (error) {
      console.error(`Error creating benefit for worker ${workerId}:`, error);
      errors++;
    }
  }
  
  console.log("\n=== Summary ===");
  console.log(`Total processed: ${uniqueWorkerRelationships.length}`);
  console.log(`Benefits created: ${created}`);
  console.log(`Skipped (already exists): ${skipped}`);
  console.log(`Errors: ${errors}`);
  
  // Show employer distribution
  const distribution = await db.execute(sql`
    SELECT 
      e.name as employer_name,
      COUNT(*) as benefit_count
    FROM trust_wmb wmb
    INNER JOIN employers e ON wmb.employer_id = e.id
    WHERE wmb.benefit_id = ${benefitId}
      AND wmb.month = ${month}
      AND wmb.year = ${year}
    GROUP BY e.id, e.name
    ORDER BY benefit_count DESC
  `);
  
  console.log("\n=== Employer Distribution ===");
  for (const row of distribution.rows) {
    console.log(`${row.employer_name}: ${row.benefit_count} workers`);
  }
  
  process.exit(0);
}

createWorkerBenefits().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
