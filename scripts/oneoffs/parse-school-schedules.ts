import fs from 'fs';
import path from 'path';

interface ScheduleEntry {
  label: string;
  startTime: string;
  endTime: string;
  note: string | null;
}

interface SchoolScheduleData {
  region: string;
  schoolName: string;
  schedules: ScheduleEntry[];
  originalNotes: string;
}

function normalizeTime(timeStr: string): string {
  let t = timeStr.trim().toLowerCase();
  t = t.replace(/\s+/g, '');
  t = t.replace(/am/g, ' AM').replace(/pm/g, ' PM');
  t = t.replace(/a\.m\./g, ' AM').replace(/p\.m\./g, ' PM');
  t = t.replace(/\s+/g, ' ').trim();
  
  const match = t.match(/^(\d{1,2})(?::(\d{2}))?(?:\s*(am|pm))?$/i);
  if (match) {
    let hour = parseInt(match[1]);
    const min = match[2] || '00';
    const period = (match[3] || '').toUpperCase();
    
    if (period) {
      return `${hour}:${min} ${period}`;
    }
    return `${hour}:${min}`;
  }
  return timeStr.trim();
}

function parseTimeRange(text: string): { startTime: string; endTime: string; note: string | null } | null {
  const cleaned = text.trim();
  if (!cleaned) return null;
  
  const timeRangePatterns = [
    /^(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)?)\s*[-–—to]\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)?)(.*)$/i,
    /^(\d{1,2}(?::\d{2})?)\s*[-–—]\s*(\d{1,2}(?::\d{2})?)(.*)$/,
  ];
  
  for (const pattern of timeRangePatterns) {
    const match = cleaned.match(pattern);
    if (match) {
      const startTime = normalizeTime(match[1]);
      const endTime = normalizeTime(match[2]);
      const remainder = match[3]?.trim() || null;
      
      if (startTime.match(/\d/) && endTime.match(/\d/)) {
        return { startTime, endTime, note: remainder || null };
      }
    }
  }
  
  return null;
}

function extractSchedulesFromCell(cellValue: string, columnLabel: string): ScheduleEntry[] {
  if (!cellValue || cellValue.trim() === '') return [];
  
  const schedules: ScheduleEntry[] = [];
  const lines = cellValue.split(/[\n,;]|(?:\s+(?:and|or|&)\s+)/i)
    .map(l => l.trim())
    .filter(l => l.length > 0);
  
  const timeEntries: { startTime: string; endTime: string; note: string | null }[] = [];
  const nonTimeNotes: string[] = [];
  
  for (const line of lines) {
    const parsed = parseTimeRange(line);
    if (parsed) {
      timeEntries.push(parsed);
    } else if (line.length > 0 && !line.match(/^\s*$/)) {
      const earlyDismissalMatch = line.match(/early\s*dismissal\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
      if (earlyDismissalMatch) {
        nonTimeNotes.push(`Early Dismissal: ${earlyDismissalMatch[1]}`);
      } else {
        nonTimeNotes.push(line);
      }
    }
  }
  
  if (timeEntries.length === 0 && nonTimeNotes.length > 0) {
    return [];
  }
  
  const combinedNote = nonTimeNotes.length > 0 ? nonTimeNotes.join('; ') : null;
  
  for (let i = 0; i < timeEntries.length; i++) {
    const entry = timeEntries[i];
    const label = timeEntries.length > 1 ? `${columnLabel} ${i + 1}` : columnLabel;
    const entryNote = entry.note 
      ? (combinedNote ? `${entry.note}; ${combinedNote}` : entry.note)
      : combinedNote;
    
    schedules.push({
      label,
      startTime: entry.startTime,
      endTime: entry.endTime,
      note: entryNote,
    });
  }
  
  return schedules;
}

function parseCSV(content: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;
  
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1];
    
    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        currentCell += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        currentCell += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        currentRow.push(currentCell);
        currentCell = '';
      } else if (char === '\n' || (char === '\r' && nextChar === '\n')) {
        if (char === '\r') i++;
        currentRow.push(currentCell);
        if (currentRow.some(c => c.trim().length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentCell = '';
      } else if (char !== '\r') {
        currentCell += char;
      }
    }
  }
  
  currentRow.push(currentCell);
  if (currentRow.some(c => c.trim().length > 0)) {
    rows.push(currentRow);
  }
  
  return rows;
}

function main() {
  const csvPath = path.join(process.cwd(), 'attached_assets/School_Workday_Times_by_employee_Group_SY26_-_Sheet1_1769933619759.csv');
  const content = fs.readFileSync(csvPath, 'utf-8');
  
  const rows = parseCSV(content);
  const header = rows[0];
  const dataRows = rows.slice(1);
  
  console.log(`Parsed ${dataRows.length} schools from CSV\n`);
  console.log(`Columns: ${header.join(', ')}\n`);
  
  const columnLabels = ['School Hours', 'Teacher', 'Para', 'Nurse', 'Family Liaison', 'Specialist'];
  const columnIndices = [2, 3, 4, 5, 6, 7];
  
  const allSchools: SchoolScheduleData[] = [];
  
  for (const row of dataRows) {
    const region = row[0]?.trim() || '';
    const schoolName = row[1]?.trim() || '';
    const originalNotes = row[8]?.trim() || '';
    
    if (!schoolName) continue;
    
    const schedules: ScheduleEntry[] = [];
    
    for (let i = 0; i < columnLabels.length; i++) {
      const cellValue = row[columnIndices[i]] || '';
      const label = columnLabels[i];
      const entries = extractSchedulesFromCell(cellValue, label);
      schedules.push(...entries);
    }
    
    allSchools.push({
      region,
      schoolName,
      schedules,
      originalNotes,
    });
  }
  
  const outputPath = path.join(process.cwd(), 'attached_assets/parsed-school-schedules.json');
  fs.writeFileSync(outputPath, JSON.stringify(allSchools, null, 2));
  
  console.log(`\nGenerated ${allSchools.length} school schedule records`);
  console.log(`Output saved to: ${outputPath}`);
  
  console.log('\n=== SAMPLE OUTPUT (first 3 schools) ===\n');
  for (const school of allSchools.slice(0, 3)) {
    console.log(`\n--- ${school.schoolName} (Region ${school.region}) ---`);
    if (school.originalNotes) {
      console.log(`Original Notes: ${school.originalNotes}`);
    }
    console.log('Schedules:');
    for (const sched of school.schedules) {
      console.log(`  - ${sched.label}: ${sched.startTime} - ${sched.endTime}${sched.note ? ` (Note: ${sched.note})` : ''}`);
    }
  }
  
  let totalSchedules = 0;
  let schoolsWithSchedules = 0;
  for (const school of allSchools) {
    totalSchedules += school.schedules.length;
    if (school.schedules.length > 0) schoolsWithSchedules++;
  }
  
  console.log(`\n=== SUMMARY ===`);
  console.log(`Total schools: ${allSchools.length}`);
  console.log(`Schools with schedules: ${schoolsWithSchedules}`);
  console.log(`Total schedule entries: ${totalSchedules}`);
  console.log(`Average schedules per school: ${(totalSchedules / schoolsWithSchedules).toFixed(1)}`);
}

main();
