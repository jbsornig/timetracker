// Engineer cost of the work billed on each invoice, excluding owners (users.exclude_from_costs).

const HISTORICAL_PREFIX = 'Historical import';
const WEEKLY_OT_THRESHOLD = 40;
const DAILY_OT_THRESHOLD = 8;

function createInvoiceCostCalculator(db) {
  const invoiceStmt = db.prepare(`
    SELECT i.id, i.project_id, i.total_hours, i.notes, p.project_type
    FROM invoices i JOIN projects p ON p.id = i.project_id
    WHERE i.id = ?
  `);
  const entryStmt = db.prepare(`
    SELECT te.timesheet_id, te.hours, ts.user_id, ts.ot_hours,
           p.overtime_type, p.requires_daily_logs,
           ep.pay_rate, ep.ot_pay_rate, ep.monthly_pay, u.exclude_from_costs
    FROM timesheet_entries te
    JOIN timesheets ts ON ts.id = te.timesheet_id
    JOIN projects p ON p.id = ts.project_id
    JOIN users u ON u.id = ts.user_id
    LEFT JOIN engineer_projects ep ON ep.user_id = ts.user_id AND ep.project_id = ts.project_id
    WHERE te.invoice_id = ? AND te.hours > 0
  `);
  const timesheetHoursStmt = db.prepare(
    'SELECT COALESCE(SUM(hours), 0) as total FROM timesheet_entries WHERE timesheet_id = ? AND hours > 0'
  );
  const stampedTimesheetStmt = db.prepare(`
    SELECT COALESCE(SUM(ts.amount), 0) as total
    FROM timesheets ts JOIN users u ON u.id = ts.user_id
    WHERE ts.invoice_id = ? AND COALESCE(u.exclude_from_costs, 0) = 0
  `);
  const historicalEngineerStmt = db.prepare(`
    SELECT u.exclude_from_costs, ep.pay_rate, ep.monthly_pay
    FROM users u
    LEFT JOIN engineer_projects ep ON ep.user_id = u.id AND ep.project_id = ?
    WHERE u.name = ?
  `);

  function getOvertimeHours(group, timesheetTotal) {
    const first = group[0];
    if (!(first.ot_pay_rate > 0) || timesheetTotal <= 0) return 0;
    const invoicedHours = group.reduce((sum, e) => sum + e.hours, 0);
    const share = invoicedHours / timesheetTotal;
    if (first.requires_daily_logs === 0) {
      return Math.min(first.ot_hours || 0, timesheetTotal) * share;
    }
    if (first.overtime_type === 'weekly_40') {
      return Math.max(0, timesheetTotal - WEEKLY_OT_THRESHOLD) * share;
    }
    if (first.overtime_type === 'daily_8') {
      return group.reduce((sum, e) => sum + Math.max(0, e.hours - DAILY_OT_THRESHOLD), 0);
    }
    return 0;
  }

  function costFromEntries(invoiceId, projectType) {
    const entries = entryStmt.all(invoiceId).filter(e => !e.exclude_from_costs);
    if (projectType === 'fixed_monthly') {
      const monthlyByUser = new Map(entries.map(e => [e.user_id, e.monthly_pay || 0]));
      return [...monthlyByUser.values()].reduce((sum, pay) => sum + pay, 0);
    }
    const byTimesheet = new Map();
    for (const entry of entries) {
      if (!byTimesheet.has(entry.timesheet_id)) byTimesheet.set(entry.timesheet_id, []);
      byTimesheet.get(entry.timesheet_id).push(entry);
    }
    let cost = 0;
    for (const [timesheetId, group] of byTimesheet) {
      const invoicedHours = group.reduce((sum, e) => sum + e.hours, 0);
      const otHours = getOvertimeHours(group, timesheetHoursStmt.get(timesheetId).total);
      const { pay_rate: payRate = 0, ot_pay_rate: otPayRate = 0 } = group[0];
      cost += (invoicedHours - otHours) * (payRate || 0) + otHours * (otPayRate || 0);
    }
    return cost;
  }

  // Imported invoices have no linked work; their notes read "Historical import - <Engineer> - PO ..."
  function costFromHistoricalNotes(invoice) {
    const engineerName = (invoice.notes.split(' - ')[1] || '').trim();
    const engineer = engineerName ? historicalEngineerStmt.get(invoice.project_id, engineerName) : null;
    if (!engineer) return null;
    if (engineer.exclude_from_costs) return 0;
    if (invoice.project_type === 'fixed_monthly') return engineer.monthly_pay ?? null;
    if (engineer.pay_rate === null || engineer.pay_rate === undefined) return null;
    return (invoice.total_hours || 0) * engineer.pay_rate;
  }

  // Returns the cost in dollars, or null when it can't be determined.
  return function getInvoiceCost(invoiceId) {
    const invoice = invoiceStmt.get(invoiceId);
    if (!invoice) return null;
    if ((invoice.notes || '').startsWith(HISTORICAL_PREFIX)) {
      return costFromHistoricalNotes(invoice);
    }
    if (invoice.project_type === 'fixed_price' || invoice.project_type === 'piece_rate') {
      return stampedTimesheetStmt.get(invoiceId).total;
    }
    return costFromEntries(invoiceId, invoice.project_type);
  };
}

function getEngineerPaymentsInPeriod(db, periodStart, periodEnd) {
  const rows = db.prepare(`
    SELECT COALESCE(u.exclude_from_costs, 0) as is_owner, COALESCE(SUM(ep.amount), 0) as total
    FROM engineer_payments ep JOIN users u ON u.id = ep.user_id
    WHERE DATE(ep.payment_date) BETWEEN ? AND ?
    GROUP BY COALESCE(u.exclude_from_costs, 0)
  `).all(periodStart, periodEnd);
  const totalFor = (isOwner) => rows.find(r => r.is_owner === isOwner)?.total || 0;
  return { business: totalFor(0), owner: totalFor(1) };
}

module.exports = { createInvoiceCostCalculator, getEngineerPaymentsInPeriod };
