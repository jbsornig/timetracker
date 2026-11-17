import { splitWeek, planLineHours, costPlan, coverage, effectiveOtRate } from './hours-budget';

const engineers = [
  { user_id: 1, name: 'Brad', bill_rate: 85, ot_bill_rate: 105 },
  { user_id: 2, name: 'Ana', bill_rate: 80, ot_bill_rate: 0 },
];

describe('splitWeek', () => {
  it('puts everything in straight time when the project has no overtime', () => {
    expect(splitWeek(10, 5, 'none')).toEqual({ st: 50, ot: 0 });
  });

  it('splits at 40 hours a week for weekly overtime', () => {
    expect(splitWeek(10, 5, 'weekly_40')).toEqual({ st: 40, ot: 10 });
    expect(splitWeek(8, 4, 'weekly_40')).toEqual({ st: 32, ot: 0 });
  });

  it('splits at 8 hours a day for daily overtime', () => {
    expect(splitWeek(10, 5, 'daily_8')).toEqual({ st: 40, ot: 10 });
    expect(splitWeek(10, 3, 'daily_8')).toEqual({ st: 24, ot: 6 });
  });

  it('treats blank or negative input as zero', () => {
    expect(splitWeek('', 5, 'weekly_40')).toEqual({ st: 0, ot: 0 });
    expect(splitWeek(-4, 5, 'none')).toEqual({ st: 0, ot: 0 });
  });
});

describe('planLineHours', () => {
  it('multiplies a schedule by the number of weeks', () => {
    const hours = planLineHours({ mode: 'schedule', hoursPerDay: 10, daysPerWeek: 5, weeks: 6 }, 'weekly_40');
    expect(hours).toEqual({ st: 240, ot: 60, weekly: { st: 40, ot: 10 } });
  });

  it('uses entered hours directly, ignoring overtime on a no-overtime project', () => {
    expect(planLineHours({ mode: 'hours', stHours: '200', otHours: '30' }, 'weekly_40')).toEqual({ st: 200, ot: 30, weekly: null });
    expect(planLineHours({ mode: 'hours', stHours: '200', otHours: '30' }, 'none')).toEqual({ st: 200, ot: 0, weekly: null });
  });
});

describe('costPlan', () => {
  it('costs straight time and overtime at each engineer\'s rates', () => {
    const { lines, totals } = costPlan(
      [{ user_id: 1, mode: 'schedule', hoursPerDay: 10, daysPerWeek: 5, weeks: 2 }],
      engineers, 'weekly_40',
    );
    expect(lines[0].cost).toBe(80 * 85 + 20 * 105);
    expect(lines[0].weeklyCost).toBe(40 * 85 + 10 * 105);
    expect(totals).toEqual({ stHours: 80, otHours: 20, cost: 8900, weeklyCost: 4450 });
  });

  it('bills overtime at the straight rate when no overtime rate is set', () => {
    const { lines } = costPlan([{ user_id: '2', mode: 'hours', stHours: 10, otHours: 5 }], engineers, 'weekly_40');
    expect(lines[0].cost).toBe(15 * 80);
  });

  it('does not mutate the plan lines', () => {
    const line = { user_id: 1, mode: 'hours', stHours: 10, otHours: 0 };
    costPlan([line], engineers, 'none');
    expect(line).toEqual({ user_id: 1, mode: 'hours', stHours: 10, otHours: 0 });
  });
});

describe('coverage', () => {
  it('reports straight-time hours per engineer and weeks at the plan rate', () => {
    const { lines } = costPlan([{ user_id: 1, mode: 'schedule', hoursPerDay: 10, daysPerWeek: 5, weeks: 1 }], engineers, 'weekly_40');
    const result = coverage(8900, engineers, lines);
    expect(result.straightHours.map(r => Math.round(r.hours))).toEqual([105, 111]);
    expect(result.weeks).toBe(2);
  });

  it('gives no week count when any line is entered as hours', () => {
    const { lines } = costPlan([{ user_id: 1, mode: 'hours', stHours: 10 }], engineers, 'none');
    expect(coverage(1000, engineers, lines).weeks).toBeNull();
  });

  it('treats an overspent budget as zero money left', () => {
    expect(coverage(-500, engineers, []).straightHours[0].hours).toBe(0);
  });
});

it('effectiveOtRate falls back to the straight rate', () => {
  expect(effectiveOtRate(85, 0)).toBe(85);
  expect(effectiveOtRate(85, 105)).toBe(105);
});
