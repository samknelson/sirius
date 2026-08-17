// Script to generate S1 rehearsal reject triage workbook
// Run with: node scripts/oneoffs/generate-triage-xlsx.mjs

import ExcelJS from 'exceljs';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ===== PARSED RUN DATA =====
const runs = [
  { runName: 't29-enrollment-packet-tags', started: '8/11/2026, 4:17:53 PM', duration: '133.2s', outcome: 'verified', rejects: {}, hasNoneRejects: true },
  { runName: 'n21-call-logs', started: '8/11/2026, 4:14:24 PM', duration: '111.5s', outcome: 'verified', rejects: { handler_dangling: 2 }, hasNoneRejects: false },
  { runName: 'n21-call-logs', started: '8/11/2026, 4:08:09 PM', duration: '169s', outcome: 'verified', rejects: { handler_dangling: 2 }, hasNoneRejects: false },
  { runName: 'n21-call-logs', started: '8/11/2026, 1:31:13 PM', duration: '182.7s', outcome: 'verified', rejects: { handler_dangling: 2, category_unmapped: 2 }, hasNoneRejects: false },
  { runName: 'n21-call-logs', started: '8/11/2026, 12:59:54 PM', duration: '406.8s', outcome: 'verified', rejects: { handler_dangling: 2, category_unmapped: 7 }, hasNoneRejects: false },
  { runName: 'n21-call-logs', started: '8/11/2026, 11:44:29 AM', duration: '61.8s', outcome: 'verified', rejects: { category_unmapped: 700, handler_unresolved: 9202 }, hasNoneRejects: false },
  { runName: 't29-enrollment-packet-tags', started: '8/11/2026, 10:30:03 AM', duration: '83.4s', outcome: 'verified', rejects: {}, hasNoneRejects: true },
  { runName: 't20-hours', started: '8/9/2026, 5:08:00 PM', duration: '142557.4s', outcome: 'completed', rejects: {}, hasNoneRejects: true },
  { runName: 't17-benefit-history', started: '8/9/2026, 4:33:32 PM', duration: '1263.7s', outcome: 'verified', rejects: { start_missing: 16, worker_unmapped: 452, benefit_unmapped: 6863, end_before_start: 2553, relation_unmapped: 71964, benefit_ref_missing: 41, employer_unresolved: 1462, subscriber_worker_mismatch: 69 }, hasNoneRejects: false },
  { runName: 't17-benefit-history', started: '8/9/2026, 11:58:15 AM', duration: '16172.5s', outcome: 'verified', rejects: { start_missing: 16, worker_unmapped: 452, benefit_unmapped: 6863, end_before_start: 2553, relation_unmapped: 71964, benefit_ref_missing: 41, employer_unresolved: 1462, subscriber_worker_mismatch: 69 }, hasNoneRejects: false },
  { runName: 't16-elections', started: '8/9/2026, 11:29:39 AM', duration: '1399.8s', outcome: 'verified', rejects: { start_missing: 3, worker_unmapped: 234, benefit_unmapped: 54, relation_unmapped: 22, worker_ref_missing: 3, end_not_after_start: 625, employer_ref_missing: 2 }, hasNoneRejects: false },
  { runName: 't17-benefit-history', started: '8/8/2026, 10:29:04 PM', duration: '17754s', outcome: 'verified', rejects: { start_missing: 16, worker_unmapped: 452, benefit_unmapped: 6863, end_before_start: 2553, relation_unmapped: 71964, benefit_ref_missing: 41, employer_unresolved: 35103, open_end_through_required: 159735, subscriber_worker_mismatch: 69 }, hasNoneRejects: false },
  { runName: 't16-elections', started: '8/8/2026, 10:25:40 PM', duration: '36.1s', outcome: 'verified', rejects: { start_missing: 3, worker_unmapped: 234, benefit_unmapped: 54, relation_unmapped: 22, worker_ref_missing: 3, end_not_after_start: 625, employer_ref_missing: 2 }, hasNoneRejects: false },
  { runName: 't-employer-rates', started: '8/8/2026, 10:20:32 PM', duration: '2.5s', outcome: 'verified', rejects: { bad_rate: 2, rate_conflict: 1 }, hasNoneRejects: false },
  { runName: 't-employer-policies', started: '8/8/2026, 10:13:52 PM', duration: '3.4s', outcome: 'verified', rejects: { policy_unmapped: 2 }, hasNoneRejects: false },
  { runName: 't-employer-rates', started: '8/8/2026, 10:08:57 PM', duration: '4.4s', outcome: 'verified', rejects: { bad_rate: 2, rate_conflict: 1 }, hasNoneRejects: false },
  { runName: 't-employer-policies', started: '8/8/2026, 9:56:41 PM', duration: '6.3s', outcome: 'verified', rejects: { policy_unmapped: 2 }, hasNoneRejects: false },
  { runName: 't16-elections', started: '8/8/2026, 6:56:34 PM', duration: '4367.7s', outcome: 'verified', rejects: { start_missing: 3, worker_unmapped: 234, benefit_unmapped: 54, relation_unmapped: 22, worker_ref_missing: 3, end_not_after_start: 625, employer_ref_missing: 2, election_type_unmapped: 61823 }, hasNoneRejects: false },
  { runName: 't19-payments', started: '8/8/2026, 7:17:26 PM', duration: '0.8s', outcome: 'verified', rejects: { date_missing: 1, amount_missing: 102, status_missing: 3, account_unensured: 3, payer_ref_missing: 40, payment_type_missing: 1 }, hasNoneRejects: false },
  { runName: 't19-payments', started: '8/8/2026, 7:06:36 PM', duration: '36.4s', outcome: 'verified', rejects: { date_missing: 1, amount_missing: 102, status_missing: 3, account_unensured: 3, payer_ref_missing: 40, payment_type_missing: 1 }, hasNoneRejects: false },
  { runName: 't18-ledger', started: '8/8/2026, 6:26:05 PM', duration: '2279.1s', outcome: 'verified', rejects: {}, hasNoneRejects: true },
  { runName: 't15-relationships', started: '8/8/2026, 6:50:15 PM', duration: '196.1s', outcome: 'verified', rejects: { alt_worker_unmapped: 7, owner_has_no_worker: 42, alt_contact_unmapped: 2, relation_create_failed: 6 }, hasNoneRejects: false },
  { runName: 't15-relationships', started: '8/8/2026, 6:25:44 PM', duration: '910.6s', outcome: 'verified', rejects: { alt_worker_unmapped: 7, owner_has_no_worker: 42, alt_contact_unmapped: 2, relation_create_failed: 6 }, hasNoneRejects: false },
  { runName: 'n4-employee-ids', started: '8/8/2026, 6:31:15 PM', duration: '2.9s', outcome: 'verified', rejects: { worker_unmapped: 80, employer_unmapped: 4 }, hasNoneRejects: false },
  { runName: 'n4-employee-ids', started: '8/8/2026, 6:25:48 PM', duration: '9s', outcome: 'verified', rejects: { worker_unmapped: 80, employer_unmapped: 4 }, hasNoneRejects: false },
  { runName: 't6-member-statuses', started: '8/8/2026, 5:35:55 PM', duration: '2089.3s', outcome: 'verified', rejects: { worker_unmapped: 1 }, hasNoneRejects: false },
  { runName: 't7t24-employers', started: '8/8/2026, 5:43:19 PM', duration: '14.1s', outcome: 'verified', rejects: { phone_invalid: 7, duplicate_email: 442, shopcontact_no_name: 73, shopcontact_employer_unresolved: 5 }, hasNoneRejects: false },
  { runName: 't27-users', started: '8/8/2026, 5:36:00 PM', duration: '186.3s', outcome: 'verified', rejects: { no_resolvable_worker: 335, ambiguous_worker_email: 26 }, hasNoneRejects: false },
  { runName: 't7t24-employers', started: '8/8/2026, 5:35:42 PM', duration: '28.9s', outcome: 'verified', rejects: { phone_invalid: 7, duplicate_email: 442, shopcontact_no_name: 73, shopcontact_employer_unresolved: 5 }, hasNoneRejects: false },
  { runName: 't3t1-contacts-workers', started: '8/8/2026, 1:46:02 PM', duration: '13542.5s', outcome: 'verified', rejects: { phone_invalid: 21, contact_no_name: 9, duplicate_email: 10614, ssn_collision_q36: 1, address_incomplete: 1089, worker_contact_unresolved: 4, worker_id_value_collision: 17107 }, hasNoneRejects: false },
  { runName: 't-policies', started: '8/8/2026, 5:07:27 PM', duration: '40.2s', outcome: 'verified', rejects: { policy_ref_not_staged: 1, policy_unmatched_unreferenced: 129 }, hasNoneRejects: false },
  { runName: 't-policies', started: '8/8/2026, 5:01:54 PM', duration: '55.4s', outcome: 'verified', rejects: { policy_ref_not_staged: 1, policy_unmatched_unreferenced: 129 }, hasNoneRejects: false },
  { runName: 'seed-trust-config', started: '8/8/2026, 4:42:17 PM', duration: '0.7s', outcome: 'completed', rejects: {}, hasNoneRejects: true },
  { runName: 't4-options', started: '8/8/2026, 1:43:24 PM', duration: '0.6s', outcome: 'verified', rejects: {}, hasNoneRejects: true },
];

