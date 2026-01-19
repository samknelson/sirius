import { storage } from '../server/storage/database';
import { db } from '../server/storage/db';
import { workers, optionsWorkerMs, optionsIndustry } from '../shared/schema';

interface MemberStatus {
  id: string;
  name: string;
  industryId: string;
}

interface Industry {
  id: string;
  name: string;
}

function getRandomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getRandomElement<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

function generateRandomDate(startYear: number, endYear: number): string {
  const year = getRandomInt(startYear, endYear);
  const month = getRandomInt(1, 12);
  const day = getRandomInt(1, 28);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

async function seedWorkerMsh() {
  console.log('Starting worker member status history seeding...');

  const allWorkers = await db.select({ id: workers.id }).from(workers);
  console.log(`Found ${allWorkers.length} workers`);

  const memberStatuses = await db.select({
    id: optionsWorkerMs.id,
    name: optionsWorkerMs.name,
    industryId: optionsWorkerMs.industryId,
  }).from(optionsWorkerMs);
  console.log(`Found ${memberStatuses.length} member statuses`);

  const industries = await db.select({
    id: optionsIndustry.id,
    name: optionsIndustry.name,
  }).from(optionsIndustry);
  console.log(`Found ${industries.length} industries`);

  const statusesByIndustry = new Map<string, MemberStatus[]>();
  for (const ms of memberStatuses) {
    const list = statusesByIndustry.get(ms.industryId) || [];
    list.push(ms);
    statusesByIndustry.set(ms.industryId, list);
  }

  const industriesWithStatuses = industries.filter(ind => statusesByIndustry.has(ind.id));
  console.log(`Industries with member statuses: ${industriesWithStatuses.map(i => i.name).join(', ')}`);

  const shuffledWorkers = shuffleArray(allWorkers);
  const targetCount = Math.floor(shuffledWorkers.length * 0.80);
  const selectedWorkers = shuffledWorkers.slice(0, targetCount);
  console.log(`Selected ${selectedWorkers.length} workers (80%) for member status history`);

  let totalEntriesCreated = 0;
  let statusDistribution: Record<string, number> = {};

  for (let i = 0; i < selectedWorkers.length; i++) {
    const worker = selectedWorkers[i];
    const numEntries = getRandomInt(1, 6);
    
    const workerIndustries = shuffleArray(industriesWithStatuses).slice(0, getRandomInt(1, industriesWithStatuses.length));
    
    const dates = new Set<string>();
    const entriesPerIndustry = new Map<string, Set<string>>();
    
    for (const industry of workerIndustries) {
      entriesPerIndustry.set(industry.id, new Set());
    }
    
    let entriesForWorker = 0;
    let attempts = 0;
    const maxAttempts = numEntries * 10;
    
    while (entriesForWorker < numEntries && attempts < maxAttempts) {
      attempts++;
      
      const industry = getRandomElement(workerIndustries);
      const industryStatuses = statusesByIndustry.get(industry.id);
      if (!industryStatuses || industryStatuses.length === 0) continue;
      
      const memberStatus = getRandomElement(industryStatuses);
      const date = generateRandomDate(1995, 2025);
      
      const industryDates = entriesPerIndustry.get(industry.id)!;
      if (industryDates.has(date)) continue;
      
      try {
        await storage.workerMsh.createWorkerMsh({
          workerId: worker.id,
          date,
          msId: memberStatus.id,
          industryId: industry.id,
        });
        
        industryDates.add(date);
        entriesForWorker++;
        totalEntriesCreated++;
        
        statusDistribution[memberStatus.name] = (statusDistribution[memberStatus.name] || 0) + 1;
      } catch (error: any) {
        if (error.message?.includes('duplicate') || error.code === '23505') {
          continue;
        }
        console.error(`Error creating entry for worker ${worker.id}:`, error.message);
      }
    }
    
    if ((i + 1) % 20 === 0) {
      console.log(`Progress: ${i + 1}/${selectedWorkers.length} workers processed, ${totalEntriesCreated} entries created`);
    }
  }

  console.log('\n=== Seeding Complete ===');
  console.log(`Total entries created: ${totalEntriesCreated}`);
  console.log('\nStatus distribution:');
  for (const [status, count] of Object.entries(statusDistribution).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${status}: ${count}`);
  }
}

seedWorkerMsh()
  .then(() => {
    console.log('\nDone!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
