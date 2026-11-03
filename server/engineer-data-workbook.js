// Builds one engineer's personal data export: daily entries, timesheets and payments.
// Rates and billing amounts are left out so the file only holds the engineer's own records.

const { roundToCents, sumColumn, addSheet, newWorkbook, writeWorkbook, toSafeFilenamePart } = require('./workbook-sheets');

const ALL_YEARS = 'all';
const EARLIEST_YEAR = 2000;
const EMPTY_MESSAGE = 'No records for this period';

class EngineerDataError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// Accepts a four-digit year or "all"; returns the year as a number, or ALL_YEARS
function parseExportYear(value) {
  if (value === undefined || value === '' || value === ALL_YEARS) return ALL_YEARS;
  const year = Number(value);
  const latestYear = new Date().getFullYear() + 1;
  if (!Number.isInteger(year) || year < EARLIEST_YEAR || year > latestYear) {
    throw new EngineerDataError('Year must be a four-digit year or "all"', 400);
  }
  return year;
}

// SQL fragment and parameters that limit a date column to the export year
function yearFilter(column, year) {
  if (year === ALL_YEARS) return { clause: '', params: [] };
  return { clause: `AND ${column} BETWEEN ? AND ?`, params: [`${year}-01-01`, `${year}-12-31`] };
}

function getEngineer(db, userId) {
  const engineer = db.prepare('SELECT id, name, engineer_id FROM users WHERE id = ?').get(userId);
  if (!engineer) throw new EngineerDataError('User not found', 404);
  return engineer;
}

function getDailyEntryRows(db, userId, year) {
  const { clause, params } = yearFilter('te.entry_date', year);
  return db.prepare(`
    SELECT te.entry_date, c.name AS customer, p.name AS project, p.po_number,
           te.start_time, te.end_time, te.lunch_break, te.hours, te.shift, te.description, ts.status
    FROM timesheet_entries te
    JOIN timesheets ts ON ts.id = te.timesheet_id
    JOIN projects p ON p.id = ts.project_id
    JOIN customers c ON c.id = p.customer_id
    WHERE ts.user_id = ? AND (te.hours > 0 OR COALESCE(te.description, '') != '') ${clause}
    ORDER BY te.entry_date, c.name, p.name
  `).all(userId, ...params).map(row => ({
    Date: row.entry_date,
    Customer: row.customer,
    Project: row.project,
    'PO #': row.po_number || '',
    Start: row.start_time || '',
    End: row.end_time || '',
    'Lunch (hrs)': row.lunch_break || '',
    Hours: roundToCents(row.hours),
    Shift: row.shift || '',
    Description: row.description || '',
    'Timesheet Status': row.status,
  }));
}

function getTimesheetRows(db, userId, year) {
  const { clause, params } = yearFilter('ts.week_ending', year);
  return db.prepare(`
    SELECT c.name AS customer, p.name AS project, p.po_number, p.project_type,
           ts.period_start, ts.week_ending, ts.status, ts.ot_hours, ts.units, ts.percentage,
           substr(ts.submitted_at, 1, 10) AS submitted, substr(ts.approved_at, 1, 10) AS approved,
           ts.invoice_id, ts.paid_date,
           COALESCE((SELECT SUM(hours) FROM timesheet_entries te WHERE te.timesheet_id = ts.id), 0) AS hours
    FROM timesheets ts
    JOIN projects p ON p.id = ts.project_id
    JOIN customers c ON c.id = p.customer_id
    WHERE ts.user_id = ? ${clause}
    ORDER BY ts.week_ending, c.name, p.name
  `).all(userId, ...params).map(row => ({
    Customer: row.customer,
    Project: row.project,
    'PO #': row.po_number || '',
    'Period Start': row.period_start || '',
    'Week / Period End': row.week_ending,
    Status: row.status,
    Hours: roundToCents(row.hours),
    'OT Hours': row.ot_hours ? roundToCents(row.ot_hours) : '',
    Units: row.units || '',
    'Percent Complete': row.percentage || '',
    Submitted: row.submitted || '',
    Approved: row.approved || '',
    Invoiced: row.invoice_id ? 'Yes' : 'No',
    'Marked Paid': row.paid_date || '',
  }));
}

function getPaymentRows(db, userId, year) {
  const { clause, params } = yearFilter('payment_date', year);
  return db.prepare(`
    SELECT payment_date, period_start, period_end, payment_type, payment_method, reference_number, amount, notes
    FROM engineer_payments
    WHERE user_id = ? ${clause}
    ORDER BY payment_date, id
  `).all(userId, ...params).map(row => ({
    'Date Paid': row.payment_date,
    'Pay Period Start': row.period_start || '',
    'Pay Period End': row.period_end || '',
    Type: row.payment_type,
    Method: row.payment_method || '',
    Reference: row.reference_number || '',
    Amount: roundToCents(row.amount),
    Notes: row.notes || '',
  }));
}

function buildSummaryRows({ engineer, year, entries, timesheets, payments }) {
  const periodLabel = year === ALL_YEARS ? 'All years' : String(year);
  const generatedAt = new Date().toISOString().replace('T', ' ').substring(0, 16);
  return [
    { Item: 'Engineer', Value: engineer.name },
    { Item: 'Engineer ID', Value: engineer.engineer_id || '' },
    { Item: 'Period', Value: periodLabel },
    { Item: 'Generated (UTC)', Value: generatedAt },
    { Item: 'Hours logged', Value: sumColumn(entries, 'Hours') },
    { Item: 'Timesheets', Value: timesheets.length },
    { Item: 'Timesheets approved', Value: timesheets.filter(row => row.Status === 'approved').length },
    { Item: 'Payments received', Value: payments.length },
    { Item: 'Total paid (by date paid; matches your 1099)', Value: sumColumn(payments, 'Amount') },
  ];
}

function buildEngineerDataWorkbook(db, userId, year) {
  const engineer = getEngineer(db, userId);
  const entries = getDailyEntryRows(db, userId, year);
  const timesheets = getTimesheetRows(db, userId, year);
  const payments = getPaymentRows(db, userId, year);

  const workbook = newWorkbook();
  addSheet(workbook, 'Summary', buildSummaryRows({ engineer, year, entries, timesheets, payments }));
  addSheet(workbook, 'Daily Entries', entries, [], EMPTY_MESSAGE);
  addSheet(workbook, 'Timesheets', timesheets, [], EMPTY_MESSAGE);
  addSheet(workbook, 'Payments', payments, ['Amount'], EMPTY_MESSAGE);
  return { buffer: writeWorkbook(workbook), filename: buildEngineerDataFilename(engineer.name, year) };
}

function buildEngineerDataFilename(engineerName, year) {
  const periodLabel = year === ALL_YEARS ? 'All Years' : year;
  return `${toSafeFilenamePart(engineerName, 'Engineer')} ${periodLabel} TimeTracker Data.xlsx`;
}

module.exports = { ALL_YEARS, EngineerDataError, parseExportYear, buildEngineerDataWorkbook };
