// Builds the year-end archive workbook: one sheet per record type for a calendar year.

const XLSX = require('xlsx');

const CURRENCY_FORMAT = '#,##0.00';

function yearBounds(year) {
  return { start: `${year}-01-01`, end: `${year}-12-31`, endOfDay: `${year}-12-31 23:59:59` };
}

function roundToCents(amount) {
  return Math.round((amount || 0) * 100) / 100;
}

function getInvoiceRows(db, year) {
  const { start, endOfDay } = yearBounds(year);
  return db.prepare(`
    SELECT i.invoice_number, substr(i.created_at, 1, 10) AS invoice_date,
           c.name AS customer, p.name AS project, p.po_number,
           i.period_start, i.period_end, i.total_hours, i.total_amount, i.amount_paid,
           i.status, i.paid_date, i.voided_date, i.void_reason
    FROM invoices i
    JOIN projects p ON p.id = i.project_id
    JOIN customers c ON c.id = p.customer_id
    WHERE i.created_at BETWEEN ? AND ?
    ORDER BY i.created_at, i.invoice_number
  `).all(start, endOfDay).map(row => ({
    'Invoice #': row.invoice_number,
    'Invoice Date': row.invoice_date,
    Customer: row.customer,
    Project: row.project,
    'PO #': row.po_number || '',
    'Period Start': row.period_start,
    'Period End': row.period_end,
    Hours: roundToCents(row.total_hours),
    Amount: roundToCents(row.total_amount),
    Paid: roundToCents(row.amount_paid),
    'Balance Due': row.status === 'voided' ? 0 : roundToCents(row.total_amount - row.amount_paid),
    Status: row.status,
    'Paid Date': row.paid_date || '',
    'Voided Date': row.voided_date || '',
    'Void Reason': row.void_reason || '',
  }));
}

function getCustomerPaymentRows(db, year) {
  const { start, end } = yearBounds(year);
  return db.prepare(`
    SELECT pay.payment_date, i.invoice_number, c.name AS customer, pay.amount,
           pay.payment_method, pay.reference_number, pay.notes
    FROM payments pay
    JOIN invoices i ON i.id = pay.invoice_id
    JOIN projects p ON p.id = i.project_id
    JOIN customers c ON c.id = p.customer_id
    WHERE pay.payment_date BETWEEN ? AND ?
    ORDER BY pay.payment_date, i.invoice_number
  `).all(start, end).map(row => ({
    'Payment Date': row.payment_date,
    'Invoice #': row.invoice_number,
    Customer: row.customer,
    Amount: roundToCents(row.amount),
    Method: row.payment_method || '',
    Reference: row.reference_number || '',
    Notes: row.notes || '',
  }));
}

function getEngineerPaymentRows(db, year) {
  const { start, end } = yearBounds(year);
  return db.prepare(`
    SELECT ep.payment_date, u.name AS engineer, u.engineer_id, ep.payment_type, ep.amount,
           ep.period_start, ep.period_end, ep.payment_method, ep.reference_number, ep.notes
    FROM engineer_payments ep
    JOIN users u ON u.id = ep.user_id
    WHERE ep.payment_date BETWEEN ? AND ?
    ORDER BY ep.payment_date, u.name
  `).all(start, end).map(row => ({
    'Payment Date': row.payment_date,
    Engineer: row.engineer,
    'Engineer ID': row.engineer_id || '',
    Type: row.payment_type,
    Amount: roundToCents(row.amount),
    'Period Start': row.period_start || '',
    'Period End': row.period_end || '',
    Method: row.payment_method || '',
    Reference: row.reference_number || '',
    Notes: row.notes || '',
  }));
}

// Cash basis: a payment counts in the year it was paid, which is how 1099-NEC totals are reported
function get1099Rows(db, year) {
  const { start, end } = yearBounds(year);
  return db.prepare(`
    SELECT u.name, u.engineer_id, u.email, u.address, u.city, u.state, u.zip,
           SUM(ep.amount) AS total_paid, COUNT(ep.id) AS payment_count
    FROM engineer_payments ep
    JOIN users u ON u.id = ep.user_id
    WHERE ep.payment_date BETWEEN ? AND ?
    GROUP BY u.id
    ORDER BY u.name
  `).all(start, end).map(row => ({
    Engineer: row.name,
    'Engineer ID': row.engineer_id || '',
    Email: row.email || '',
    Address: row.address || '',
    City: row.city || '',
    State: row.state || '',
    Zip: row.zip || '',
    Payments: row.payment_count,
    'Total Paid': roundToCents(row.total_paid),
  }));
}