// Sort runs by date desc
runs.sort((a, b) => new Date(b.started) - new Date(a.started));

// Group by loader
const byLoader = {};
for (const run of runs) {
  if (!byLoader[run.runName]) byLoader[run.runName] = [];
  byLoader[run.runName].push(run);
}

const allLoaders = Object.keys(byLoader).sort();

// Build triage rows
const triageRows = [];
for (const loader of allLoaders) {
  const loaderRuns = byLoader[loader]; // desc
  const latestRun = loaderRuns[0];
  const isNone = latestRun.hasNoneRejects && Object.keys(latestRun.rejects).length === 0;

  if (isNone) {
    triageRows.push({
      loader,
      latestRunDate: latestRun.started,
      latestOutcome: latestRun.outcome,
      reason: '(no rejects)',
      latestCount: 0,
      isNoRejects: true,
      isResolved: false,
      trend: 'none in all runs',
    });
  } else {
    const latestReasons = Object.keys(latestRun.rejects);
    const allHistoricalReasons = new Set();
    for (const r of loaderRuns) Object.keys(r.rejects).forEach(k => allHistoricalReasons.add(k));
    latestReasons.forEach(r => allHistoricalReasons.delete(r));

    for (const reason of latestReasons) {
      const trendArr = [...loaderRuns].reverse().map(r => r.rejects[reason] || 0);
      triageRows.push({
        loader, latestRunDate: latestRun.started, latestOutcome: latestRun.outcome,
        reason, latestCount: latestRun.rejects[reason],
        isNoRejects: false, isResolved: false,
        trend: trendArr.join(' → '),
      });
    }
    for (const reason of allHistoricalReasons) {
      const trendArr = [...loaderRuns].reverse().map(r => r.rejects[reason] || 0);
      triageRows.push({
        loader, latestRunDate: latestRun.started, latestOutcome: latestRun.outcome,
        reason, latestCount: 0,
        isNoRejects: false, isResolved: true,
        trend: trendArr.join(' → ') + ' (resolved)',
      });
    }
  }
}

