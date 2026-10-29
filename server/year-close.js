// Year-end close: once a year is closed, financial records dated in it are locked.
// "Closed" is cumulative: closing 2026 also locks every earlier year.

const YEAR_CLOSED_CODE = 'YEAR_CLOSED';
const MAX_REOPEN_REASON_LENGTH = 500;

class YearCloseError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function getClosedThroughYear(db) {
  const row = db.prepare('SELECT MAX(year) AS year FROM year_closures WHERE reopened_at IS NULL').get();
  return row && row.year ? row.year : null;
}

function getYearOfDate(dateValue) {
  if (!dateValue) return null;
  const year = parseInt(String(dateValue).substring(0, 4), 10);
  return Number.isInteger(year) ? year : null;
}

// Returns the earliest closed year among the given dates, or null when all are open
function findClosedYear(db, dates) {
  const closedThrough = getClosedThroughYear(db);
  if (!closedThrough) return null;
  const closedYears = dates
    .map(getYearOfDate)
    .filter(year => year !== null && year <= closedThrough);
  return closedYears.length > 0 ? Math.min(...closedYears) : null;
}

function buildClosedYearMessage(year) {
  return `${year} is closed for year-end. Records dated in ${year} can't be changed. An admin can reopen the year in Settings → Year-End Close.`;
}

// Express middleware: collectDates(db, req) returns the dates the request would touch
function rejectClosedYear(getDb, collectDates) {
  return (req, res, next) => {
    const db = getDb();
    const closedYear = findClosedYear(db, collectDates(db, req));
    if (closedYear) {
      return res.status(403).json({ error: buildClosedYearMessage(closedYear), code: YEAR_CLOSED_CODE });
    }
    next();
  };
}

// ─── Date collectors, one per kind of record ─────────────────────────────────

function timesheetDates(db, req) {
  const existing = req.params.id
    ? db.prepare('SELECT week_ending, period_end FROM timesheets WHERE id = ?').get(req.params.id)
    : null;
  const body = req.body || {};
  return [existing?.week_ending, existing?.period_end, body.week_ending, body.period_end];
}

function invoiceDates(db, req) {
  const invoice = db.prepare('SELECT created_at FROM invoices WHERE id = ?').get(req.params.id);
  return [invoice?.created_at];
}

// Notes on a closed invoice stay editable; amounts and hours do not
function invoiceAmountDates(db, req) {
  const body = req.body || {};
  const changesAmounts = body.total_amount !== undefined || body.total_hours !== undefined;
  return changesAmounts ? invoiceDates(db, req) : [];
}

function customerPaymentDates(db, req) {
  const payment = db.prepare('SELECT payment_date FROM payments WHERE id = ?').get(req.params.id);
  return [payment?.payment_date];
}

function engineerPaymentDates(db, req) {
  const existing = req.params.id
    ? db.prepare('SELECT payment_date FROM engineer_payments WHERE id = ?').get(req.params.id)
    : null;
  return [existing?.payment_date, req.body?.payment_date];
}

function bodyDates(...fields) {
  return (db, req) => fields.map(field => req.body?.[field]);
}

// Payroll periods are judged by where they end, so a Dec 28 - Jan 10 period stays open
function markPaidDates(db, req) {
  const body = req.body || {};
  return [body.period_end, body.paid_date];
}

function writeoffDates(db, req) {
  const year = req.body?.year;
  return year ? [`${year}-12-31`] : [];
}

// ─── Close / reopen ──────────────────────────────────────────────────────────

function parseYear(value) {
  const year = parseInt(value, 10);
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || String(year) !== String(value).trim()) {
    throw new YearCloseError('Year must be a four-digit year');
  }
  return year;
}

