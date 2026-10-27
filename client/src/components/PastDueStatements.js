import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../api';
import Modal from './Modal';

const MONO = { fontFamily: 'DM Mono, monospace' };
const PREVIEW_HEIGHT = 520;

function formatCurrency(amount, symbol = '$') {
  return `${symbol}${(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatSentDate(isoString) {
  if (!isoString) return '';
  return new Date(isoString).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function groupByCustomer(overdueInvoices) {
  const groups = new Map();
  for (const invoice of overdueInvoices) {
    const existing = groups.get(invoice.customer_id) || {
      customerId: invoice.customer_id,
      customerName: invoice.customer_name,
      invoiceCount: 0,
      oldestDaysLate: 0,
      balance: 0,
    };
    groups.set(invoice.customer_id, {
      ...existing,
      invoiceCount: existing.invoiceCount + 1,
      oldestDaysLate: Math.max(existing.oldestDaysLate, invoice.days_overdue),
      balance: existing.balance + invoice.balance,
    });
  }
  return [...groups.values()].sort((a, b) => b.balance - a.balance);
}

export default function PastDueStatements({ overdueInvoices }) {
  const [lastSent, setLastSent] = useState({});
  const [lastSentError, setLastSentError] = useState('');
  const [sendingFor, setSendingFor] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');

  const loadLastSent = useCallback(async () => {
    try {
      const rows = await apiFetch('/past-due-statements/last-sent');
      setLastSent(Object.fromEntries(rows.map(row => [row.customer_id, row])));
      setLastSentError('');
    } catch (err) {
      setLastSentError(`Could not load statement history: ${err.message}`);
    }
  }, []);

  useEffect(() => { loadLastSent(); }, [loadLastSent]);

  const customers = groupByCustomer(overdueInvoices.filter(invoice => invoice.balance > 0));
  if (customers.length === 0) return null;

  const handleSent = (message) => {
    setSendingFor(null);
    setSuccessMessage(message);
    loadLastSent();
  };

  return (
    <div className="card" style={{ padding: 0, marginBottom: 20 }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>
        Past Due by Customer ({customers.length})
      </div>
      {successMessage && <div className="alert alert-success" style={{ margin: '12px 20px 0' }}>{successMessage}</div>}
      {lastSentError && <div className="alert alert-error" style={{ margin: '12px 20px 0' }}>{lastSentError}</div>}
      <div className="table-wrap">
        <table style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th>Customer</th>
              <th style={{ textAlign: 'center' }}>Late Invoices</th>
              <th style={{ textAlign: 'center' }}>Oldest (days)</th>
              <th style={{ textAlign: 'right' }}>Past Due</th>
              <th>Last Statement</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {customers.map(customer => {
              const sent = lastSent[customer.customerId];
              return (
                <tr key={customer.customerId}>
                  <td>{customer.customerName}</td>
                  <td style={{ textAlign: 'center' }}>{customer.invoiceCount}</td>
                  <td style={{ textAlign: 'center', fontWeight: 600 }}>{customer.oldestDaysLate}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600, ...MONO }}>{formatCurrency(customer.balance)}</td>
                  <td style={{ fontSize: 12, color: sent ? 'inherit' : '#94a3b8' }}>
                    {sent ? `${formatSentDate(sent.sent_at)} to ${sent.recipient}` : 'Never sent'}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-primary btn-sm" type="button" onClick={() => { setSuccessMessage(''); setSendingFor(customer); }}>
                      Send Statement
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {sendingFor && (
        <SendStatementModal customer={sendingFor} onClose={() => setSendingFor(null)} onSent={handleSent} />
      )}
    </div>
  );
}

function SendStatementModal({ customer, onClose, onSent }) {
  const [statement, setStatement] = useState(null);
  const [form, setForm] = useState({ to: '', cc: '', note: '', attach_invoices: true });
  const [loadError, setLoadError] = useState('');
  const [sendError, setSendError] = useState('');
  const [sending, setSending] = useState(false);

  const loadStatement = useCallback(async (note, isInitialLoad) => {
    try {
      const data = await apiFetch(`/customers/${customer.customerId}/past-due-statement?note=${encodeURIComponent(note)}`);
      setStatement(data);
      if (isInitialLoad) {
        setForm(previous => ({ ...previous, to: data.recipients.to, cc: data.recipients.cc.join(', ') }));
      }
      setLoadError('');
    } catch (err) {
      setLoadError(`Could not load the statement: ${err.message}`);
    }
  }, [customer.customerId]);

  useEffect(() => { loadStatement('', true); }, [loadStatement]);

  const handleSend = async () => {
    setSendError('');
    if (!form.to.trim()) { setSendError('Enter at least one recipient email.'); return; }
    setSending(true);
    try {
      const result = await apiFetch(`/customers/${customer.customerId}/past-due-statement/send`, { method: 'POST', body: form });
      onSent(result.message);
    } catch (err) {
      setSendError(err.message);
    } finally {
      setSending(false);
    }
  };

  const invoiceCount = statement?.invoices.length || 0;
  const footer = (
    <>
      <button className="btn btn-secondary" type="button" onClick={onClose} disabled={sending}>Cancel</button>
      <button className="btn btn-primary" type="button" onClick={handleSend} disabled={sending || !statement || invoiceCount === 0}>
        {sending ? 'Sending...' : 'Send Statement'}
      </button>
    </>
  );

  return (
    <Modal title={`Past Due Statement: ${customer.customerName}`} onClose={onClose} footer={footer} wide>
      {loadError && <div className="alert alert-error">{loadError}</div>}
      {sendError && <div className="alert alert-error">{sendError}</div>}
      {!statement && !loadError && <div style={{ color: '#94a3b8' }}>Loading...</div>}
      {statement && (
        <>
          <div className="form-group">
            <label className="form-label">To</label>
            <input className="form-input" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} placeholder="ap@customer.com" />
          </div>
          <div className="form-group">
            <label className="form-label">CC</label>
            <input className="form-input" value={form.cc} onChange={(e) => setForm({ ...form, cc: e.target.value })} placeholder="Separate addresses with commas" />
          </div>
          <div className="form-group">
            <label className="form-label">Note (optional, printed on the statement and in the email)</label>
            <textarea
              className="form-input"
              rows={3}
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              onBlur={() => loadStatement(form.note, false)}
              placeholder="e.g. Please let us know if any of these are on hold."
            />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, fontSize: 14 }}>
            <input type="checkbox" checked={form.attach_invoices} onChange={(e) => setForm({ ...form, attach_invoices: e.target.checked })} />
            Attach a copy of each invoice ({invoiceCount} PDF{invoiceCount === 1 ? '' : 's'})
          </label>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', marginBottom: 6 }}>Statement preview</div>
          <iframe
            title="Statement preview"
            srcDoc={statement.html}
            sandbox=""
            style={{ width: '100%', height: PREVIEW_HEIGHT, border: '1px solid var(--border)', borderRadius: 6, background: 'white' }}
          />
        </>
      )}
    </Modal>
  );
}