triageRows.sort((a, b) => {
  const aDeferred = a.isNoRejects || a.isResolved;
  const bDeferred = b.isNoRejects || b.isResolved;
  if (aDeferred !== bDeferred) return aDeferred ? 1 : -1;
  if (b.latestCount !== a.latestCount) return b.latestCount - a.latestCount;
  return a.loader.localeCompare(b.loader);
});

// ===== COLORS =====
const C = {
  headerBg: '1F4E79', headerFg: 'FFFFFF',
  subBg: '2E75B6', subFg: 'FFFFFF',
  resolvedBg: 'E2EFDA', norejectsBg: 'F2F2F2',
  activeBg: 'FFFFFF', altBg: 'EBF3FB',
  summaryBg: 'FFF2CC', bordColor: 'BFBFBF',
};

function setBorder(cell) {
  cell.border = {
    top: { style: 'thin', color: { argb: C.bordColor } },
    left: { style: 'thin', color: { argb: C.bordColor } },
    bottom: { style: 'thin', color: { argb: C.bordColor } },
    right: { style: 'thin', color: { argb: C.bordColor } },
  };
}

const wb = new ExcelJS.Workbook();
wb.creator = 'S1 Rehearsal Triage';
wb.created = new Date();

// ===== SHEET 1: TRIAGE =====
const triageSheet = wb.addWorksheet('Triage', {
  views: [{ state: 'frozen', ySplit: 3 }],
});

const triageCols = [
  { header: 'Loader', width: 26 },
  { header: 'Latest Run Date', width: 24 },
  { header: 'Outcome', width: 12 },
  { header: 'Reject Reason', width: 32 },
  { header: 'Count (Latest Run)', width: 18 },
  { header: 'Count Trend (oldest → newest)', width: 40 },
  { header: 'Triage Category', width: 28 },
  { header: 'Review Status', width: 20 },
  { header: 'Allow-list?', width: 14 },
  { header: 'Owner', width: 16 },
  { header: 'Decision / Notes', width: 44 },
  { header: 'Follow-up Ref', width: 18 },
];

