import React, { useState, useEffect } from 'react';
import { apiFetch } from '../api';

const YEAR_BUTTON_COUNT = 5;
const MONO = { fontFamily: 'DM Mono, monospace' };

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US');
}

function toLocalIsoDate(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function getYearToDate() {
  const today = new Date();
  return { start: `${today.getFullYear()}-01-01`, end: toLocalIsoDate(today) };
}

function getYearRange(year) {
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

function escapeCsv(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function moneyColumns(item) {
  return [item.invoiced, item.engineer_cost, item.margin, item.received].map(value => value.toFixed(2));
}

function buildCsv(report) {
  const rows = [['Customer', 'Project', 'PO #', 'Invoices', 'Invoiced', 'Engineer Cost', 'Margin', 'Received']];
  for (const customer of report.customers) {
    for (const project of customer.projects) {
      rows.push([customer.customer_name, project.project_name, project.po_number || '', project.invoice_count,
        ...moneyColumns(project)]);
    }
    rows.push([`${customer.customer_name} Total`, '', '', customer.invoice_count, ...moneyColumns(customer)]);
  }
  rows.push(['Grand Total', '', '', report.totals.invoice_count, ...moneyColumns(report.totals)]);
  if (report.cash) {
    rows.push([]);
    rows.push(['Cash Basis']);
    rows.push(['Received', '', '', '', report.totals.received.toFixed(2)]);
    rows.push(['Engineer Payments (excluding owner)', '', '', '', report.cash.engineer_payments.toFixed(2)]);
    rows.push(['Cash Earned', '', '', '', report.cash.cash_earned.toFixed(2)]);
    rows.push(['Owner Pay (excluded)', '', '', '', report.cash.owner_payments_excluded.toFixed(2)]);
  }
  return rows.map(row => row.map(escapeCsv).join(',')).join('\r\n');
}

function marginColor(value) {
  if (value < 0) return 'var(--danger)';
  return value > 0 ? 'var(--success)' : undefined;
}

function downloadCsv(report, customerLabel) {
  const blob = new Blob([buildCsv(report)], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const safeLabel = customerLabel.replace(/[^A-Za-z0-9]+/g, '_');
  link.href = url;
  link.download = `Customer_Revenue_${safeLabel}_${report.period_start}_to_${report.period_end}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function CustomerRevenueReport() {
  const [range, setRange] = useState(getYearToDate());
  const [customerId, setCustomerId] = useState('');
  const [customers, setCustomers] = useState([]);
  const [report, setReport] = useState(null);
  const [expanded, setExpanded] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch('/customers')
      .then(setCustomers)
      .catch(err => setError(`Could not load customers: ${err.message}`));
  }, []);

  const currentYear = new Date().getFullYear();
  const yearButtons = Array.from({ length: YEAR_BUTTON_COUNT }, (_, i) => currentYear - i);
  const ytd = getYearToDate();
  const isSelected = (option) => range.start === option.start && range.end === option.end;
  const customerLabel = customerId
    ? (customers.find(c => String(c.id) === customerId)?.name || 'Customer')
    : 'All Customers';

  const runReport = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ period_start: range.start, period_end: range.end });
      if (customerId) params.set('customer_id', customerId);
      const data = await apiFetch(`/reports/customer-revenue?${params}`);
      setReport(data);
      setExpanded(new Set(data.customers.length === 1 ? [data.customers[0].customer_id] : []));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleCustomer = (id) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpanded(next);
  };

  const allExpanded = report && report.customers.length > 0 && expanded.size === report.customers.length;
  const toggleAll = () => setExpanded(allExpanded ? new Set() : new Set(report.customers.map(c => c.customer_id)));

  return (
    <div className="card">
      <div className="card-title no-print">Customer Revenue</div>

      <form onSubmit={runReport} className="no-print" style={{ marginBottom: 20 }}>
        <label className="form-label" style={{ marginBottom: 8, display: 'block' }}>Quick Select:</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <button type="button" className={`btn btn-sm ${isSelected(ytd) ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setRange(ytd)}>
            Year to Date
          </button>
          {yearButtons.map(year => {
            const option = getYearRange(year);
            return (
              <button key={year} type="button" className={`btn btn-sm ${isSelected(option) ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setRange(option)}>
                {year}
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">From</label>
            <input className="form-input" type="date" value={range.start} required
              onChange={e => setRange({ ...range, start: e.target.value })} />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">To</label>
            <input className="form-input" type="date" value={range.end} required
              onChange={e => setRange({ ...range, end: e.target.value })} />
          </div>
          <div className="form-group" style={{ margin: 0, minWidth: 220 }}>
            <label className="form-label">Customer</label>
            <select className="form-input" value={customerId} onChange={e => setCustomerId(e.target.value)}>
              <option value="">All Customers</option>
              {customers.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
            </select>
          </div>
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? 'Loading...' : 'Run Report'}
          </button>
          {report && report.customers.length > 0 && (
            <>
              <button className="btn btn-secondary" type="button" onClick={() => downloadCsv(report, customerLabel)}>
                Export CSV
              </button>
              <button className="btn btn-secondary" type="button" onClick={() => window.print()}>
                Print
              </button>
            </>
          )}
        </div>
      </form>

      {error && <div className="alert alert-error">{error}</div>}

      {!report ? (
        <div className="empty-state no-print">
          <h3>No report yet</h3>
          <p>Pick a date range and customer, then run the report.</p>
        </div>
      ) : report.customers.length === 0 ? (
        <div className="empty-state">
          <h3>Nothing invoiced or received</h3>
          <p>{customerLabel}, {formatDate(report.period_start)} to {formatDate(report.period_end)}.</p>
        </div>
      ) : (
        <>
          <div className="print-only" style={{ marginBottom: 16, textAlign: 'center' }}>
            <h1 style={{ margin: 0, fontSize: 22 }}>Customer Revenue</h1>
            <p style={{ margin: '6px 0 0' }}>
              {customerLabel} &middot; {formatDate(report.period_start)} to {formatDate(report.period_end)}
            </p>
          </div>

          <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)', marginBottom: 6 }}>
            Work invoiced in this period
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
            <div className="stat-card">
              <div className="stat-label">Invoiced ({report.totals.invoice_count})</div>
              <div className="stat-value" style={{ fontSize: 22 }}>{formatCurrency(report.totals.invoiced)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Engineer Cost</div>
              <div className="stat-value" style={{ fontSize: 22 }}>{formatCurrency(report.totals.engineer_cost)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Margin</div>
              <div className="stat-value" style={{ fontSize: 22, color: marginColor(report.totals.margin) }}>{formatCurrency(report.totals.margin)}</div>
              {report.totals.invoiced > 0 && (
                <div className="stat-sub">{((report.totals.margin / report.totals.invoiced) * 100).toFixed(1)}% of invoiced</div>
              )}
            </div>
          </div>

          {report.cash ? (
            <>
              <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)', marginBottom: 6 }}>
                Cash in and out in this period
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 8 }}>
                <div className="stat-card">
                  <div className="stat-label">Received</div>
                  <div className="stat-value" style={{ fontSize: 22 }}>{formatCurrency(report.totals.received)}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Engineer Payments</div>
                  <div className="stat-value" style={{ fontSize: 22 }}>{formatCurrency(report.cash.engineer_payments)}</div>
                  <div className="stat-sub">Owner pay excluded: {formatCurrency(report.cash.owner_payments_excluded)}</div>
                </div>
                <div className="stat-card accent">
                  <div className="stat-label">Cash Earned</div>
                  <div className="stat-value" style={{ fontSize: 22 }}>{formatCurrency(report.cash.cash_earned)}</div>
                  <div className="stat-sub">Received minus engineer payments</div>
                </div>
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 16px' }}>
                Cash Earned uses the actual payments made, so use it for taxes. It can dip below Margin when engineers
                are paid before customers pay their invoices.
              </p>
            </>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 16px' }}>
              Cash Earned is shown for All Customers only, since engineer payments aren't recorded per customer.
            </p>
          )}

          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px' }}>
            Invoiced counts invoices by the date they were created. Engineer Cost is the pay for the work on those
            invoices (hours &times; pay rate), leaving out anyone marked as owner. Received counts money by the date it was paid.
          </p>

          <div className="no-print" style={{ marginBottom: 8 }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={toggleAll}>
              {allExpanded ? 'Collapse All' : 'Show All Projects'}
            </button>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Customer / Project</th>
                  <th>PO #</th>
                  <th style={{ textAlign: 'right' }}>Invoices</th>
                  <th style={{ textAlign: 'right' }}>Invoiced</th>
                  <th style={{ textAlign: 'right' }}>Engineer Cost</th>
                  <th style={{ textAlign: 'right' }}>Margin</th>
                  <th style={{ textAlign: 'right' }}>Received</th>
                </tr>
              </thead>
              <tbody>
                {report.customers.map(customer => {
                  const isOpen = expanded.has(customer.customer_id);
                  return (
                    <React.Fragment key={customer.customer_id}>
                      <tr onClick={() => toggleCustomer(customer.customer_id)} style={{ cursor: 'pointer', background: 'var(--surface2)' }}>
                        <td>
                          <span className="no-print" style={{ display: 'inline-block', width: 16 }}>{isOpen ? '▾' : '▸'}</span>
                          <strong>{customer.customer_name}</strong>
                          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>
                            {customer.projects.length} project{customer.projects.length === 1 ? '' : 's'}
                          </span>
                        </td>
                        <td></td>
                        <td style={{ ...MONO, textAlign: 'right' }}>{customer.invoice_count}</td>
                        <td style={{ ...MONO, textAlign: 'right', fontWeight: 600 }}>{formatCurrency(customer.invoiced)}</td>
                        <td style={{ ...MONO, textAlign: 'right', fontWeight: 600 }}>{formatCurrency(customer.engineer_cost)}</td>
                        <td style={{ ...MONO, textAlign: 'right', fontWeight: 600, color: marginColor(customer.margin) }}>{formatCurrency(customer.margin)}</td>
                        <td style={{ ...MONO, textAlign: 'right', fontWeight: 600 }}>{formatCurrency(customer.received)}</td>
                      </tr>
                      {isOpen && customer.projects.map(project => (
                        <tr key={project.project_id}>
                          <td style={{ paddingLeft: 36 }}>{project.project_name}</td>
                          <td style={{ ...MONO, fontSize: 13 }}>{project.po_number || '-'}</td>
                          <td style={{ ...MONO, textAlign: 'right' }}>{project.invoice_count}</td>
                          <td style={{ ...MONO, textAlign: 'right' }}>{formatCurrency(project.invoiced)}</td>
                          <td style={{ ...MONO, textAlign: 'right' }}>{formatCurrency(project.engineer_cost)}</td>
                          <td style={{ ...MONO, textAlign: 'right', color: marginColor(project.margin) }}>{formatCurrency(project.margin)}</td>
                          <td style={{ ...MONO, textAlign: 'right' }}>{formatCurrency(project.received)}</td>
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 700 }}>
                  <td colSpan={2}>Total</td>
                  <td style={{ ...MONO, textAlign: 'right' }}>{report.totals.invoice_count}</td>
                  <td style={{ ...MONO, textAlign: 'right' }}>{formatCurrency(report.totals.invoiced)}</td>
                  <td style={{ ...MONO, textAlign: 'right' }}>{formatCurrency(report.totals.engineer_cost)}</td>
                  <td style={{ ...MONO, textAlign: 'right', color: marginColor(report.totals.margin) }}>{formatCurrency(report.totals.margin)}</td>
                  <td style={{ ...MONO, textAlign: 'right' }}>{formatCurrency(report.totals.received)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {report.totals.uncosted_invoice_count > 0 && (
            <div className="alert alert-info" style={{ marginTop: 12, fontSize: 13 }}>
              {report.totals.uncosted_invoice_count} invoice{report.totals.uncosted_invoice_count === 1 ? '' : 's'} had
              no engineer pay rate to cost against, so Engineer Cost treats them as $0.
            </div>
          )}
          {report.undated_invoice_count > 0 && (
            <div className="alert alert-info" style={{ marginTop: 12, fontSize: 13 }}>
              {report.undated_invoice_count} paid invoice{report.undated_invoice_count === 1 ? '' : 's'} ({formatCurrency(report.undated_received)})
              {' '}have no payment date, so they aren't counted in Received. Record a payment date on them to include them.
            </div>
          )}
        </>
      )}
    </div>
  );
}
