// Hours budget for an hourly project: what the PO still has available, the straight-time
// and overtime hours used per engineer, and an optional saved "what if" plan.
//
// Overtime is recorded per timesheet (timesheets.ot_hours); straight time is the
// timesheet's total entry hours minus that. Costs use each engineer's assignment rates,
// with an overtime rate of 0 falling back to the straight-time rate (as billing does).

const COUNTED_STATUSES = ['submitted', 'approved'];
const MAX_PLAN_LINES = 50;
const MAX_PLAN_NUMBER = 100000;
const PLAN_MODES = ['schedule', 'hours'];
const PLAN_NUMBER_FIELDS = ['hoursPerDay', 'daysPerWeek', 'weeks', 'stHours', 'otHours'];

class HoursPlanError extends Error {}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function effectiveOtRate(billRate, otBillRate) {
  return otBillRate > 0 ? otBillRate : billRate;
}

// timesheets: [{ user_id, total_hours, uninvoiced_hours, ot_hours }]
// rates: { [user_id]: { bill_rate, ot_bill_rate } }
// Returns per-user usage plus the cost of hours not yet on an invoice.
function summarizeTimesheets(timesheets, rates) {
  return timesheets.reduce((byUser, ts) => {
    const rate = rates[ts.user_id] || { bill_rate: 0, ot_bill_rate: 0 };
    const totalHours = ts.total_hours || 0;
    const otHours = Math.min(ts.ot_hours || 0, totalHours);
    const stHours = totalHours - otHours;
    const stCost = stHours * (rate.bill_rate || 0);
    const otCost = otHours * effectiveOtRate(rate.bill_rate || 0, rate.ot_bill_rate || 0);
    const uninvoicedShare = totalHours > 0 ? (ts.uninvoiced_hours || 0) / totalHours : 0;
    const current = byUser[ts.user_id] || { st_hours: 0, ot_hours: 0, st_cost: 0, ot_cost: 0, uninvoiced_cost: 0 };
    return {
      ...byUser,
      [ts.user_id]: {
        st_hours: current.st_hours + stHours,
        ot_hours: current.ot_hours + otHours,
        st_cost: current.st_cost + stCost,
        ot_cost: current.ot_cost + otCost,
        uninvoiced_cost: current.uninvoiced_cost + (stCost + otCost) * uninvoicedShare,
      },
    };
  }, {});
}

function toPlanNumber(value, field) {
  if (value === undefined || value === null || value === '') return '';
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > MAX_PLAN_NUMBER) {
    throw new HoursPlanError(`Plan value "${field}" must be a number between 0 and ${MAX_PLAN_NUMBER}.`);
  }
  return number;
}

// Validates a plan from the client; returns a clean copy or null to clear it.
function normalizeHoursPlan(plan) {
  if (plan === null || plan === undefined) return null;
  if (!Array.isArray(plan)) throw new HoursPlanError('Plan must be a list of engineer lines.');
  if (plan.length > MAX_PLAN_LINES) throw new HoursPlanError(`A plan can have at most ${MAX_PLAN_LINES} lines.`);
  return plan.map((line) => {
    if (!line || typeof line !== 'object') throw new HoursPlanError('Each plan line must be an object.');
    const userId = Number(line.user_id);
    if (!Number.isInteger(userId) || userId <= 0) throw new HoursPlanError('Each plan line needs an engineer.');
    const mode = PLAN_MODES.includes(line.mode) ? line.mode : 'schedule';
    const numbers = PLAN_NUMBER_FIELDS.reduce(
      (fields, field) => ({ ...fields, [field]: toPlanNumber(line[field], field) }),
      {},
    );
    return { user_id: userId, mode, ...numbers };
  });
}

function parseSavedPlan(text) {
  if (!text) return null;
  try {
    return normalizeHoursPlan(JSON.parse(text));
  } catch (error) {
    // A damaged saved plan should not block the budget view; report it as absent.
    console.error('Ignoring unreadable saved hours plan', { error: error.message });
    return null;
  }
}