triageCols.forEach((col, i) => {
  triageSheet.getColumn(i + 1).width = col.width;
});

// Row 1: title
triageSheet.mergeCells(1, 1, 1, triageCols.length);
const t1 = triageSheet.getCell(1, 1);
t1.value = `S1 Rehearsal Reject Triage — Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`;
t1.font = { bold: true, size: 14, color: { argb: C.headerFg } };
t1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.headerBg } };
t1.alignment = { horizontal: 'center', vertical: 'middle' };
triageSheet.getRow(1).height = 30;

// Row 2: column headers
triageSheet.getRow(2).height = 36;
triageCols.forEach((col, i) => {
  const cell = triageSheet.getRow(2).getCell(i + 1);
  cell.value = col.header;
  cell.font = { bold: true, color: { argb: C.headerFg }, size: 10 };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.subBg } };
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  setBorder(cell);
});

// Row 3: summary
const FIRST_DATA_ROW = 4;
const LAST_DATA_ROW = 3 + triageRows.length;

triageSheet.mergeCells(3, 1, 3, 6);
const sumL = triageSheet.getCell(3, 1);
sumL.value = `${triageRows.length} triage rows total  |  Rows sorted: largest reject count first; resolved/no-rejects at bottom`;
sumL.font = { italic: true, size: 9, color: { argb: '595959' } };
sumL.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.summaryBg } };
sumL.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };

triageSheet.mergeCells(3, 7, 3, triageCols.length);
const sumR = triageSheet.getCell(3, 7);
sumR.value = {
  formula: `"Not reviewed: "&COUNTIF(H${FIRST_DATA_ROW}:H${LAST_DATA_ROW},"Not reviewed")&"   |   In review: "&COUNTIF(H${FIRST_DATA_ROW}:H${LAST_DATA_ROW},"In review")&"   |   Decided: "&COUNTIF(H${FIRST_DATA_ROW}:H${LAST_DATA_ROW},"Decided")&"   |   Resolved: "&COUNTIF(H${FIRST_DATA_ROW}:H${LAST_DATA_ROW},"Resolved")`,
};
sumR.font = { bold: true, size: 9, color: { argb: C.headerBg } };
sumR.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.summaryBg } };
sumR.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
triageSheet.getRow(3).height = 20;

// Dropdown option lists
const TRIAGE_CATS = ['Acceptable as-is', 'S1 data cleanup', 'Loader script fix', 'Needs ruling', 'Already fixed'];
const REVIEW_STATUSES = ['Not reviewed', 'In review', 'Decided', 'Resolved'];
const ALLOW_LIST_VALS = ['yes', 'no', 'n/a'];

// Data rows
triageRows.forEach((row, i) => {
  const rowNum = FIRST_DATA_ROW + i;
  const wsRow = triageSheet.getRow(rowNum);
  wsRow.height = 18;

  let bgColor;
  if (row.isNoRejects) bgColor = C.norejectsBg;
  else if (row.isResolved) bgColor = C.resolvedBg;
  else bgColor = i % 2 === 0 ? C.activeBg : C.altBg;

  const vals = [
    row.loader,
    row.latestRunDate,
    row.latestOutcome,
    row.reason,
    row.isNoRejects ? null : row.latestCount,
    row.trend,
    '',            // Triage Category - blank
    'Not reviewed', // Review Status
    '',            // Allow-list
    '',            // Owner
    '',            // Notes
    '',            // Follow-up Ref
  ];

  vals.forEach((val, j) => {
    const cell = wsRow.getCell(j + 1);
    cell.value = val;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
    setBorder(cell);
    cell.font = { size: 10 };

    if (j === 0) cell.font = { size: 10, bold: !row.isNoRejects && !row.isResolved };
    if (j === 1) { cell.font = { size: 9, color: { argb: '595959' } }; }
    if (j === 2) { cell.alignment = { horizontal: 'center' }; cell.font = { size: 9 }; }
    if (j === 4) { cell.alignment = { horizontal: 'right' }; cell.numFmt = '#,##0'; }
    if (j === 5) { cell.font = { size: 9, color: { argb: row.isResolved ? '4A7C59' : '404040' } }; }
    if (j === 10) { cell.alignment = { wrapText: true }; }
  });

  // Dropdowns
  triageSheet.getCell(rowNum, 7).dataValidation = {
    type: 'list', allowBlank: true,
    formulae: [`"${TRIAGE_CATS.join(',')}"`],
  };
  triageSheet.getCell(rowNum, 8).dataValidation = {
    type: 'list', allowBlank: false,
    formulae: [`"${REVIEW_STATUSES.join(',')}"`],
  };
  triageSheet.getCell(rowNum, 9).dataValidation = {
    type: 'list', allowBlank: true,
    formulae: [`"${ALLOW_LIST_VALS.join(',')}"`],
  };
});