function getTimesheetRows(db, year) {
  const { start, end } = yearBounds(year);
  return db.prepare(`
    SELECT u.name AS engineer, c.name AS customer, p.name AS project, p.project_type,
           ts.period_start, ts.week_ending, ts.status,
           COALESCE((SELECT SUM(hours) FROM timesheet_entries te WHERE te.timesheet_id = ts.id), 0) AS hours,
           ts.units, ts.amount, i.invoice_number, ts.paid_date
    FROM timesheets ts
    JOIN users u ON u.id = ts.user_id
    JOIN projects p ON p.id = ts.project_id
    JOIN customers c ON c.id = p.customer_id
    LEFT JOIN invoices i ON i.id = ts.invoice_id
    WHERE ts.week_ending BETWEEN ? AND ?
    ORDER BY ts.week_ending, u.name
  `).all(start, end).map(row => ({
    Engineer: row.engineer,
    Customer: row.customer,
    Project: row.project,
    'Project Type': row.project_type,
    'Period Start': row.period_start || '',
    'Week / Period End': row.week_ending,
    Status: row.status,
    Hours: roundToCents(row.hours),
    Units: row.units || '',
    'Fixed Amount': row.amount ? roundToCents(row.amount) : '',
    'Invoice #': row.invoice_number || '',
    'Paid Date': row.paid_date || '',
  }));
}

function sumColumn(rows, column) {
  return roundToCents(rows.reduce((total, row) => total + (Number(row[column]) || 0), 0));
}

function buildSummaryRows({ year, companyName, invoices, customerPayments, engineerPayments, contractors }) {
  const activeInvoices = invoices.filter(row => row.Status !== 'voided');
  const generatedAt = new Date().toISOString().replace('T', ' ').substring(0, 16);
  return [
    { Item: 'Company', Value: companyName },
    { Item: 'Year', Value: year },
    { Item: 'Generated (UTC)', Value: generatedAt },
    { Item: 'Invoices issued (excluding voided)', Value: activeInvoices.length },
    { Item: 'Total invoiced', Value: sumColumn(activeInvoices, 'Amount') },
    { Item: 'Customer payments received in year', Value: sumColumn(customerPayments, 'Amount') },
    { Item: 'Still owed on this year\'s invoices', Value: sumColumn(activeInvoices, 'Balance Due') },
    { Item: 'Engineer payments made in year', Value: sumColumn(engineerPayments, 'Amount') },
    { Item: 'Engineers paid (1099 count)', Value: contractors.length },
  ];
}

function addSheet(workbook, name, rows, currencyColumns = []) {
  const sheet = rows.length > 0
    ? XLSX.utils.json_to_sheet(rows)
    : XLSX.utils.aoa_to_sheet([['No records for this year']]);
  if (rows.length > 0) {
    const headers = Object.keys(rows[0]);
    sheet['!cols'] = headers.map(header => ({
      wch: Math.min(40, Math.max(header.length, ...rows.map(row => String(row[header] ?? '').length)) + 2),
    }));
    applyCurrencyFormat(sheet, headers, rows.length, currencyColumns);
  }
  XLSX.utils.book_append_sheet(workbook, sheet, name);
}

function applyCurrencyFormat(sheet, headers, rowCount, currencyColumns) {
  for (const column of currencyColumns) {
    const columnIndex = headers.indexOf(column);
    if (columnIndex < 0) continue;
    for (let rowIndex = 1; rowIndex <= rowCount; rowIndex++) {
      const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })];
      if (cell && cell.t === 'n') cell.z = CURRENCY_FORMAT;
    }
  }
}

function buildYearEndWorkbook(db, year, companyName) {
  const invoices = getInvoiceRows(db, year);
  const customerPayments = getCustomerPaymentRows(db, year);
  const engineerPayments = getEngineerPaymentRows(db, year);
  const contractors = get1099Rows(db, year);
  const timesheets = getTimesheetRows(db, year);

  const workbook = XLSX.utils.book_new();
  addSheet(workbook, 'Summary', buildSummaryRows({ year, companyName, invoices, customerPayments, engineerPayments, contractors }));
  addSheet(workbook, 'Invoices', invoices, ['Amount', 'Paid', 'Balance Due']);
  addSheet(workbook, 'Payments Received', customerPayments, ['Amount']);
  addSheet(workbook, 'Engineer Payments', engineerPayments, ['Amount']);
  addSheet(workbook, '1099 Totals', contractors, ['Total Paid']);
  addSheet(workbook, 'Timesheets', timesheets, ['Fixed Amount']);
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

function buildWorkbookFilename(year, companyName) {
  const safeCompany = String(companyName || 'TimeTracker').replace(/[^A-Za-z0-9 ]/g, '').trim() || 'TimeTracker';
  return `${safeCompany} ${year} Year-End Archive.xlsx`;
}

module.exports = { buildYearEndWorkbook, buildWorkbookFilename };