function getHoursBudget(db, projectId) {
  const project = db.prepare(`
    SELECT id, name, po_number, po_amount, overtime_type, project_type, hours_plan
    FROM projects WHERE id = ?
  `).get(projectId);
  if (!project) return null;

  const engineers = db.prepare(`
    SELECT ep.user_id, u.name, COALESCE(ep.bill_rate, 0) AS bill_rate, COALESCE(ep.ot_bill_rate, 0) AS ot_bill_rate
    FROM engineer_projects ep JOIN users u ON u.id = ep.user_id
    WHERE ep.project_id = ? ORDER BY u.name
  `).all(projectId);

  const placeholders = COUNTED_STATUSES.map(() => '?').join(', ');
  const timesheets = db.prepare(`
    SELECT ts.user_id, u.name, COALESCE(ts.ot_hours, 0) AS ot_hours,
      COALESCE(SUM(te.hours), 0) AS total_hours,
      COALESCE(SUM(CASE WHEN te.invoice_id IS NULL THEN te.hours ELSE 0 END), 0) AS uninvoiced_hours
    FROM timesheets ts
    JOIN users u ON u.id = ts.user_id
    LEFT JOIN timesheet_entries te ON te.timesheet_id = ts.id
    WHERE ts.project_id = ? AND ts.status IN (${placeholders})
    GROUP BY ts.id
  `).all(projectId, ...COUNTED_STATUSES);

  const invoiced = db.prepare(`
    SELECT COALESCE(SUM(total_amount), 0) AS total FROM invoices
    WHERE project_id = ? AND voided_date IS NULL
  `).get(projectId).total;

  const rates = Object.fromEntries(engineers.map(e => [e.user_id, e]));
  const usage = summarizeTimesheets(timesheets, rates);

  // Engineers who logged time but are no longer assigned still count toward usage.
  const unassigned = timesheets
    .filter(ts => !rates[ts.user_id])
    .reduce((names, ts) => ({ ...names, [ts.user_id]: ts.name }), {});
  const people = [
    ...engineers.map(e => ({ ...e, assigned: true })),
    ...Object.entries(unassigned).map(([userId, name]) => ({
      user_id: Number(userId), name, bill_rate: 0, ot_bill_rate: 0, assigned: false,
    })),
  ];

  const engineerRows = people.map((person) => {
    const used = usage[person.user_id] || { st_hours: 0, ot_hours: 0, st_cost: 0, ot_cost: 0, uninvoiced_cost: 0 };
    return {
      ...person,
      st_hours: used.st_hours,
      ot_hours: used.ot_hours,
      st_cost: roundMoney(used.st_cost),
      ot_cost: roundMoney(used.ot_cost),
    };
  });

  const uninvoiced = roundMoney(Object.values(usage).reduce((sum, used) => sum + used.uninvoiced_cost, 0));
  const poAmount = project.po_amount || 0;

  return {
    project: {
      id: project.id,
      name: project.name,
      po_number: project.po_number,
      po_amount: poAmount,
      overtime_type: project.overtime_type || 'none',
      project_type: project.project_type,
    },
    invoiced: roundMoney(invoiced),
    uninvoiced,
    available: roundMoney(poAmount - invoiced - uninvoiced),
    engineers: engineerRows,
    plan: parseSavedPlan(project.hours_plan),
  };
}

function saveHoursPlan(db, projectId, plan) {
  const normalized = normalizeHoursPlan(plan);
  db.prepare('UPDATE projects SET hours_plan = ? WHERE id = ?')
    .run(normalized ? JSON.stringify(normalized) : null, projectId);
  return normalized;
}

module.exports = {
  getHoursBudget, saveHoursPlan, normalizeHoursPlan, summarizeTimesheets, HoursPlanError,
};
