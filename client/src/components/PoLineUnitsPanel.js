import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';

// Piece-rate projects with customer PO lines: an engineer reports units against the PO line(s)
// they are assigned to and is paid that line's rate per unit.

function formatMoney(amount) {
  return `$${(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Loads the PO lines the engineer (or the engineer an admin is acting as) reports units on
export function useMyPoLines(projectId, actingUserId, enabled) {
  const [state, setState] = useState({ lines: [], loading: false, error: '' });

  useEffect(() => {
    if (!enabled || !projectId) {
      setState({ lines: [], loading: false, error: '' });
      return undefined;
    }
    let cancelled = false;
    setState({ lines: [], loading: true, error: '' });
    const query = actingUserId ? `?user_id=${encodeURIComponent(actingUserId)}` : '';
    apiFetch(`/projects/${projectId}/my-po-lines${query}`)
      .then(lines => { if (!cancelled) setState({ lines, loading: false, error: '' }); })
      .catch(err => { if (!cancelled) setState({ lines: [], loading: false, error: `Could not load PO lines: ${err.message}` }); });
    return () => { cancelled = true; };
  }, [projectId, actingUserId, enabled]);

  return state;
}

export function findSelectedLine(lines, lineNumber) {
  if (lines.length === 1) return lines[0];
  return lines.find(l => String(l.line_number) === String(lineNumber)) || null;
}

export default function PoLineUnitsPanel({ lines, lineNumber, onLineChange, units }) {
  const selected = findSelectedLine(lines, lineNumber);
  const unitCount = parseFloat(units) || 0;
  const overLimit = selected && unitCount > selected.remaining_units;

  return (
    <>
      <div style={{ background: '#f0f9ff', padding: 12, borderRadius: 8, marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: '#0369a1', fontWeight: 600, marginBottom: 4 }}>Piece Rate — PO Line</div>
        {lines.length > 1 ? (
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" htmlFor="po-line-select">PO Line *</label>
            <select id="po-line-select" className="form-select" value={lineNumber || ''} onChange={(e) => onLineChange(e.target.value)}>
              <option value="">Select the line you built...</option>
              {lines.map(l => (
                <option key={l.line_number} value={l.line_number}>Line {l.line_number} — {l.description}</option>
              ))}
            </select>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: '#1e293b' }}>Line {lines[0].line_number} — {lines[0].description}</div>
        )}
        {selected && (
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 6 }}>
            Pay rate: <strong>{formatMoney(selected.pay_per_unit)}/unit</strong>
            {' · '}{selected.remaining_units} of {selected.po_quantity} units left on the PO
          </div>
        )}
      </div>
      {selected && unitCount > 0 && (
        <div style={{ background: overLimit ? '#fef2f2' : '#f0fdf4', padding: 12, borderRadius: 8, marginBottom: 12 }}>
          {overLimit ? (
            <div style={{ fontSize: 13, fontWeight: 600, color: '#dc2626' }}>
              Only {selected.remaining_units} units are left on this PO line.
            </div>
          ) : (
            <>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#16a34a' }}>Your Pay: {formatMoney(unitCount * selected.pay_per_unit)}</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>{unitCount} units x {formatMoney(selected.pay_per_unit)}/unit</div>
            </>
          )}
        </div>
      )}
    </>
  );
}
