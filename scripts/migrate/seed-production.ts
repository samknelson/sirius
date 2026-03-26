import { execSync } from 'child_process';
import path from 'path';

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

async function main() {
  const checkResult = execSync(
    `psql "${dbUrl}" -t -c "SELECT count(*) FROM employers" 2>/dev/null`,
    { encoding: 'utf-8' }
  ).trim();

  const count = parseInt(checkResult, 10);
  if (count > 0) {
    console.log(`Production database already has ${count} employers — skipping seed.`);
    return;
  }

  console.log('Production database is empty — importing data seed...');
  const seedFile = path.join(__dirname, 'production_data_seed.sql');

  try {
    const output = execSync(`psql "${dbUrl}" -f "${seedFile}" 2>&1`, {
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
    });
    console.log('Data seed import complete.');
    console.log(output.slice(-500));
  } catch (err: any) {
    console.error('Data seed import failed:', err.message);
    if (err.stdout) console.error(err.stdout.slice(-1000));
    process.exit(1);
  }
}

main();
