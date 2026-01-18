import { storage } from '../server/storage/database';
import { db } from '../server/storage/db';
import { optionsDepartment, type Employer, type Worker } from '../shared/schema';

const martianSheetTitles = [
  "Operation Red Dawn",
  "Phobos Assault Squad",
  "Olympus Mons Deployment",
  "Valles Marineris Strike",
  "Deimos Reconnaissance Unit",
  "Hellas Basin Conquest",
  "Syrtis Major Offensive",
  "Elysium Planitia Force",
  "Tharsis Bulge Brigade",
  "Chryse Planitia Campaign",
  "Acidalia Planitia Sweep",
  "Amazonis Planitia March",
  "Arcadia Planitia Patrol",
  "Isidis Planitia Assault",
  "Utopia Planitia Invasion",
  "Argyre Basin Operation",
  "Noachis Terra Offensive",
  "Meridiani Planum Strike",
  "Gale Crater Deployment",
  "Jezero Crater Assault",
  "Arabia Terra Conquest",
  "Cydonia Mensae Mission",
  "Noctis Labyrinthus Patrol",
  "Coprates Chasma Force",
  "Candor Chasma Strike",
  "Ophir Chasma Brigade",
  "Melas Chasma Assault",
  "Ius Chasma Operation",
  "Capri Chasma Sweep",
  "Eos Chasma Campaign",
  "Hebes Chasma March",
  "Juventae Chasma Patrol",
  "Ganges Chasma Force",
  "Kasei Valles Strike",
  "Ares Vallis Deployment",
  "Ma'adim Vallis Assault",
  "Nirgal Vallis Conquest",
  "Nanedi Vallis Mission",
  "Shalbatana Vallis Patrol",
  "Simud Vallis Operation",
  "Tiu Vallis Campaign",
  "Maja Vallis Force",
  "Mawrth Vallis Strike",
  "Dao Vallis Brigade",
  "Niger Vallis Assault",
  "Harmakhis Vallis Sweep",
  "Reull Vallis March",
  "Evros Vallis Patrol",
  "Mangala Valles Force",
  "Al-Qahira Vallis Strike"
];

const martianCrewTitles = [
  "Alpha Martian Detachment",
  "Beta Invasion Unit",
  "Gamma Strike Force",
  "Delta Conquest Squad",
  "Epsilon Assault Team",
  "Zeta Recon Patrol",
  "Eta Combat Unit",
  "Theta Defense Force",
  "Iota Siege Brigade",
  "Kappa Landing Party",
  "Lambda Occupation Force",
  "Mu Demolition Crew",
  "Nu Engineering Squad",
  "Xi Supply Unit",
  "Omicron Scout Team",
  "Pi Communications Unit",
  "Rho Medical Corps",
  "Sigma Heavy Assault",
  "Tau Rapid Response",
  "Upsilon Special Ops",
  "Phi Armored Division",
  "Chi Air Support",
  "Psi Artillery Battery",
  "Omega Elite Guard",
  "War Machine Operators",
  "Heat-Ray Technicians",
  "Tripod Pilots",
  "Black Smoke Handlers",
  "Red Weed Planters",
  "Cylinder Excavators",
  "Fighting-Machine Crew",
  "Handling-Machine Team",
  "Flying-Machine Squadron",
  "Martian Scouts",
  "Earth Subjugation Team",
  "Human Resistance Suppressors",
  "Resource Extraction Unit",
  "Atmospheric Processors",
  "Terrain Modifiers",
  "Defense Grid Operators"
];

const martianLocations = [
  "Olympus Base Camp",
  "Valles Forward Operating Base",
  "Tharsis Command Center",
  "Elysium Outpost",
  "Hellas Crater Station",
  "Cydonia Landing Zone",
  "Noctis Underground Bunker",
  "Acidalia Supply Depot",
  "Chryse Communications Hub",
  "Utopia Processing Facility",
  "Argyre Medical Station",
  "Syrtis Armory",
  "Amazonis Training Ground",
  "Arcadia Research Lab",
  "Isidis Staging Area"
];

const statuses: string[] = ["draft", "request", "lock", "trash", "reserved"];

function getRandomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getRandomElement<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