triageSheet.autoFilter = {
  from: { row: 2, column: 1 },
  to: { row: LAST_DATA_ROW, column: triageCols.length },
};

// ===== SHEET 2: RUN HISTORY =====
const histSheet = wb.addWorksheet('Run History', {
  views: [{ state: 'frozen', ySplit: 2 }],
});

const histCols = [
  { header: 'Loader', width: 26 },
  { header: 'Started', width: 26 },
  { header: 'Duration', width: 14 },
  { header: 'Outcome', width: 12 },
  { header: 'Reject Reason', width: 32 },
  { header: 'Count', width: 12 },
];
histCols.forEach((col, i) => { histSheet.getColumn(i + 1).width = col.width; });

histSheet.mergeCells(1, 1, 1, 6);
const ht = histSheet.getCell(1, 1);
ht.value = 'S1 Rehearsal — Full Run History (all runs, all reject reasons)';
ht.font = { bold: true, size: 13, color: { argb: C.headerFg } };
ht.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.headerBg } };
ht.alignment = { horizontal: 'center', vertical: 'middle' };
histSheet.getRow(1).height = 26;

histCols.forEach((col, i) => {
  const cell = histSheet.getRow(2).getCell(i + 1);
  cell.value = col.header;
  cell.font = { bold: true, color: { argb: C.headerFg }, size: 10 };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.subBg } };
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
  setBorder(cell);
});
histSheet.getRow(2).height = 24;

let histRowNum = 3;
for (const run of runs) {
  const entries = Object.entries(run.rejects);
  const noneRow = run.hasNoneRejects && entries.length === 0;

  if (noneRow) {
    const wsRow = histSheet.getRow(histRowNum);
    wsRow.height = 16;
    [run.runName, run.started, run.duration, run.outcome, '(none)', ''].forEach((v, j) => {
      const cell = wsRow.getCell(j + 1);
      cell.value = v;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.norejectsBg } };
      setBorder(cell);
      cell.font = j === 4 ? { size: 9, italic: true, color: { argb: '808080' } } : { size: 9 };
    });
    histRowNum++;
  } else {
    entries.forEach(([reason, count], ri) => {
      const wsRow = histSheet.getRow(histRowNum);
      wsRow.height = 16;
      const bg = ri % 2 === 0 ? C.activeBg : C.altBg;
      [run.runName, run.started, run.duration, run.outcome, reason, count].forEach((v, j) => {
        const cell = wsRow.getCell(j + 1);
        cell.value = v;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        setBorder(cell);
        cell.font = { size: 9 };
        if (j === 5) { cell.alignment = { horizontal: 'right' }; cell.numFmt = '#,##0'; }
      });
      histRowNum++;
    });
  }
}

histSheet.autoFilter = {
  from: { row: 2, column: 1 },
  to: { row: histRowNum - 1, column: 6 },
};

// ===== SHEET 3: INSTRUCTIONS =====
const instrSheet = wb.addWorksheet('Instructions & Legend');
instrSheet.getColumn(1).width = 28;
instrSheet.getColumn(2).width = 72;

instrSheet.mergeCells(1, 1, 1, 2);
const it = instrSheet.getCell(1, 1);
it.value = 'S1 Rehearsal Reject Triage — Instructions & Legend';
it.font = { bold: true, size: 14, color: { argb: C.headerFg } };
it.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.headerBg } };
it.alignment = { horizontal: 'center', vertical: 'middle' };
instrSheet.getRow(1).height = 28;

