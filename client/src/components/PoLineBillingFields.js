import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';

// Invoice generation for piece-rate projects with customer PO lines.
// Engineer lines bill their approved units automatically; lines without an engineer
// (parts, services you perform yourself) bill the quantity entered here.

function formatMoney(amount) {
  return `$${(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatQuantity(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

// Converts the { lineNumber: quantity } map the form keeps into the API's array
export function toPoLineQuantities(quantities) {
  return Object.entries(quantities || {})
    .map(([lineNumber, quantity]) => ({ line_number: Number(lineNumber), quantity: parseFloat(quantity) || 0 }))
    .filter(q => q.quantity > 0);
}

export default function PoLineBillingFields({ projectId, quantities, onChange }) {
  const [lines, setLines] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!projectId) {
      setLines([]);
      return undefined;
    }
    let cancelled = false;
    setError('');
    apiFetch(`/projects/${projectId}/po-line-status`)
      .then(data => { if (!cancelled) setLines(data); })
      .catch(err => { if (!cancelled) setError(`Could not load PO lines: ${err.message}`); });
    return () => { cancelled = true; };
  }, [projectId]);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (lines.length === 0) return null;

  const billableLines = lines.filter(l => !l.engineer_id);
  const remainingOf = (line) => Math.max(0, line.remaining_units);
  const setQuantity = (lineNumber, value) => onChange({ ...quantities, [lineNumber]: value });
  const fillRemaining = () => onChange(Object.fromEntries(billableLines.map(l => [l.line_number, String(remainingOf(l))])));
  const lineTotal = (line) => {
    const units = line.engineer_id ? line.approved_unbilled_units : (parseFloat(quantities?.[line.line_number]) || 0);
    return units * (line.edi_unit_price || 0);
  };
  const invoiceTotal = lines.reduce((sum, l) => sum + lineTotal(l), 0);

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 14 }}>PO Lines to Bill</strong>
        {billableLines.length > 0 && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={fillRemaining}>Bill all remaining parts &amp; services</button>
        )}
      </div>
      <div className="table-wrap">
        <table style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th>Line</th>
              <th>Description</th>
              <th style={{ textAlign: 'right' }}>Left on PO</th>
              <th style={{ textAlign: 'right' }}>Bill Now</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(line => (
              <tr key={line.line_number}>
                <td>{line.line_number}</td>
                <td>
                  {line.description}
                  <div style={{ fontSize: 11, color: '#64748b' }}>
                    {formatMoney(line.edi_unit_price)}/{line.edi_uom || 'unit'}
                    {line.engineer_id ? ` · ${line.engineer_name} reports these` : ''}
                  </div>
                </td>
                <td style={{ textAlign: 'right' }}>{formatQuantity(remainingOf(line) + (line.engineer_id ? line.approved_unbilled_units : 0))}</td>
                <td style={{ textAlign: 'right' }}>
                  {line.engineer_id ? (
                    <span title="Approved units not yet invoiced in any period">{formatQuantity(line.approved_unbilled_units)} approved</span>
                  ) : (
                    <input
                      className="form-input"
                      type="number"
                      min="0"
                      max={remainingOf(line)}
                      step="1"
                      aria-label={`Quantity to bill on line ${line.line_number}`}
                      style={{ width: 80, fontSize: 12, padding: '2px 4px', textAlign: 'right' }}
                      value={quantities?.[line.line_number] ?? ''}
                      placeholder="0"
                      onChange={(e) => setQuantity(line.line_number, e.target.value)}
                    />
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>{formatMoney(lineTotal(line))}</td>
              </tr>
            ))}
            <tr style={{ fontWeight: 600, background: '#f8fafc' }}>
              <td colSpan="4" style={{ textAlign: 'right' }}>Estimated invoice:</td>
              <td style={{ textAlign: 'right' }}>{formatMoney(invoiceTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="form-hint">
        Engineer lines bill the units they reported and you approved within the period above. Enter how many of each part or service to bill now.
      </div>
    </div>
  );
}
