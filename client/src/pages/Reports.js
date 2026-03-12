import React, { useState, useEffect } from 'react';
import { apiFetch } from '../api';
import Modal from '../components/Modal';

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount || 0);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr.split('T')[0] + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
  });
}

// Get month options for quick selection
function getMonthOptions() {
  const options = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    options.push({
      label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      start: new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0],
      end: new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0],
    });
  }
  return options;
}

// Get year options
function getYearOptions() {
  const options = [];
  const currentYear = new Date().getFullYear();
  for (let i = 0; i < 5; i++) {
    const year = currentYear - i;
    options.push({
      label: year.toString(),
      start: `${year}-01-01`,
      end: `${year}-12-31`,
    });
  }
  return options;
}

function getDefaultDates() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    period_start: start.toISOString().split('T')[0],
    period_end: end.toISOString().split('T')[0],
  };
}

export default function Reports() {
  const [activeTab, setActiveTab] = useState('payroll');
  const [payrollData, setPayrollData] = useState([]);
  const [payrollHolidays, setPayrollHolidays] = useState([]);
  const [budgetData, setBudgetData] = useState([]);
  const [invoicedData, setInvoicedData] = useState([]);
  const [contractHoursData, setContractHoursData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState(getDefaultDates());
  const [invoicedDateRange, setInvoicedDateRange] = useState(getDefaultDates());
  const [error, setError] = useState('');
  const [achModal, setAchModal] = useState(false);
  const [achDeliveryDate, setAchDeliveryDate] = useState('');

  const monthOptions = getMonthOptions();
  const yearOptions = getYearOptions();

  useEffect(() => {
    if (activeTab === 'budget') {
      loadBudgetData();
    } else if (activeTab === 'contract-hours') {
      loadContractHoursData();
    }
  }, [activeTab]);

  const loadPayrollData = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiFetch(
        `/reports/payroll?period_start=${dateRange.period_start}&period_end=${dateRange.period_end}`
      );
      setPayrollData(response.data || []);
      setPayrollHolidays(response.holidays || []);
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

  const loadInvoicedData = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch(
        `/reports/invoiced?period_start=${invoicedDateRange.period_start}&period_end=${invoicedDateRange.period_end}`
      );
      setInvoicedData(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadContractHoursData = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch('/reports/contract-hours');
      setContractHoursData(data);
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

  const handleRunInvoiced = (e) => {
    e.preventDefault();
    loadInvoicedData();
  };

  const openAchModal = () => {
    // Default delivery date to 2 business days from now
    const date = new Date();
    date.setDate(date.getDate() + 2);
    // Skip weekends
    while (date.getDay() === 0 || date.getDay() === 6) {
      date.setDate(date.getDate() + 1);
    }
    setAchDeliveryDate(date.toISOString().split('T')[0]);
    setAchModal(true);
  };

  const handleAchExport = async () => {
    try {
      const API_BASE = process.env.REACT_APP_API_URL || '';
      const token = localStorage.getItem('tt_token');
      const url = `${API_BASE}/api/payroll/ach-export?period_start=${dateRange.period_start}&period_end=${dateRange.period_end}&delivery_date=${achDeliveryDate}`;

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Export failed');
      }

      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `ACH_Payroll_${achDeliveryDate.replace(/-/g, '')}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);
      setAchModal(false);
    } catch (e) {
      alert('ACH Export Error: ' + e.message);
    }
  };

  const selectMonth = (option) => {
    setDateRange({ period_start: option.start, period_end: option.end });
  };

  const selectInvoicedPeriod = (option) => {
    setInvoicedDateRange({ period_start: option.start, period_end: option.end });
  };

  // Group payroll by engineer for summary
  const payrollByEngineer = payrollData.reduce((acc, row) => {
    const key = row.engineer_name;
    if (!acc[key]) {
      acc[key] = { engineer_name: row.engineer_name, engineer_id: row.engineer_id, total_hours: 0, total_pay: 0, holiday_hours: 0, holiday_pay: 0 };
    }
    if (row.is_holiday_pay) {
      acc[key].holiday_hours += row.total_hours || 0;
      acc[key].holiday_pay += row.total_pay || 0;
    } else {
      acc[key].total_hours += row.total_hours || 0;
    }
    acc[key].total_pay += row.total_pay || 0;
    return acc;
  }, {});
  const payrollSummary = Object.values(payrollByEngineer);

  const payrollTotals = payrollData.reduce(
    (acc, row) => ({
      hours: acc.hours + (row.is_holiday_pay ? 0 : (row.total_hours || 0)),
      holidayHours: acc.holidayHours + (row.is_holiday_pay ? (row.total_hours || 0) : 0),
      pay: acc.pay + (row.total_pay || 0),
      billed: acc.billed + (row.total_billed || 0),
    }),
    { hours: 0, holidayHours: 0, pay: 0, billed: 0 }
  );

  const budgetTotals = budgetData.reduce(
    (acc, row) => ({
      po: acc.po + (row.po_amount || 0),
      billed: acc.billed + (row.amount_billed || 0),
      remaining: acc.remaining + (row.remaining || 0),
    }),
    { po: 0, billed: 0, remaining: 0 }
  );

  const invoicedTotals = invoicedData.reduce(
    (acc, row) => ({
      count: acc.count + 1,
      total: acc.total + (row.total_amount || 0),
      paid: acc.paid + (row.amount_paid || 0),
      outstanding: acc.outstanding + ((row.total_amount || 0) - (row.amount_paid || 0)),
    }),
    { count: 0, total: 0, paid: 0, outstanding: 0 }
  );

  return (
    <div>
      <div className="page-header no-print">
        <div>
          <div className="page-title">Reports</div>
          <div className="page-subtitle">Payroll, invoicing, and project budget reports</div>
        </div>
      </div>

      <div className="card no-print" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className={`btn ${activeTab === 'payroll' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('payroll')}
          >
            Payroll Report
          </button>
          <button
            className={`btn ${activeTab === 'invoiced' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('invoiced')}
          >
            Invoiced Report
          </button>
          <button
            className={`btn ${activeTab === 'budget' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('budget')}
          >
            Project Budget Report
          </button>
          <button
            className={`btn ${activeTab === 'contract-hours' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('contract-hours')}
          >
            Contract Hours
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error no-print">{error}</div>}

      {activeTab === 'payroll' && (
        <div className="card">
          <div className="card-title no-print">Payroll Report</div>

          <form onSubmit={handleRunPayroll} className="no-print" style={{ marginBottom: 24 }}>
            <div style={{ marginBottom: 12 }}>
              <label className="form-label" style={{ marginBottom: 8, display: 'block' }}>Quick Select Month:</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {monthOptions.slice(0, 6).map((opt, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className={`btn btn-sm ${dateRange.period_start === opt.start ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => selectMonth(opt)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
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
                <>
                  <button className="btn btn-secondary" type="button" onClick={() => window.print()}>
                    Print Report
                  </button>
                  <button className="btn btn-secondary" type="button" onClick={openAchModal}>
                    Generate ACH File
                  </button>
                </>
              )}
            </div>
          </form>

          {payrollData.length === 0 ? (
            <div className="empty-state no-print">
              <h3>No data</h3>
              <p>Select a date range and run the report to see payroll data.</p>
            </div>
          ) : (
            <>
              {/* Print Header */}
              <div className="print-only" style={{ marginBottom: 20, textAlign: 'center' }}>
                <h1 style={{ margin: 0, fontSize: 24 }}>Engineer Payroll Report</h1>
                <p style={{ margin: '8px 0 0', color: '#666' }}>
                  Period: {formatDate(dateRange.period_start)} - {formatDate(dateRange.period_end)}
                </p>
              </div>

              {/* Holidays included in this period */}
              {payrollHolidays.length > 0 && (
                <div style={{ marginBottom: 16, padding: '12px 16px', background: '#eff6ff', borderRadius: 8, border: '1px solid #bfdbfe' }}>
                  <div style={{ fontWeight: 600, marginBottom: 4, color: '#1e40af' }}>Holidays in Period</div>
                  <div style={{ fontSize: 14, color: '#3b82f6' }}>
                    {payrollHolidays.map((h, i) => (
                      <span key={h.id}>
                        {h.name} ({formatDate(h.date)}, {h.hours}hrs){i < payrollHolidays.length - 1 ? ' • ' : ''}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Summary by Engineer (for printing) */}
              <div style={{ marginBottom: 24 }}>
                <h3 style={{ fontSize: 16, marginBottom: 12 }}>Payment Summary by Engineer</h3>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Engineer</th>
                        <th>Engineer ID</th>
                        <th>Work Hours</th>
                        {payrollHolidays.length > 0 && <th>Holiday Hours</th>}
                        <th>Amount to Pay</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payrollSummary.map((row, idx) => (
                        <tr key={idx}>
                          <td><strong>{row.engineer_name}</strong></td>
                          <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 13 }}>{row.engineer_id || '-'}</td>
                          <td style={{ fontFamily: 'DM Mono, monospace' }}>{(row.total_hours || 0).toFixed(2)}</td>
                          {payrollHolidays.length > 0 && (
                            <td style={{ fontFamily: 'DM Mono, monospace', color: row.holiday_hours > 0 ? '#1e40af' : '#94a3b8' }}>
                              {row.holiday_hours > 0 ? `${row.holiday_hours.toFixed(2)}` : '—'}
                            </td>
                          )}
                          <td style={{ fontFamily: 'DM Mono, monospace', fontWeight: 600, color: '#16a34a' }}>{formatCurrency(row.total_pay)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: 'var(--surface2)', fontWeight: 600 }}>
                        <td colSpan={2}>Totals</td>
                        <td style={{ fontFamily: 'DM Mono, monospace' }}>{payrollTotals.hours.toFixed(2)}</td>
                        {payrollHolidays.length > 0 && <td style={{ fontFamily: 'DM Mono, monospace' }}>{payrollTotals.holidayHours.toFixed(2)}</td>}
                        <td style={{ fontFamily: 'DM Mono, monospace', color: '#16a34a' }}>{formatCurrency(payrollTotals.pay)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* Detailed Breakdown */}
              <h3 style={{ fontSize: 16, marginBottom: 12 }}>Detailed Breakdown by Project</h3>
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
                      <th className="no-print">Bill Rate</th>
                      <th className="no-print">Total Billed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payrollData.map((row, idx) => (
                      <tr key={idx} style={row.is_holiday_pay ? { background: '#eff6ff' } : undefined}>
                        <td><strong>{row.engineer_name}</strong></td>
                        <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 13 }}>{row.engineer_id || '-'}</td>
                        <td>
                          {row.is_holiday_pay ? (
                            <span style={{ color: '#1e40af', fontWeight: 500 }}>Holiday Pay</span>
                          ) : (
                            row.project_name
                          )}
                        </td>
                        <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: row.is_holiday_pay ? '#3b82f6' : undefined }}>
                          {row.po_number || '-'}
                        </td>
                        <td style={{ fontFamily: 'DM Mono, monospace' }}>{(row.total_hours || 0).toFixed(2)}</td>
                        <td style={{ fontFamily: 'DM Mono, monospace' }}>{formatCurrency(row.pay_rate)}/hr</td>
                        <td style={{ fontFamily: 'DM Mono, monospace', fontWeight: 600 }}>{formatCurrency(row.total_pay)}</td>
                        <td className="no-print" style={{ fontFamily: 'DM Mono, monospace' }}>{row.is_holiday_pay ? '—' : `${formatCurrency(row.bill_rate)}/hr`}</td>
                        <td className="no-print" style={{ fontFamily: 'DM Mono, monospace' }}>{row.is_holiday_pay ? '—' : formatCurrency(row.total_billed)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: 'var(--surface2)', fontWeight: 600 }}>
                      <td colSpan={4}>Totals</td>
                      <td style={{ fontFamily: 'DM Mono, monospace' }}>{payrollTotals.hours.toFixed(2)}</td>
                      <td></td>
                      <td style={{ fontFamily: 'DM Mono, monospace' }}>{formatCurrency(payrollTotals.pay)}</td>
                      <td className="no-print"></td>
                      <td className="no-print" style={{ fontFamily: 'DM Mono, monospace' }}>{formatCurrency(payrollTotals.billed)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="no-print" style={{ marginTop: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
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

      {activeTab === 'invoiced' && (
        <div className="card">
          <div className="card-title no-print">Invoiced Report</div>

          <form onSubmit={handleRunInvoiced} className="no-print" style={{ marginBottom: 24 }}>
            <div style={{ marginBottom: 12 }}>
              <label className="form-label" style={{ marginBottom: 8, display: 'block' }}>Quick Select:</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                {monthOptions.slice(0, 6).map((opt, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className={`btn btn-sm ${invoicedDateRange.period_start === opt.start && invoicedDateRange.period_end === opt.end ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => selectInvoicedPeriod(opt)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {yearOptions.map((opt, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className={`btn btn-sm ${invoicedDateRange.period_start === opt.start && invoicedDateRange.period_end === opt.end ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => selectInvoicedPeriod(opt)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Period Start</label>
                <input
                  className="form-input"
                  type="date"
                  value={invoicedDateRange.period_start}
                  onChange={(e) => setInvoicedDateRange({ ...invoicedDateRange, period_start: e.target.value })}
                />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Period End</label>
                <input
                  className="form-input"
                  type="date"
                  value={invoicedDateRange.period_end}
                  onChange={(e) => setInvoicedDateRange({ ...invoicedDateRange, period_end: e.target.value })}
                />
              </div>
              <button className="btn btn-primary" type="submit" disabled={loading}>
                {loading ? 'Loading...' : 'Run Report'}
              </button>
              {invoicedData.length > 0 && (
                <button className="btn btn-secondary" type="button" onClick={() => window.print()}>
                  Print Report
                </button>
              )}
            </div>
          </form>

          {invoicedData.length === 0 ? (
            <div className="empty-state no-print">
              <h3>No data</h3>
              <p>Select a date range and run the report to see invoiced data.</p>
            </div>
          ) : (
            <>
              {/* Print Header */}
              <div className="print-only" style={{ marginBottom: 20, textAlign: 'center' }}>
                <h1 style={{ margin: 0, fontSize: 24 }}>Invoiced Report</h1>
                <p style={{ margin: '8px 0 0', color: '#666' }}>
                  Period: {formatDate(invoicedDateRange.period_start)} - {formatDate(invoicedDateRange.period_end)}
                </p>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Invoice #</th>
                      <th>Date</th>
                      <th>Customer</th>
                      <th>Project</th>
                      <th>PO #</th>
                      <th>Hours</th>
                      <th>Amount</th>
                      <th>Paid</th>
                      <th>Outstanding</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoicedData.map((row) => {
                      const outstanding = (row.total_amount || 0) - (row.amount_paid || 0);
                      return (
                        <tr key={row.id}>
                          <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 13 }}>{row.invoice_number}</td>
                          <td style={{ fontSize: 13 }}>{formatDate(row.created_at)}</td>
                          <td><strong>{row.customer_name}</strong></td>
                          <td>{row.project_name}</td>
                          <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 13 }}>{row.po_number || '-'}</td>
                          <td style={{ fontFamily: 'DM Mono, monospace' }}>{(row.total_hours || 0).toFixed(2)}</td>
                          <td style={{ fontFamily: 'DM Mono, monospace' }}>{formatCurrency(row.total_amount)}</td>
                          <td style={{ fontFamily: 'DM Mono, monospace', color: '#16a34a' }}>{formatCurrency(row.amount_paid)}</td>
                          <td style={{ fontFamily: 'DM Mono, monospace', fontWeight: 600, color: outstanding > 0 ? '#dc2626' : '#16a34a' }}>
                            {formatCurrency(outstanding)}
                          </td>
                          <td>
                            <span style={{
                              padding: '2px 8px',
                              borderRadius: 4,
                              fontSize: 11,
                              fontWeight: 600,
                              textTransform: 'uppercase',
                              background: row.status === 'paid' ? '#d1fae5' : row.status === 'voided' ? '#f3f4f6' : '#fef3c7',
                              color: row.status === 'paid' ? '#065f46' : row.status === 'voided' ? '#6b7280' : '#92400e',
                            }}>
                              {row.status || 'unpaid'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: 'var(--surface2)', fontWeight: 600 }}>
                      <td colSpan={6}>Totals ({invoicedTotals.count} invoices)</td>
                      <td style={{ fontFamily: 'DM Mono, monospace' }}>{formatCurrency(invoicedTotals.total)}</td>
                      <td style={{ fontFamily: 'DM Mono, monospace', color: '#16a34a' }}>{formatCurrency(invoicedTotals.paid)}</td>
                      <td style={{ fontFamily: 'DM Mono, monospace', color: invoicedTotals.outstanding > 0 ? '#dc2626' : '#16a34a' }}>
                        {formatCurrency(invoicedTotals.outstanding)}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="no-print" style={{ marginTop: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                <div className="stat-card">
                  <div className="stat-label">Invoices Created</div>
                  <div className="stat-value">{invoicedTotals.count}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Total Invoiced</div>
                  <div className="stat-value" style={{ fontSize: 22 }}>{formatCurrency(invoicedTotals.total)}</div>
                </div>
                <div className="stat-card accent">
                  <div className="stat-label">Total Paid</div>
                  <div className="stat-value" style={{ fontSize: 22, color: 'var(--success)' }}>{formatCurrency(invoicedTotals.paid)}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Outstanding</div>
                  <div className="stat-value" style={{ fontSize: 22, color: invoicedTotals.outstanding > 0 ? 'var(--danger)' : 'var(--success)' }}>
                    {formatCurrency(invoicedTotals.outstanding)}
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
                          <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 13 }}>{row.po_number || '-'}</td>
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

      {activeTab === 'contract-hours' && (
        <div className="card">
          <div className="card-title">Contract Hours Remaining</div>
          <p style={{ color: '#64748b', marginBottom: 16, fontSize: 14 }}>
            Shows remaining budget for active hourly projects. Hours are shown for single-engineer contracts; dollars for multi-engineer contracts.
          </p>

          {loading ? (
            <div style={{ padding: 40, color: '#94a3b8', textAlign: 'center' }}>Loading...</div>
          ) : contractHoursData.length === 0 ? (
            <div className="empty-state">
              <h3>No active hourly projects</h3>
              <p>Create hourly projects with engineers assigned to see remaining hours.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Customer</th>
                    <th>PO #</th>
                    <th>Engineers</th>
                    <th>Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  {contractHoursData.map((row) => {
                    const isOverBudget = row.remaining_dollars < 0;
                    const showHours = row.engineer_count === 1 && row.remaining_hours !== null;
                    return (
                      <tr key={row.id}>
                        <td>
                          <strong>{row.project_name}</strong>
                          {row.single_engineer && (
                            <div style={{ fontSize: 12, color: '#64748b' }}>{row.single_engineer}</div>
                          )}
                        </td>
                        <td>{row.customer_name}</td>
                        <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 13 }}>{row.po_number || '-'}</td>
                        <td style={{ textAlign: 'center' }}>{row.engineer_count}</td>
                        <td style={{ fontFamily: 'DM Mono, monospace', fontWeight: 600, color: isOverBudget ? 'var(--danger)' : 'var(--success)' }}>
                          {showHours ? (
                            <>
                              {row.remaining_hours >= 0 ? row.remaining_hours.toFixed(1) : `(${Math.abs(row.remaining_hours).toFixed(1)})`} hrs
                              <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400 }}>{formatCurrency(row.remaining_dollars)}</div>
                            </>
                          ) : (
                            formatCurrency(row.remaining_dollars)
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {achModal && (
        <Modal
          title="Generate ACH File"
          onClose={() => setAchModal(false)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setAchModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleAchExport}>Download CSV</button>
            </>
          }
        >
          <p style={{ marginBottom: 16 }}>
            Generate a Chase-compatible ACH CSV file for the payroll period <strong>{formatDate(dateRange.period_start)}</strong> to <strong>{formatDate(dateRange.period_end)}</strong>.
          </p>

          <div className="form-group">
            <label className="form-label">Delivery Date</label>
            <input
              className="form-input"
              type="date"
              value={achDeliveryDate}
              onChange={(e) => setAchDeliveryDate(e.target.value)}
              min={new Date().toISOString().split('T')[0]}
            />
            <div className="form-hint">
              The date you want payments to arrive in employee accounts. Must be a future business day.
            </div>
          </div>

          <div className="alert alert-info" style={{ marginTop: 16 }}>
            <strong>Before uploading to Chase:</strong>
            <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
              <li>Ensure all engineers have banking info entered</li>
              <li>Verify the payroll amounts are correct</li>
              <li>Upload via Chase Business Online → Payments → File Upload</li>
            </ul>
          </div>
        </Modal>
      )}
    </div>
  );
}
