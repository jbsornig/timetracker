const test = require('node:test');
const assert = require('node:assert');
const { summarizeTimesheets, normalizeHoursPlan, HoursPlanError } = require('./hours-budget');

const rates = { 1: { bill_rate: 85, ot_bill_rate: 105 }, 2: { bill_rate: 80, ot_bill_rate: 0 } };

test('splits straight time and overtime per timesheet and costs each at its rate', () => {
  const usage = summarizeTimesheets([{ user_id: 1, total_hours: 50, uninvoiced_hours: 0, ot_hours: 10 }], rates);
  assert.deepStrictEqual(usage[1], { st_hours: 40, ot_hours: 10, st_cost: 3400, ot_cost: 1050, uninvoiced_cost: 0 });
});

test('an overtime rate of 0 bills overtime at the straight-time rate', () => {
  const usage = summarizeTimesheets([{ user_id: 2, total_hours: 45, uninvoiced_hours: 45, ot_hours: 5 }], rates);
  assert.strictEqual(usage[2].ot_cost, 400);
  assert.strictEqual(usage[2].uninvoiced_cost, 3600);
});

test('adds up several timesheets for the same engineer', () => {
  const usage = summarizeTimesheets([
    { user_id: 1, total_hours: 40, uninvoiced_hours: 40, ot_hours: 0 },
    { user_id: 1, total_hours: 50, uninvoiced_hours: 0, ot_hours: 10 },
  ], rates);
  assert.strictEqual(usage[1].st_hours, 80);
  assert.strictEqual(usage[1].ot_hours, 10);
  assert.strictEqual(usage[1].uninvoiced_cost, 3400);
});

test('overtime never exceeds the hours on the timesheet', () => {
  const usage = summarizeTimesheets([{ user_id: 1, total_hours: 5, uninvoiced_hours: 5, ot_hours: 8 }], rates);
  assert.strictEqual(usage[1].st_hours, 0);
  assert.strictEqual(usage[1].ot_hours, 5);
});

test('engineers with no rate on the project cost nothing instead of failing', () => {
  const usage = summarizeTimesheets([{ user_id: 9, total_hours: 10, uninvoiced_hours: 10, ot_hours: 0 }], rates);
  assert.strictEqual(usage[9].st_cost, 0);
});

test('normalizeHoursPlan keeps valid lines and clears with null', () => {
  assert.strictEqual(normalizeHoursPlan(null), null);
  assert.deepStrictEqual(
    normalizeHoursPlan([{ user_id: '3', mode: 'schedule', hoursPerDay: '10', daysPerWeek: 5, weeks: 6, stHours: '', otHours: undefined }]),
    [{ user_id: 3, mode: 'schedule', hoursPerDay: 10, daysPerWeek: 5, weeks: 6, stHours: '', otHours: '' }],
  );
});

test('normalizeHoursPlan defaults an unknown mode to schedule', () => {
  assert.strictEqual(normalizeHoursPlan([{ user_id: 1, mode: 'other' }])[0].mode, 'schedule');
});

test('normalizeHoursPlan rejects bad input', () => {
  for (const bad of ['text', [{ user_id: 0 }], [{ user_id: 1, weeks: -1 }], [{ user_id: 1, stHours: 'abc' }], [null]]) {
    assert.throws(() => normalizeHoursPlan(bad), HoursPlanError);
  }
  assert.throws(() => normalizeHoursPlan(Array.from({ length: 51 }, () => ({ user_id: 1 }))), HoursPlanError);
});
