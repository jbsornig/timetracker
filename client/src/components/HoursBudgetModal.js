import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../api';
import Modal from './Modal';
import { costPlan, coverage, newPlanLine, OVERTIME_RULE_LABELS } from '../hours-budget';

const MUTED = '#64748b';
const GOOD = '#16a34a';
const BAD = '#dc2626';
const NUM = { textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

const money = (value) => `$${(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hrs = (value) => `${(value || 0).toLocaleString('en-US', { maximumFractionDigits: 1 })} hrs`;

function SummaryRow({ label, value, strong, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginTop: 4, fontWeight: strong ? 600 : 400, color }}>
      <span>{label}</span><span style={NUM}>{value}</span>
    </div>
  );
}

function MoneySummary({ budget }) {
  return (
    <div style={{ background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
      <SummaryRow label="PO amount" value={money(budget.project.po_amount)} />
      <SummaryRow label="Already invoiced" value={`− ${money(budget.invoiced)}`} />
      <SummaryRow label="Timesheets not yet invoiced" value={`− ${money(budget.uninvoiced)}`} />
      <div style={{ borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 2 }}>
        <SummaryRow label="Still available" value={money(budget.available)} strong color={budget.available < 0 ? BAD : GOOD} />
      </div>
      <div style={{ fontSize: 11, color: MUTED, marginTop: 6 }}>
        {OVERTIME_RULE_LABELS[budget.project.overtime_type] || OVERTIME_RULE_LABELS.none}. Counts submitted and approved timesheets; drafts are not included.
      </div>
    </div>
  );
}

function UsageTable({ engineers, showOt }) {
  if (engineers.length === 0) return <p style={{ fontSize: 13, color: MUTED }}>No engineers assigned yet.</p>;
  return (
    <div className="table-wrap" style={{ marginBottom: 16 }}>
      <table>
        <thead>
          <tr>
            <th>Engineer</th>
            <th style={NUM}>Rate</th>
            <th style={NUM}>Straight hrs</th>
            {showOt && <th style={NUM}>OT hrs</th>}
            <th style={NUM}>Cost so far</th>
          </tr>
        </thead>
        <tbody>
          {engineers.map(e => (
            <tr key={e.user_id}>
              <td>{e.name}{!e.assigned && <span style={{ fontSize: 11, color: MUTED }}> (no longer assigned)</span>}</td>
              <td style={NUM}>{money(e.bill_rate)}{showOt && e.ot_bill_rate > 0 && <span style={{ color: MUTED }}> / {money(e.ot_bill_rate)} OT</span>}</td>
              <td style={NUM}>{hrs(e.st_hours)}</td>
              {showOt && <td style={NUM}>{hrs(e.ot_hours)}</td>}
              <td style={NUM}>{money(e.st_cost + e.ot_cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NumberInput({ value, onChange, label, width = 70 }) {
  return (
    <input className="form-input" type="number" min="0" step="any" value={value} aria-label={label}
      onChange={(e) => onChange(e.target.value)} style={{ width, padding: '4px 6px', fontSize: 13 }} />
  );
}

const SELECT_STYLE = { width: 'auto', padding: '4px 6px', fontSize: 13 };

function PlanLine({ line, costed, engineers, showOt, onChange, onRemove }) {
  const update = (field) => (value) => onChange({ ...line, [field]: value });
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
      <select className="form-select" value={line.user_id} onChange={(e) => update('user_id')(e.target.value)} style={{ ...SELECT_STYLE, minWidth: 150 }} aria-label="Engineer">
        {engineers.map(e => <option key={e.user_id} value={e.user_id}>{e.name}</option>)}
      </select>
      <select className="form-select" value={line.mode} onChange={(e) => update('mode')(e.target.value)} style={SELECT_STYLE} aria-label="Plan type">
        <option value="schedule">By schedule</option>
        <option value="hours">By hours</option>
      </select>
      {line.mode === 'schedule' ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
          <NumberInput value={line.hoursPerDay} onChange={update('hoursPerDay')} label="Hours per day" width={56} /> hrs/day ×
          <NumberInput value={line.daysPerWeek} onChange={update('daysPerWeek')} label="Days per week" width={48} /> days ×
          <NumberInput value={line.weeks} onChange={update('weeks')} label="Weeks" width={56} /> weeks
        </span>
      ) : (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
          <NumberInput value={line.stHours} onChange={update('stHours')} label="Straight hours" /> straight
          {showOt && <><NumberInput value={line.otHours} onChange={update('otHours')} label="Overtime hours" /> OT</>}
        </span>
      )}
      <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 12, whiteSpace: 'nowrap' }}>
        <span style={{ ...NUM, color: MUTED }}>{hrs(costed.stHours)}{showOt && costed.otHours > 0 && ` + ${hrs(costed.otHours)} OT`}</span>
        <strong style={NUM}>{money(costed.cost)}</strong>
        <button className="btn btn-ghost btn-sm" onClick={onRemove} aria-label="Remove line">×</button>
      </span>
    </div>
  );
}

function PlanResult({ budget, plan }) {
  const left = budget.available - plan.totals.cost;
  const reach = coverage(budget.available, budget.engineers.filter(e => e.assigned), plan.lines);
  return (
    <div style={{ background: left < 0 ? '#fef2f2' : '#f0fdf4', border: `1px solid ${left < 0 ? '#fecaca' : '#bbf7d0'}`, borderRadius: 8, padding: '10px 14px' }}>
      {plan.lines.length > 0 && (
        <>
          <SummaryRow label={`Plan: ${hrs(plan.totals.stHours)} straight${plan.totals.otHours > 0 ? ` + ${hrs(plan.totals.otHours)} OT` : ''}`} value={money(plan.totals.cost)} />
          <SummaryRow label={left < 0 ? 'Over budget by' : 'Left after plan'} value={money(Math.abs(left))} strong color={left < 0 ? BAD : GOOD} />
        </>
      )}
      <div style={{ fontSize: 12, color: MUTED, marginTop: plan.lines.length > 0 ? 8 : 0 }}>
        {reach.weeks !== null && <div>The available money covers <strong>{reach.weeks.toFixed(1)} weeks</strong> at this plan ({money(reach.weeklyCost)}/week).</div>}
        {reach.straightHours.map((r, i) => (
          <div key={r.user_id}>
            {reach.weeks !== null || i > 0 ? 'Or' : 'The available money covers'} {hrs(r.hours)} of straight time for {r.name}.
          </div>
        ))}
      </div>
    </div>
  );
}

export default function HoursBudgetModal({ projectId, onClose }) {
  const [budget, setBudget] = useState(null);
  const [lines, setLines] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch(`/projects/${projectId}/hours-budget`)
      .then((data) => { setBudget(data); setLines(data.plan || []); })
      .catch((e) => setError(`Couldn't load the budget: ${e.message}`));
  }, [projectId]);

  const savePlan = useCallback(async (plan) => {
    setSaving(true);
    setError('');
    try {
      await apiFetch(`/projects/${projectId}/hours-plan`, { method: 'PUT', body: { plan } });
      setDirty(false);
      return true;
    } catch (e) {
      setError(`Couldn't save the plan: ${e.message}`);
      return false;
    } finally {
      setSaving(false);
    }
  }, [projectId]);

  const handleClose = useCallback(async () => {
    if (dirty && lines.length > 0 && window.confirm('Save this plan with the project so it is here next time?')) {
      if (!(await savePlan(lines))) return;
    }
    onClose();
  }, [dirty, lines, onClose, savePlan]);

  const changeLines = (next) => { setLines(next); setDirty(true); };
  const assigned = budget ? budget.engineers.filter(e => e.assigned) : [];
  const showOt = budget ? budget.project.overtime_type !== 'none' : false;
  const plan = budget ? costPlan(lines, assigned, budget.project.overtime_type) : null;

  const footer = (
    <>
      {lines.length > 0 && <button className="btn btn-secondary" disabled={saving} onClick={() => { changeLines([]); savePlan(null); }}>Clear Plan</button>}
      <button className="btn btn-secondary" disabled={saving || !dirty} onClick={() => savePlan(lines)}>{saving ? 'Saving...' : 'Save Plan'}</button>
      <button className="btn btn-primary" onClick={handleClose}>Done</button>
    </>
  );

  return (
    <Modal title={budget ? `Hours Budget — ${budget.project.name}` : 'Hours Budget'} onClose={handleClose} footer={footer} wide>
      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}
      {!budget && !error && <p style={{ color: MUTED }}>Loading...</p>}
      {budget && (
        <>
          <MoneySummary budget={budget} />
          <div className="card-title" style={{ fontSize: 14 }}>Hours used so far</div>
          <UsageTable engineers={budget.engineers} showOt={showOt} />
          <div className="card-title" style={{ fontSize: 14 }}>What if</div>
          {assigned.length === 0 ? (
            <p style={{ fontSize: 13, color: MUTED }}>Assign an engineer to the project to plan hours.</p>
          ) : (
            <>
              {lines.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  {lines.map((line, i) => (
                    <PlanLine key={i} line={line} costed={plan.lines[i]} engineers={assigned} showOt={showOt}
                      onChange={(next) => changeLines(lines.map((l, j) => (j === i ? next : l)))}
                      onRemove={() => changeLines(lines.filter((_, j) => j !== i))} />
                  ))}
                </div>
              )}
              <button className="btn btn-secondary btn-sm" style={{ margin: '4px 0 12px' }}
                onClick={() => changeLines([...lines, newPlanLine(assigned[0].user_id)])}>+ Add Engineer to Plan</button>
              <PlanResult budget={budget} plan={plan} />
            </>
          )}
        </>
      )}
    </Modal>
  );
}
