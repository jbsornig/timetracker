import React, { useState, useEffect } from 'react';
import { apiFetch } from '../api';

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount || 0);
}

function getDefaultDates() {
  const end = new Date();
  const start = new Date();
  start.setDate(1);
  return {
    period_start: start.toISOString().split('T')[0],
    period_end: end.toISOString().split('T')[0],
  };
}

export default function Reports() {
  const [activeTab, setActiveTab] = useState('payroll');
  const [payrollData, setPayrollData] = useState([]);
  const [budgetData, setBudgetData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState(getDefaultDates());
  const [error, setError] = useState('');

  useEffect(() => {
    if (activeTab === 'budget') {
      loadBudgetData();
    }
  }, [activeTab]);

  const loadPayrollData = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch(
        `/reports/payroll?period_start=${dateRange.period_start}&period_end=${dateRange.period_end}`
      );
      setPayrollData(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadBudgetData = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch('/reports/project-budget');
      setBudgetData(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRunPayroll = (e) => {
    e.preventDefault();
    loadPayrollData();
  };

  const payrollTotals = payrollData.reduce(
    (acc, row) => ({
      hours: acc.hours + (row.total_hours || 0),
      pay: acc.pay + (row.total_pay || 0),
      billed: acc.billed + (row.total_billed || 0),
    }),
    { hours: 0, pay: 0, billed: 0 }
  );

  const budgetTotals = budgetData.reduce(
    (acc, row) => ({
      po: acc.po + (row.po_amount || 0),
      billed: acc.billed + (row.amount_billed || 0),
      remaining: acc.remaining + (row.remaining || 0),
    }),
    { po: 0, billed: 0, remaining: 0 }
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Reports</div>
          <div className="page-subtitle">Payroll and project budget reports</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className={`btn ${activeTab === 'payroll' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('payroll')}
          >
            Payroll Report
          </button>
          <button
            className={`btn ${activeTab === 'budget' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('budget')}
          >
            Project Budget Report
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {activeTab === 'payroll' && (
        <div className="card">
          <div className="card-title">Payroll Report</div>

          <form onSubmit={handleRunPayroll} style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Period Start</label>
                <input
                  className="form-input"
                  type="date"
                  value={dateRange.period_start}
                  onChange={(e) => setDateRange({ ...dateRange, period_start: e.target.value })}
                />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Period End</label>
                <input
                  className="form-input"
                  type="date"
                  value={dateRange.period_end}
                  onChange={(e) => setDateRange({ ...dateRange, period_end: e.target.value })}
                />
              </div>
              <button className="btn btn-primary" type="submit" disabled={loading}>
                {loading ? 'Loading...' : 'Run Report'}
              </button>
              {payrollData.length > 0 && (
                <button className="btn btn-secondary" type="button" onClick={() => window.print()}>
                  Print Report
                </button>
              )}
            </div>
          </form>

          {payrollData.length === 0 ? (
            <div className="empty-state">
              <h3>No data</h3>
              <p>Select a date range and run the report to see payroll data.</p>
            </div>
          ) : (
            <>
              {/* Print Header */}
              <div className="print-only" style={{ display: 'none', marginBottom: 20, textAlign: 'center' }}>
                <h1 style={{ margin: 0, fontSize: 24 }}>Engineer Payroll Report</h1>
                <p style={{ margin: '8px 0 0', color: '#666' }}>
                  Period: {new Date(dateRange.period_start + 'T00:00:00').toLocaleDateString()} - {new Date(dateRange.period_end + 'T00:00:00').toLocaleDateString()}
                </p>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Engineer</th>
                      <th>Engineer ID</th>
                      <th>Project</th>
                      <th>PO #</th>
                      <th>Hours</th>
                      <th>Pay Rate</th>
                      <th>Total Pay</th>
                      <th>Bill Rate</th>
                      <th>Total Billed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payrollData.map((row, idx) => (
                      <tr key={idx}>
                        <td><strong>{row.engineer_name}</strong></td>
                        <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 13 }}>{row.engineer_id || '—'}</td>
                        <td>{row.project_name}</td>
                        <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 13 }}>{row.po_number || '—'}</td>
                        <td style={{ fontFamily: 'DM Mono, monospace' }}>{(row.total_hours || 0).toFixed(2)}</td>
                        <td style={{ fontFamily: 'DM Mono, monospace' }}>{formatCurrency(row.pay_rate)}/hr</td>
                        <td style={{ fontFamily: 'DM Mono, monospace', fontWeight: 600 }}>{formatCurrency(row.total_pay)}</td>
                        <td style={{ fontFamily: 'DM Mono, monospace' }}>{formatCurrency(row.bill_rate)}/hr</td>
                        <td style={{ fontFamily: 'DM Mono, monospace' }}>{formatCurrency(row.total_billed)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: 'var(--surface2)', fontWeight: 600 }}>
                      <td colSpan={4}>Totals</td>
                      <td style={{ fontFamily: 'DM Mono, monospace' }}>{payrollTotals.hours.toFixed(2)}</td>
                      <td></td>
                      <td style={{ fontFamily: 'DM Mono, monospace' }}>{formatCurrency(payrollTotals.pay)}</td>
                      <td></td>
                      <td style={{ fontFamily: 'DM Mono, monospace' }}>{formatCurrency(payrollTotals.billed)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                <div className="stat-card">
                  <div className="stat-label">Total Hours</div>
                  <div className="stat-value">{payrollTotals.hours.toFixed(1)}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Total Pay Owed</div>
                  <div className="stat-value" style={{ fontSize: 22 }}>{formatCurrency(payrollTotals.pay)}</div>
                </div>
                <div className="stat-card accent">
                  <div className="stat-label">Total Billable</div>
                  <div className="stat-value" style={{ fontSize: 22 }}>{formatCurrency(payrollTotals.billed)}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Gross Margin</div>
                  <div className="stat-value" style={{ fontSize: 22, color: 'var(--success)' }}>
                    {formatCurrency(payrollTotals.billed - payrollTotals.pay)}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === 'budget' && (
        <div className="card">
          <div className="card-title">Project Budget Report</div>

          {loading ? (
            <div style={{ padding: 40, color: '#94a3b8', textAlign: 'center' }}>Loading...</div>
          ) : budgetData.length === 0 ? (
            <div className="empty-state">
              <h3>No projects</h3>
              <p>Create projects to see budget data.</p>
            </div>
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>Customer</th>
                      <th>PO #</th>
                      <th>PO Amount</th>
                      <th>Hours Used</th>
                      <th>Amount Billed</th>
                      <th>Remaining</th>
                      <th style={{ minWidth: 140 }}>Usage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {budgetData.map((row) => {
                      const pct = row.po_amount > 0 ? (row.amount_billed / row.po_amount) * 100 : 0;
                      const cls = pct >= 90 ? 'progress-danger' : pct >= 70 ? 'progress-warn' : 'progress-good';
                      return (
                        <tr key={row.id}>
                          <td><strong>{row.project_name}</strong></td>
                          <td>{row.customer_name}</td>
                          <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 13 }}>{row.po_number || '—'}</td>
                          <td style={{ fontFamily: 'DM Mono, monospace' }}>{formatCurrency(row.po_amount)}</td>
                          <td style={{ fontFamily: 'DM Mono, monospace' }}>{(row.total_hours || 0).toFixed(2)}</td>
                          <td style={{ fontFamily: 'DM Mono, monospace' }}>{formatCurrency(row.amount_billed)}</td>
                          <td style={{ fontFamily: 'DM Mono, monospace', color: row.remaining < 0 ? 'var(--danger)' : undefined }}>
                            {formatCurrency(row.remaining)}
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div className="progress-bar" style={{ flex: 1 }}>
                                <div className={`progress-fill ${cls}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                              </div>
                              <span style={{ fontSize: 12, color: '#64748b', minWidth: 36 }}>{pct.toFixed(0)}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: 'var(--surface2)', fontWeight: 600 }}>
                      <td colSpan={3}>Totals</td>
                      <td style={{ fontFamily: 'DM Mono, monospace' }}>{formatCurrency(budgetTotals.po)}</td>
                      <td></td>
                      <td style={{ fontFamily: 'DM Mono, monospace' }}>{formatCurrency(budgetTotals.billed)}</td>
                      <td style={{ fontFamily: 'DM Mono, monospace', color: budgetTotals.remaining < 0 ? 'var(--danger)' : undefined }}>
                        {formatCurrency(budgetTotals.remaining)}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                <div className="stat-card">
                  <div className="stat-label">Total PO Value</div>
                  <div className="stat-value" style={{ fontSize: 22 }}>{formatCurrency(budgetTotals.po)}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Total Billed</div>
                  <div className="stat-value" style={{ fontSize: 22 }}>{formatCurrency(budgetTotals.billed)}</div>
                </div>
                <div className="stat-card accent">
                  <div className="stat-label">Total Remaining</div>
                  <div className="stat-value" style={{ fontSize: 22 }}>{formatCurrency(budgetTotals.remaining)}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Overall Usage</div>
                  <div className="stat-value">
                    {budgetTotals.po > 0 ? ((budgetTotals.billed / budgetTotals.po) * 100).toFixed(1) : 0}%
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
