// "What if" math for the project Hours Budget.
//
// A plan line is one engineer, entered either as a schedule (hours/day x days/week x weeks,
// split into straight time and overtime by the project's overtime rule) or as hours directly.

export const WEEKLY_OT_THRESHOLD = 40;
export const DAILY_OT_THRESHOLD = 8;

export const OVERTIME_RULE_LABELS = {
  none: 'No overtime',
  weekly_40: 'Overtime after 40 hrs/week',
  daily_8: 'Overtime after 8 hrs/day',
};

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function effectiveOtRate(billRate, otBillRate) {
  return otBillRate > 0 ? otBillRate : billRate;
}

// Straight-time and overtime hours in one week of the schedule.
export function splitWeek(hoursPerDay, daysPerWeek, overtimeType) {
  const perDay = toNumber(hoursPerDay);
  const days = toNumber(daysPerWeek);
  const weekly = perDay * days;
  if (overtimeType === 'weekly_40') {
    const st = Math.min(weekly, WEEKLY_OT_THRESHOLD);
    return { st, ot: weekly - st };
  }
  if (overtimeType === 'daily_8') {
    const stPerDay = Math.min(perDay, DAILY_OT_THRESHOLD);
    return { st: stPerDay * days, ot: (perDay - stPerDay) * days };
  }
  return { st: weekly, ot: 0 };
}

// Total plan hours for a line; schedule lines also report one week's split.
export function planLineHours(line, overtimeType) {
  if (line.mode === 'hours') {
    const ot = overtimeType === 'none' ? 0 : toNumber(line.otHours);
    return { st: toNumber(line.stHours), ot, weekly: null };
  }
  const week = splitWeek(line.hoursPerDay, line.daysPerWeek, overtimeType);
  const weeks = toNumber(line.weeks);
  return { st: week.st * weeks, ot: week.ot * weeks, weekly: week };
}

// engineers: [{ user_id, bill_rate, ot_bill_rate }]
export function costPlan(lines, engineers, overtimeType) {
  const ratesById = Object.fromEntries(engineers.map(e => [String(e.user_id), e]));
  const costed = lines.map((line) => {
    const rate = ratesById[String(line.user_id)] || { bill_rate: 0, ot_bill_rate: 0 };
    const otRate = effectiveOtRate(rate.bill_rate || 0, rate.ot_bill_rate || 0);
    const hours = planLineHours(line, overtimeType);
    const stCost = hours.st * (rate.bill_rate || 0);
    const otCost = hours.ot * otRate;
    const weeklyCost = hours.weekly ? hours.weekly.st * (rate.bill_rate || 0) + hours.weekly.ot * otRate : null;
    return { ...line, stHours: hours.st, otHours: hours.ot, stCost, otCost, cost: stCost + otCost, weeklyCost };
  });
  const totals = costed.reduce(
    (sum, line) => ({
      stHours: sum.stHours + line.stHours,
      otHours: sum.otHours + line.otHours,
      cost: sum.cost + line.cost,
      weeklyCost: sum.weeklyCost + (line.weeklyCost || 0),
    }),
    { stHours: 0, otHours: 0, cost: 0, weeklyCost: 0 },
  );
  return { lines: costed, totals };
}

// How far the available money goes: straight-time hours per engineer, and weeks at the
// plan's combined weekly rate (only when every line is a schedule).
export function coverage(available, engineers, costedLines) {
  const money = Math.max(available, 0);
  const straightHours = engineers
    .filter(e => e.bill_rate > 0)
    .map(e => ({ user_id: e.user_id, name: e.name, hours: money / e.bill_rate }));
  const scheduleLines = costedLines.filter(line => line.weeklyCost !== null);
  const weeklyCost = scheduleLines.reduce((sum, line) => sum + line.weeklyCost, 0);
  const allSchedules = costedLines.length > 0 && scheduleLines.length === costedLines.length;
  return {
    straightHours,
    weeks: allSchedules && weeklyCost > 0 ? money / weeklyCost : null,
    weeklyCost: allSchedules ? weeklyCost : null,
  };
}

export function newPlanLine(userId) {
  return { user_id: userId, mode: 'schedule', hoursPerDay: '', daysPerWeek: 5, weeks: '', stHours: '', otHours: '' };
}