function generateYmd(month: number, day: number): string {
  return `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function generateTime(hour: number, minute: number = 0): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
}

async function main() {
  console.log("Starting EDLS sheet population script...");

  const employers: Employer[] = await storage.employers.getAllEmployers();
  if (employers.length === 0) {
    console.error("No employers found. Please create employers first.");
    process.exit(1);
  }
  console.log(`Found ${employers.length} employers`);

  const departments = await db.select().from(optionsDepartment);
  if (departments.length === 0) {
    console.error("No departments found. Please create departments first.");
    process.exit(1);
  }
  console.log(`Found ${departments.length} departments`);

  const allWorkers = await storage.workers.getAllWorkers();
  if (allWorkers.length === 0) {
    console.error("No workers found. Please create workers first.");
    process.exit(1);
  }
  console.log(`Found ${allWorkers.length} workers to assign`);

  const usedTitles = new Set<string>();
  const usedDates = new Map<string, Set<string>>();
  let totalSheetsCreated = 0;
  let totalCrewsCreated = 0;
  let totalAssignmentsCreated = 0;

  for (let i = 0; i < 50; i++) {
    const employer = getRandomElement(employers);
    const department = getRandomElement(departments);
    
    let title = getRandomElement(martianSheetTitles);
    let suffix = 1;
    while (usedTitles.has(title)) {
      title = `${getRandomElement(martianSheetTitles)} ${suffix}`;
      suffix++;
    }
    usedTitles.add(title);

    const month = getRandomInt(1, 2);
    const maxDay = month === 1 ? 31 : 28;
    let day = getRandomInt(1, maxDay);
    let ymd = generateYmd(month, day);
    
    const dateKey = `${employer.id}-${ymd}`;
    if (!usedDates.has(employer.id)) {
      usedDates.set(employer.id, new Set());
    }
    while (usedDates.get(employer.id)!.has(ymd)) {
      day = getRandomInt(1, maxDay);
      ymd = generateYmd(month, day);
    }
    usedDates.get(employer.id)!.add(ymd);

    const status = getRandomElement(statuses);

    const numCrews = getRandomInt(1, 5);
    const crews: Array<{
      title: string;
      workerCount: number;
      location: string | null;
      startTime: string;
      endTime: string;
      supervisor: string | null;
      taskId: string | null;
    }> = [];
    
    let totalWorkerCount = 0;
    const usedCrewTitles = new Set<string>();
    
    for (let j = 0; j < numCrews; j++) {
      let crewTitle = getRandomElement(martianCrewTitles);
      let crewSuffix = 1;
      while (usedCrewTitles.has(crewTitle)) {
        crewTitle = `${getRandomElement(martianCrewTitles)} ${crewSuffix}`;
        crewSuffix++;
      }
      usedCrewTitles.add(crewTitle);

      const minWorkers = j === numCrews - 1 ? Math.max(1, 5 - totalWorkerCount) : 1;
      const maxWorkers = j === numCrews - 1 ? Math.max(minWorkers, 100 - totalWorkerCount) : Math.min(30, 100 - totalWorkerCount - (numCrews - j - 1));
      const workerCount = getRandomInt(minWorkers, Math.max(minWorkers, maxWorkers));
      totalWorkerCount += workerCount;

      const startHour = getRandomInt(5, 14);
      const endHour = startHour + getRandomInt(4, 10);

      crews.push({
        title: crewTitle,
        workerCount,
        location: Math.random() > 0.3 ? getRandomElement(martianLocations) : null,
        startTime: generateTime(startHour),
        endTime: generateTime(Math.min(endHour, 23)),
        supervisor: null,
        taskId: null,
      });
    }

    if (totalWorkerCount < 5) {
      crews[0].workerCount += (5 - totalWorkerCount);
      totalWorkerCount = 5;
    }
    if (totalWorkerCount > 100) {
      const excess = totalWorkerCount - 100;
      crews[crews.length - 1].workerCount -= excess;
      totalWorkerCount = 100;
    }

    try {
      const sheet = await storage.edlsSheets.create(
        {
          employerId: employer.id,
          departmentId: department.id,
          title,
          ymd,
          workerCount: totalWorkerCount,
          status,
        },
        crews
      );

      totalSheetsCreated++;
      totalCrewsCreated += crews.length;
      console.log(`Created sheet ${i + 1}/50: "${title}" (${status}) with ${crews.length} crews, ${totalWorkerCount} slots`);

      if (status !== "trash") {
        const employerWorkers = allWorkers.filter(w => w.denormHomeEmployerId === employer.id);
        if (employerWorkers.length > 0) {
          const availableWorkers = [...employerWorkers];
          const shuffledWorkers = availableWorkers.sort(() => Math.random() - 0.5);
          
          const assignmentPercentage = getRandomInt(30, 90) / 100;
          const targetAssignments = Math.floor(totalWorkerCount * assignmentPercentage);
          let assignmentsCreated = 0;

          for (const crew of sheet.crews) {
            const crewAssignmentTarget = Math.floor(crew.workerCount * assignmentPercentage);
            
            for (let k = 0; k < crewAssignmentTarget && shuffledWorkers.length > 0; k++) {
              const worker = shuffledWorkers.pop()!;
              try {
                await storage.edlsAssignments.create({
                  crewId: crew.id,
                  workerId: worker.id,
                  ymd,
                });
                assignmentsCreated++;
                totalAssignmentsCreated++;
              } catch (error) {
              }
            }
          }
          console.log(`  - Created ${assignmentsCreated} assignments`);
        }
      }
    } catch (error) {
      console.error(`Failed to create sheet "${title}":`, error);
    }
  }

  console.log("\n=== Population Complete ===");
  console.log(`Sheets created: ${totalSheetsCreated}`);
  console.log(`Crews created: ${totalCrewsCreated}`);
  console.log(`Assignments created: ${totalAssignmentsCreated}`);
  process.exit(0);
}

main().catch((error) => {
  console.error("Script failed:", error);
  process.exit(1);
});