function getYearChecklist(db, year) {
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  const count = (sql, ...params) => db.prepare(sql).get(...params).n;
  return {
    unsubmitted_timesheets: count(
      "SELECT COUNT(*) AS n FROM timesheets WHERE week_ending BETWEEN ? AND ? AND status IN ('draft', 'submitted')", start, end),
    uninvoiced_timesheets: count(
      `SELECT COUNT(*) AS n FROM timesheets ts
       WHERE ts.week_ending BETWEEN ? AND ? AND ts.status = 'approved' AND ts.invoice_id IS NULL
         AND NOT EXISTS (SELECT 1 FROM timesheet_entries te WHERE te.timesheet_id = ts.id AND te.invoice_id IS NOT NULL)
         AND EXISTS (SELECT 1 FROM projects p WHERE p.id = ts.project_id AND p.internal = 0)`, start, end),
    open_invoices: count(
      "SELECT COUNT(*) AS n FROM invoices WHERE created_at BETWEEN ? AND ? AND status IN ('unpaid', 'partial')", start, `${end} 23:59:59`),
    invoices: count(
      'SELECT COUNT(*) AS n FROM invoices WHERE created_at BETWEEN ? AND ?', start, `${end} 23:59:59`),
    engineer_payments: count(
      'SELECT COUNT(*) AS n FROM engineer_payments WHERE payment_date BETWEEN ? AND ?', start, end),
  };
}

function getYearCloseState(db, currentYear = new Date().getFullYear()) {
  const closedThrough = getClosedThroughYear(db);
  const closures = db.prepare(`
    SELECT yc.*, cu.name AS closed_by_name, ru.name AS reopened_by_name
    FROM year_closures yc
    LEFT JOIN users cu ON cu.id = yc.closed_by
    LEFT JOIN users ru ON ru.id = yc.reopened_by
    ORDER BY yc.closed_at DESC
  `).all();
  const nextYearToClose = closedThrough ? closedThrough + 1 : currentYear - 1;
  return {
    closed_through_year: closedThrough,
    current_year: currentYear,
    next_year_to_close: nextYearToClose < currentYear ? nextYearToClose : null,
    closures,
  };
}

function assertCanClose(db, year, currentYear) {
  if (year >= currentYear) {
    throw new YearCloseError(`${year} can't be closed until it has ended. You can close it from January 1, ${year + 1}.`);
  }
  const closedThrough = getClosedThroughYear(db);
  if (closedThrough && year <= closedThrough) {
    throw new YearCloseError(`${year} is already closed.`);
  }
}

// createArchive() must return the archive filename; the year closes only if it succeeds
function closeYear(db, { year, userId, createArchive, currentYear = new Date().getFullYear() }) {
  assertCanClose(db, year, currentYear);
  const archiveFile = createArchive(year);
  const closedAt = new Date().toISOString();
  db.prepare('INSERT INTO year_closures (year, closed_at, closed_by, archive_file) VALUES (?, ?, ?, ?)')
    .run(year, closedAt, userId, archiveFile);
  return { year, closed_at: closedAt, archive_file: archiveFile };
}

function reopenYear(db, { year, userId, reason }) {
  const trimmedReason = String(reason || '').trim();
  if (!trimmedReason) {
    throw new YearCloseError('Enter a reason for reopening the year.');
  }
  if (trimmedReason.length > MAX_REOPEN_REASON_LENGTH) {
    throw new YearCloseError(`Keep the reason under ${MAX_REOPEN_REASON_LENGTH} characters.`);
  }
  const closedThrough = getClosedThroughYear(db);
  if (closedThrough !== year) {
    throw new YearCloseError(closedThrough
      ? `Only the most recently closed year (${closedThrough}) can be reopened.`
      : 'No year is closed.');
  }
  db.prepare(`
    UPDATE year_closures SET reopened_at = ?, reopened_by = ?, reopen_reason = ?
    WHERE year = ? AND reopened_at IS NULL
  `).run(new Date().toISOString(), userId, trimmedReason, year);
  return { year, closed_through_year: getClosedThroughYear(db) };
}

module.exports = {
  YEAR_CLOSED_CODE,
  YearCloseError,
  getClosedThroughYear,
  findClosedYear,
  rejectClosedYear,
  timesheetDates,
  invoiceDates,
  invoiceAmountDates,
  customerPaymentDates,
  engineerPaymentDates,
  bodyDates,
  markPaidDates,
  writeoffDates,
  parseYear,
  getYearChecklist,
  getYearCloseState,
  closeYear,
  reopenYear,
};