const sections = [
  { heading: 'PURPOSE' },
  { label: '', value: 'This workbook is the triage tracker for the initial S1 rehearsal upload. Every (loader, reject reason) pair from the most recent run of each loader appears as one row in the Triage sheet. Use it to decide what to do with each reject set before the production migration runs.' },
  { heading: 'HOW TO USE' },
  { label: '1. Start at the top', value: 'Rows are sorted largest-count-first so the highest-impact reject sets come first. Resolved and no-reject rows are at the bottom.' },
  { label: '2. Fill Triage Category', value: 'Pick one of the five categories below for each open row.' },
  { label: '3. Fill Review Status', value: 'Set to "In review" while deciding, "Decided" when you have a ruling, "Resolved" when all follow-up work is done.' },
  { label: '4. Fill Allow-list?', value: '"yes" = this reason should be added to the --allow-rejects list for the next run. "no" = fix needed first. "n/a" = no-reject / resolved rows.' },
  { label: '5. Read the Trend column', value: 'Shows counts across runs from oldest → newest. Zero in the latest position means the reject set is already gone. Green rows in Triage are resolved sets (zero in latest run).' },
  { label: '6. Grey rows', value: 'Loaders that completed with zero rejects in the latest run.' },
  { heading: 'TRIAGE CATEGORIES' },
  { label: 'Acceptable as-is', value: 'The S1 data genuinely contains records that cannot or should not be imported. Rejecting them is correct behavior. Add to --allow-rejects.' },
  { label: 'S1 data cleanup', value: 'Reject caused by bad data in S1 (missing fields, bad formats, orphaned references). Clean the source data and re-run.' },
  { label: 'Loader script fix', value: 'Reject caused by a gap or bug in the loader code. The data could be imported if the script were corrected.' },
  { label: 'Needs ruling', value: 'Unclear which category applies. A human decision or business-rule clarification is required.' },
  { label: 'Already fixed', value: 'The reject appeared in a prior run but the trend shows it has reached zero in the latest run. No further action needed.' },
  { heading: 'REVIEW STATUS' },
  { label: 'Not reviewed', value: 'Default. No one has looked at this row yet.' },
  { label: 'In review', value: 'Someone is actively investigating.' },
  { label: 'Decided', value: 'A triage category and ruling have been assigned.' },
  { label: 'Resolved', value: 'Any follow-up work (cleanup, fix, allow-list addition) is complete.' },
  { heading: 'SHEETS IN THIS WORKBOOK' },
  { label: 'Triage', value: 'One row per (loader, reject reason) from the latest run of each loader. Fill in the right-hand columns to track decisions.' },
  { label: 'Run History', value: 'Every run from the log with all reject reasons and counts. Use to understand trends and history for any specific loader.' },
  { label: 'Instructions & Legend', value: 'This sheet.' },
  { heading: 'FILE METADATA' },
  { label: 'Log source', value: 'attached_assets/Pasted--Run-Started-Duration-Outcome-Rejects-t29-enrollment-pa_1786977106071.txt' },
  { label: 'Generated', value: new Date().toLocaleString('en-US') },
  { label: 'Total loaders', value: String(allLoaders.length) },
  { label: 'Total triage rows', value: String(triageRows.length) },
  { label: 'Total run history rows', value: String(runs.length) + ' runs' },
];

let instrRow = 2;
for (const sec of sections) {
  if (sec.heading) {
    instrSheet.mergeCells(instrRow, 1, instrRow, 2);
    const hCell = instrSheet.getCell(instrRow, 1);
    hCell.value = sec.heading;
    hCell.font = { bold: true, size: 11, color: { argb: C.headerFg } };
    hCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.subBg } };
    hCell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    instrSheet.getRow(instrRow).height = 22;
  } else {
    const r = instrSheet.getRow(instrRow);
    r.height = 20;
    const lCell = r.getCell(1);
    lCell.value = sec.label;
    lCell.font = { bold: !!sec.label, size: 10 };
    lCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F2F2F2' } };
    lCell.alignment = { horizontal: 'left', vertical: 'top', indent: 1 };
    setBorder(lCell);
    const vCell = r.getCell(2);
    vCell.value = sec.value;
    vCell.font = { size: 10 };
    vCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.activeBg } };
    vCell.alignment = { wrapText: true, horizontal: 'left', vertical: 'top' };
    setBorder(vCell);
  }
  instrRow++;
}

// ===== SAVE =====
mkdirSync(join(__dirname, '../../docs'), { recursive: true });
const outPath = join(__dirname, '../../docs/s1-rehearsal-reject-triage.xlsx');
await wb.xlsx.writeFile(outPath);
console.log('Written to:', outPath);
const { statSync } = await import('fs');
const stat = statSync(outPath);
console.log('File size:', stat.size, 'bytes');
console.log('Triage rows:', triageRows.length);
console.log('Done.');
