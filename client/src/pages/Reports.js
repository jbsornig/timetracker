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
  const normalized = dateStr.includes('T') ? dateStr : dateStr.includes(' ') ? dateStr.replace(' ', 'T') : dateStr + 'T00:00:00';
  return new Date(normalized.split('T')[0] + 'T00:00:00').toLocaleDateString('en-US', {
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
  const [activeTab, setActiveTab] = useState('hours-summary');
  const [hoursSummaryData, setHoursSummaryData] = useState([]);
  const [hoursSummaryRange, setHoursSummaryRange] = useState(getDefaultDates());
  const [hoursEngineerFilter, setHoursEngineerFilter] = useState('');
  const [hoursCustomerFilter, setHoursCustomerFilter] = useState('');
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
  const [achSelections, setAchSelections] = useState({});

  // Engineer payments state
  const [engPayments, setEngPayments] = useState([]);
  const [engPayFilter, setEngPayFilter] = useState({ user_id: '', period_start: '', period_end: '', payment_type: '' });
  const [engPayForm, setEngPayForm] = useState({ user_id: '', amount: '', payment_date: new Date().toISOString().split('T')[0], payment_type: 'advance', period_start: '', period_end: '', reference_number: '', payment_method: '', notes: '' });
  const [engPaySaving, setEngPaySaving] = useState(false);
  const [engineers, setEngineers] = useState([]);
  const [taxYear, setTaxYear] = useState(new Date().getFullYear().toString());
  const [summary1099, setSummary1099] = useState([]);
  const [verificationData, setVerificationData] = useState(null);
  const [verificationEngineer, setVerificationEngineer] = useState('');
  const [verificationRange, setVerificationRange] = useState({ period_start: `${new Date().getFullYear()}-01-01`, period_end: new Date().toISOString().split('T')[0] });
  const [overdueData, setOverdueData] = useState([]);

  const monthOptions = getMonthOptions();
  const yearOptions = getYearOptions();

  useEffect(() => {
    if (activeTab === 'budget') {
      loadBudgetData();
    } else if (activeTab === 'contract-hours') {
      loadContractHoursData();
    } else if (activeTab === 'engineer-payments') {
      loadEngineers();
      loadEngPayments();
    } else if (activeTab === 'overdue') {
      loadOverdueInvoices();
    }
  }, [activeTab]);

  // Auto-load hours summary when tab is active and date range changes
  useEffect(() => {
    if (activeTab === 'hours-summary') {
      loadHoursSummary();
    }
  }, [activeTab, hoursSummaryRange.period_start, hoursSummaryRange.period_end]);

  const loadHoursSummary = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch(
        `/reports/hours-summary?period_start=${hoursSummaryRange.period_start}&period_end=${hoursSummaryRange.period_end}`
      );
      setHoursSummaryData(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

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

  const loadOverdueInvoices = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch('/reports/overdue-invoices');
      setOverdueData(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadEngineers = async () => {
    try {
      const users = await apiFetch('/users');
      setEngineers(users.filter(u => u.role === 'engineer'));
    } catch (e) {}
  };

  const loadEngPayments = async (filters) => {
    const f = filters || engPayFilter;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (f.user_id) params.set('user_id', f.user_id);
      if (f.period_start) params.set('period_start', f.period_start);
      if (f.period_end) params.set('period_end', f.period_end);
      if (f.payment_type) params.set('payment_type', f.payment_type);
      const data = await apiFetch(`/engineer-payments?${params}`);
      setEngPayments(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAddEngPayment = async (e) => {
    e.preventDefault();
    if (!engPayForm.user_id || !engPayForm.amount || !engPayForm.payment_date) {
      setError('Engineer, amount, and date are required');
      return;
    }
    setEngPaySaving(true);
    setError('');
    try {
      await apiFetch('/engineer-payments', { method: 'POST', body: { ...engPayForm, amount: parseFloat(engPayForm.amount) } });
      setEngPayForm({ ...engPayForm, amount: '', reference_number: '', notes: '' });
      loadEngPayments();
    } catch (e) {
      setError(e.message);
    } finally {
      setEngPaySaving(false);
    }
  };

  const handleDeleteEngPayment = async (id) => {
    if (!window.confirm('Delete this payment record?')) return;
    try {
      await apiFetch(`/engineer-payments/${id}`, { method: 'DELETE' });
      loadEngPayments();
    } catch (e) {
      alert('Error: ' + e.message);
    }
  };

  const load1099Summary = async () => {
    setLoading(true);
    try {
      const data = await apiFetch(`/engineer-payments/1099-summary?year=${taxYear}`);
      setSummary1099(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadVerification = async () => {
    if (!verificationEngineer) { setError('Select an engineer'); return; }
    setLoading(true);
    try {
      const data = await apiFetch(`/engineer-payments/verification/${verificationEngineer}?period_start=${verificationRange.period_start}&period_end=${verificationRange.period_end}`);
      setVerificationData(data);
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
    // Initialize selections from payroll summary - all selected with default amounts
    const selections = {};
    payrollSummary.forEach(row => {
      if (row.total_pay > 0) {
        selections[row.engineer_name] = { selected: true, amount: row.total_pay, defaultAmount: row.total_pay };
      }
    });
    setAchSelections(selections);
    setAchModal(true);
  };

  const handleAchExport = async () => {
    const selectedEngineers = Object.entries(achSelections)
      .filter(([, v]) => v.selected && v.amount > 0);
    if (selectedEngineers.length === 0) {
      alert('Please select at least one engineer with a payment amount.');
      return;
    }
    try {
      const API_BASE = process.env.REACT_APP_API_URL || '';
      const token = localStorage.getItem('tt_token');
      // Build overrides: engineer_name -> custom amount
      const overrides = {};
      selectedEngineers.forEach(([name, v]) => {
        overrides[name] = v.amount;
      });
      const url = `${API_BASE}/api/payroll/ach-export`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          period_start: dateRange.period_start,
          period_end: dateRange.period_end,
          delivery_date: achDeliveryDate,
          overrides
        })
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
            className={`btn ${activeTab === 'hours-summary' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('hours-summary')}
          >
            Hours Summary
          </button>
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
          <button
            className={`btn ${activeTab === 'engineer-payments' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('engineer-payments')}
          >
            Engineer Payments
          </button>
          <button
            className={`btn ${activeTab === 'overdue' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('overdue')}
          >
            Overdue Invoices
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error no-print">{error}</div>}

      {activeTab === 'hours-summary' && (() => {
        // Filter data
        const filtered = hoursSummaryData.filter(row =>
          (!hoursEngineerFilter || String(row.user_id) === hoursEngineerFilter) &&
          (!hoursCustomerFilter || String(row.customer_id) === hoursCustomerFilter)
        );

        // Group by engineer
        const byEngineer = {};
        filtered.forEach(row => {
          if (!byEngineer[row.engineer_name]) {
            byEngineer[row.engineer_name] = { rows: [], totalHours: 0 };
          }
          byEngineer[row.engineer_name].rows.push(row);
          byEngineer[row.engineer_name].totalHours += row.total_hours;
        });

        // Unique engineers and customers for filter dropdowns
        const uniqueEngineers = [...new Map(hoursSummaryData.map(r => [r.user_id, { id: r.user_id, name: r.engineer_name }])).values()].sort((a, b) => a.name.localeCompare(b.name));
        const uniqueCustomers = [...new Map(hoursSummaryData.map(r => [r.customer_id, { id: r.customer_id, name: r.customer_name }])).values()].sort((a, b) => a.name.localeCompare(b.name));

        const grandTotal = filtered.reduce((sum, r) => sum + r.total_hours, 0);

        return (
          <div className="card">
            <div className="card-title no-print">Hours Summary by Engineer</div>

            <div className="no-print" style={{ marginBottom: 20 }}>
              <div style={{ marginBottom: 12 }}>
                <label className="form-label" style={{ marginBottom: 8, display: 'block' }}>Quick Select Month:</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {monthOptions.slice(0, 6).map((opt, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className={`btn btn-sm ${hoursSummaryRange.period_start === opt.start && hoursSummaryRange.period_end === opt.end ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => { setHoursSummaryRange({ period_start: opt.start, period_end: opt.end }); }}
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
                    value={hoursSummaryRange.period_start}
                    onChange={(e) => setHoursSummaryRange({ ...hoursSummaryRange, period_start: e.target.value })}
                  />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Period End</label>
                  <input
                    className="form-input"
                    type="date"
                    value={hoursSummaryRange.period_end}
                    onChange={(e) => setHoursSummaryRange({ ...hoursSummaryRange, period_end: e.target.value })}
                  />
                </div>
                <button className="btn btn-primary" onClick={loadHoursSummary} disabled={loading}>
                  {loading ? 'Loading...' : 'Run Report'}
                </button>
              </div>
            </div>

            {hoursSummaryData.length > 0 && (
              <div className="no-print" style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, color: '#64748b' }}>Engineer:</span>
                  <select
                    className="form-select"
                    value={hoursEngineerFilter}
                    onChange={(e) => setHoursEngineerFilter(e.target.value)}
                    style={{ width: 'auto', minWidth: 180 }}
                  >
                    <option value="">All Engineers</option>
                    {uniqueEngineers.map(e => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, color: '#64748b' }}>Customer:</span>
                  <select
                    className="form-select"
                    value={hoursCustomerFilter}
                    onChange={(e) => setHoursCustomerFilter(e.target.value)}
                    style={{ width: 'auto', minWidth: 180 }}
                  >
                    <option value="">All Customers</option>
                    {uniqueCustomers.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {filtered.length === 0 ? (
              <div className="empty-state no-print">
                <h3>No data</h3>
                <p>{hoursSummaryData.length > 0 ? 'Try adjusting your filters.' : 'Select a month and run the report.'}</p>
              </div>
            ) : (
              <>
                <div className="print-only" style={{ marginBottom: 20, textAlign: 'center' }}>
                  <h1 style={{ margin: 0, fontSize: 24 }}>Hours Summary by Engineer</h1>
                  <p style={{ margin: '8px 0 0', color: '#666' }}>
                    Period: {formatDate(hoursSummaryRange.period_start)} - {formatDate(hoursSummaryRange.period_end)}
                  </p>
                </div>

                {Object.entries(byEngineer).map(([engineerName, group]) => (
                  <div key={engineerName} style={{ marginBottom: 24 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                      <h3 style={{ fontSize: 16, margin: 0 }}>{engineerName}</h3>
                      <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 600, fontSize: 15 }}>
                        {group.totalHours.toFixed(2)} hrs total
                      </span>
                    </div>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Project</th>
                            <th>Customer</th>
                            <th>Type</th>
                            <th>Timesheets</th>
                            <th>Hours</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.rows.map(row => (
                            <tr key={row.project_id}>
                              <td><strong>{row.project_name}</strong></td>
                              <td>{row.customer_name}</td>
                              <td>
                                <span className={`badge ${row.project_type === 'fixed_price' ? 'badge-fixed' : 'badge-hourly'}`} style={{ fontSize: 11 }}>
                                  {row.project_type === 'fixed_price' ? 'Fixed' : 'Hourly'}
                                </span>
                              </td>
                              <td style={{ textAlign: 'center' }}>{row.timesheet_count}</td>
                              <td style={{ fontFamily: 'DM Mono, monospace', fontWeight: 600 }}>{row.total_hours.toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}

                <div style={{ borderTop: '2px solid var(--border)', paddingTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 600, fontSize: 15 }}>
                    Grand Total ({Object.keys(byEngineer).length} engineer{Object.keys(byEngineer).length !== 1 ? 's' : ''})
                  </span>
                  <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 700, fontSize: 18 }}>
                    {grandTotal.toFixed(2)} hrs
                  </span>
                </div>

                <div className="no-print" style={{ marginTop: 16 }}>
                  <button className="btn btn-secondary" onClick={() => window.print()}>Print Report</button>
                </div>
              </>
            )}
          </div>
        );
      })()}

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
                    {payrollData.map((row, idx) => {
                      const isFixed = row.pay_type === 'fixed_price';
                      const isFixedMonthly = row.pay_type === 'fixed_monthly';
                      const isHoliday = row.is_holiday_pay;
                      const rowBg = isHoliday ? { background: '#eff6ff' } : (isFixed || isFixedMonthly) ? { background: '#fefce8' } : undefined;
                      return (
                        <tr key={idx} style={rowBg}>
                          <td><strong>{row.engineer_name}</strong></td>
                          <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 13 }}>{row.engineer_id || '-'}</td>
                          <td>
                            {isHoliday ? (
                              <span style={{ color: '#1e40af', fontWeight: 500 }}>Holiday Pay</span>
                            ) : (
                              <>
                                {row.project_name}
                                {isFixed && <span style={{ marginLeft: 6, fontSize: 11, color: '#92400e', fontWeight: 500 }}>(Fixed Price)</span>}
                                {isFixedMonthly && <span style={{ marginLeft: 6, fontSize: 11, color: '#92400e', fontWeight: 500 }}>(Monthly)</span>}
                              </>
                            )}
                          </td>
                          <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: isHoliday ? '#3b82f6' : undefined }}>
                            {row.po_number || '-'}
                          </td>
                          <td style={{ fontFamily: 'DM Mono, monospace' }}>
                            {isFixed ? `${row.percentage || 0}%` : (row.total_hours || 0).toFixed(2)}
                          </td>
                          <td style={{ fontFamily: 'DM Mono, monospace' }}>
                            {isFixed ? 'Fixed' : isFixedMonthly ? 'Monthly' : `${formatCurrency(row.pay_rate)}/hr`}
                          </td>
                          <td style={{ fontFamily: 'DM Mono, monospace', fontWeight: 600 }}>{formatCurrency(row.total_pay)}</td>
                          <td className="no-print" style={{ fontFamily: 'DM Mono, monospace' }}>{(isHoliday || isFixed || isFixedMonthly) ? '—' : `${formatCurrency(row.bill_rate)}/hr`}</td>
                          <td className="no-print" style={{ fontFamily: 'DM Mono, monospace' }}>{(isHoliday || isFixed || isFixedMonthly) ? '—' : formatCurrency(row.total_billed)}</td>
                        </tr>
                      );
                    })}
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

      {achModal && (() => {
        const selectedCount = Object.values(achSelections).filter(v => v.selected).length;
        const selectedTotal = Object.values(achSelections)
          .filter(v => v.selected)
          .reduce((sum, v) => sum + (parseFloat(v.amount) || 0), 0);
        return (
        <Modal
          title="Generate ACH File"
          onClose={() => setAchModal(false)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setAchModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleAchExport} disabled={selectedCount === 0}>
                Download CSV ({selectedCount} engineer{selectedCount !== 1 ? 's' : ''} — {formatCurrency(selectedTotal)})
              </button>
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
          </div>

          {/* Engineer Selection Table */}
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label className="form-label" style={{ margin: 0 }}>Select Engineers & Amounts</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    const updated = { ...achSelections };
                    Object.keys(updated).forEach(k => { updated[k] = { ...updated[k], selected: true }; });
                    setAchSelections(updated);
                  }}
                >Select All</button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    const updated = { ...achSelections };
                    Object.keys(updated).forEach(k => { updated[k] = { ...updated[k], selected: false }; });
                    setAchSelections(updated);
                  }}
                >Select None</button>
              </div>
            </div>
            <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
              <table style={{ fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ width: 30 }}></th>
                    <th>Engineer</th>
                    <th style={{ width: 120 }}>Default</th>
                    <th style={{ width: 130 }}>Amount to Pay</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(achSelections).map(([name, val]) => (
                    <tr key={name} style={{ opacity: val.selected ? 1 : 0.5 }}>
                      <td>
                        <input
                          type="checkbox"
                          checked={val.selected}
                          onChange={(e) => setAchSelections({
                            ...achSelections,
                            [name]: { ...val, selected: e.target.checked }
                          })}
                        />
                      </td>
                      <td><strong>{name}</strong></td>
                      <td style={{ fontFamily: 'DM Mono, monospace', color: '#64748b', fontSize: 12 }}>
                        {formatCurrency(val.defaultAmount)}
                      </td>
                      <td>
                        <input
                          className="form-input"
                          type="number"
                          step="0.01"
                          min="0"
                          value={val.amount}
                          onChange={(e) => setAchSelections({
                            ...achSelections,
                            [name]: { ...val, amount: parseFloat(e.target.value) || 0 }
                          })}
                          disabled={!val.selected}
                          style={{ width: '100%', padding: '4px 8px', fontSize: 13, fontFamily: 'DM Mono, monospace' }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: 'var(--surface2)', fontWeight: 600 }}>
                    <td></td>
                    <td>Total</td>
                    <td></td>
                    <td style={{ fontFamily: 'DM Mono, monospace', color: '#16a34a' }}>{formatCurrency(selectedTotal)}</td>
                  </tr>
                </tfoot>
              </table>
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
        );
      })()}

      {activeTab === 'engineer-payments' && (
        <div>
          {/* Sub-tabs for Engineer Payments */}
          <div className="card no-print" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => { setVerificationData(null); setSummary1099([]); }}>Payment History</button>
              <button className="btn btn-secondary btn-sm" onClick={() => { load1099Summary(); setVerificationData(null); }}>1099 Summary</button>
              <button className="btn btn-secondary btn-sm" onClick={() => { setSummary1099([]); }}>Verification Letter</button>
            </div>
          </div>

          {/* Record Payment Form */}
          {summary1099.length === 0 && !verificationData && (
            <div className="card no-print" style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 12 }}>Record Payment</div>
              <form onSubmit={handleAddEngPayment}>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div>
                    <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>Engineer *</label>
                    <select className="form-select" value={engPayForm.user_id} onChange={(e) => setEngPayForm({ ...engPayForm, user_id: e.target.value })} style={{ width: 200 }}>
                      <option value="">Select...</option>
                      {engineers.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>Amount *</label>
                    <input className="form-input" type="number" step="0.01" value={engPayForm.amount} onChange={(e) => setEngPayForm({ ...engPayForm, amount: e.target.value })} placeholder="0.00" style={{ width: 120 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>Date *</label>
                    <input className="form-input" type="date" value={engPayForm.payment_date} onChange={(e) => setEngPayForm({ ...engPayForm, payment_date: e.target.value })} style={{ width: 150 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>Type</label>
                    <select className="form-select" value={engPayForm.payment_type} onChange={(e) => setEngPayForm({ ...engPayForm, payment_type: e.target.value })} style={{ width: 140 }}>
                      <option value="advance">Advance</option>
                      <option value="bonus">Bonus</option>
                      <option value="reimbursement">Reimbursement</option>
                      <option value="payroll">Payroll</option>
                      <option value="adjustment">Adjustment</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>Method</label>
                    <select className="form-select" value={engPayForm.payment_method} onChange={(e) => setEngPayForm({ ...engPayForm, payment_method: e.target.value })} style={{ width: 130 }}>
                      <option value="">Select...</option>
                      <option value="ACH">ACH</option>
                      <option value="Check">Check</option>
                      <option value="Cash">Cash</option>
                      <option value="Zelle">Zelle</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>Reference #</label>
                    <input className="form-input" value={engPayForm.reference_number} onChange={(e) => setEngPayForm({ ...engPayForm, reference_number: e.target.value })} placeholder="Check #, etc." style={{ width: 140 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>Notes</label>
                    <input className="form-input" value={engPayForm.notes} onChange={(e) => setEngPayForm({ ...engPayForm, notes: e.target.value })} placeholder="Optional" style={{ width: 180 }} />
                  </div>
                  <button className="btn btn-primary" type="submit" disabled={engPaySaving}>
                    {engPaySaving ? 'Saving...' : 'Record Payment'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Payment History Filter & Table */}
          {summary1099.length === 0 && !verificationData && (
            <div className="card">
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 12 }}>Payment History</div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
                <div>
                  <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>Engineer</label>
                  <select className="form-select" value={engPayFilter.user_id} onChange={(e) => { const f = { ...engPayFilter, user_id: e.target.value }; setEngPayFilter(f); loadEngPayments(f); }} style={{ width: 200 }}>
                    <option value="">All Engineers</option>
                    {engineers.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>From</label>
                  <input className="form-input" type="date" value={engPayFilter.period_start} onChange={(e) => { const f = { ...engPayFilter, period_start: e.target.value }; setEngPayFilter(f); loadEngPayments(f); }} style={{ width: 150 }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>To</label>
                  <input className="form-input" type="date" value={engPayFilter.period_end} onChange={(e) => { const f = { ...engPayFilter, period_end: e.target.value }; setEngPayFilter(f); loadEngPayments(f); }} style={{ width: 150 }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>Type</label>
                  <select className="form-select" value={engPayFilter.payment_type} onChange={(e) => { const f = { ...engPayFilter, payment_type: e.target.value }; setEngPayFilter(f); loadEngPayments(f); }} style={{ width: 140 }}>
                    <option value="">All Types</option>
                    <option value="payroll">Payroll</option>
                    <option value="advance">Advance</option>
                    <option value="bonus">Bonus</option>
                    <option value="reimbursement">Reimbursement</option>
                    <option value="adjustment">Adjustment</option>
                  </select>
                </div>
              </div>

              {engPayments.length === 0 && !loading && (
                <div style={{ color: '#94a3b8', fontStyle: 'italic' }}>No payments found.</div>
              )}

              {engPayments.length > 0 && (
                <div className="table-wrap">
                  <table style={{ fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Engineer</th>
                        <th>Type</th>
                        <th>Amount</th>
                        <th>Method</th>
                        <th>Reference</th>
                        <th>Period</th>
                        <th>Notes</th>
                        <th style={{ width: 50 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {engPayments.map(p => (
                        <tr key={p.id}>
                          <td>{formatDate(p.payment_date)}</td>
                          <td>{p.engineer_name}</td>
                          <td><span style={{ padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', background: p.payment_type === 'payroll' ? '#dbeafe' : p.payment_type === 'advance' ? '#fef3c7' : '#f3e8ff', color: p.payment_type === 'payroll' ? '#1e40af' : p.payment_type === 'advance' ? '#92400e' : '#6b21a8' }}>{p.payment_type}</span></td>
                          <td style={{ fontFamily: 'DM Mono, monospace', fontWeight: 600 }}>{formatCurrency(p.amount)}</td>
                          <td>{p.payment_method || '—'}</td>
                          <td style={{ fontSize: 11 }}>{p.reference_number || '—'}</td>
                          <td style={{ fontSize: 11 }}>{p.period_start && p.period_end ? `${formatDate(p.period_start)} - ${formatDate(p.period_end)}` : '—'}</td>
                          <td style={{ fontSize: 11, color: '#64748b' }}>{p.notes || ''}</td>
                          <td><button className="btn btn-danger btn-sm" onClick={() => handleDeleteEngPayment(p.id)}>Del</button></td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: '#f8fafc', fontWeight: 600 }}>
                        <td colSpan="3" style={{ textAlign: 'right' }}>Total:</td>
                        <td style={{ fontFamily: 'DM Mono, monospace' }}>{formatCurrency(engPayments.reduce((s, p) => s + p.amount, 0))}</td>
                        <td colSpan="5"></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* 1099 Summary */}
          {summary1099.length > 0 && !verificationData && (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>1099-NEC Summary — Tax Year {taxYear}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select className="form-select no-print" value={taxYear} onChange={(e) => setTaxYear(e.target.value)} style={{ width: 100 }}>
                    {yearOptions.map(y => <option key={y.label} value={y.label}>{y.label}</option>)}
                  </select>
                  <button className="btn btn-secondary btn-sm no-print" onClick={load1099Summary}>Refresh</button>
                  <button className="btn btn-secondary btn-sm no-print" onClick={() => window.print()}>Print</button>
                </div>
              </div>
              <div className="table-wrap">
                <table style={{ fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th>Engineer</th>
                      <th>Engineer ID</th>
                      <th>Total Paid</th>
                      <th>Payment Count</th>
                      <th>First Payment</th>
                      <th>Last Payment</th>
                      <th>1099 Required</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary1099.map(row => (
                      <tr key={row.user_id}>
                        <td style={{ fontWeight: 600 }}>{row.engineer_name}</td>
                        <td style={{ fontFamily: 'DM Mono, monospace' }}>{row.engineer_id || '—'}</td>
                        <td style={{ fontFamily: 'DM Mono, monospace', fontWeight: 600 }}>{formatCurrency(row.total_paid)}</td>
                        <td>{row.payment_count}</td>
                        <td>{formatDate(row.first_payment)}</td>
                        <td>{formatDate(row.last_payment)}</td>
                        <td>{row.total_paid >= 600 ? <span style={{ color: '#dc2626', fontWeight: 600 }}>YES</span> : <span style={{ color: '#64748b' }}>No</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: '#f8fafc', fontWeight: 600 }}>
                      <td>Total</td>
                      <td></td>
                      <td style={{ fontFamily: 'DM Mono, monospace' }}>{formatCurrency(summary1099.reduce((s, r) => s + r.total_paid, 0))}</td>
                      <td>{summary1099.reduce((s, r) => s + r.payment_count, 0)}</td>
                      <td colSpan="3"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div style={{ marginTop: 12, fontSize: 12, color: '#64748b' }}>
                A 1099-NEC is required for contractors paid $600 or more during the tax year.
              </div>
            </div>
          )}

          {/* Verification Letter */}
          {!summary1099.length && (
            <div>
              {!verificationData && (
                <div className="card no-print" style={{ marginTop: 16 }}>
                  <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 12 }}>Employment / Payment Verification Letter</div>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div>
                      <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>Engineer</label>
                      <select className="form-select" value={verificationEngineer} onChange={(e) => setVerificationEngineer(e.target.value)} style={{ width: 200 }}>
                        <option value="">Select...</option>
                        {engineers.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>From</label>
                      <input className="form-input" type="date" value={verificationRange.period_start} onChange={(e) => setVerificationRange({ ...verificationRange, period_start: e.target.value })} style={{ width: 150 }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>To</label>
                      <input className="form-input" type="date" value={verificationRange.period_end} onChange={(e) => setVerificationRange({ ...verificationRange, period_end: e.target.value })} style={{ width: 150 }} />
                    </div>
                    <button className="btn btn-primary" onClick={loadVerification}>Generate Letter</button>
                  </div>
                </div>
              )}

              {verificationData && (
                <div>
                  <div className="no-print" style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
                    <button className="btn btn-secondary" onClick={() => setVerificationData(null)}>Back</button>
                    <button className="btn btn-primary" onClick={() => window.print()}>Print Letter</button>
                  </div>
                  <div className="card" style={{ maxWidth: 800, margin: '0 auto', padding: 40, fontFamily: 'Georgia, serif', fontSize: 14, lineHeight: 1.8 }}>
                    {/* Company Header */}
                    <div style={{ textAlign: 'center', marginBottom: 30 }}>
                      <div style={{ fontSize: 20, fontWeight: 'bold' }}>{verificationData.company.name}</div>
                      {verificationData.company.address && <div>{verificationData.company.address}</div>}
                      <div>
                        {verificationData.company.phone && <span>{verificationData.company.phone}</span>}
                        {verificationData.company.phone && verificationData.company.email && <span> | </span>}
                        {verificationData.company.email && <span>{verificationData.company.email}</span>}
                      </div>
                    </div>

                    <div style={{ marginBottom: 20 }}>
                      {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                    </div>

                    <div style={{ marginBottom: 20, fontWeight: 'bold' }}>
                      RE: Employment and Payment Verification
                    </div>

                    <div style={{ marginBottom: 16 }}>To Whom It May Concern,</div>

                    <div style={{ marginBottom: 16 }}>
                      This letter is to confirm that <strong>{verificationData.engineer.name}</strong>
                      {verificationData.engineer.engineer_id && <span> (ID: {verificationData.engineer.engineer_id})</span>}
                      {' '}has been engaged as an independent contractor with {verificationData.company.name || 'our company'} since{' '}
                      {new Date(verificationData.engineer.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}.
                    </div>

                    <div style={{ marginBottom: 16 }}>
                      For the period of{' '}
                      <strong>{new Date(verificationData.period.start + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</strong>
                      {' '}through{' '}
                      <strong>{new Date(verificationData.period.end + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</strong>,
                      the following compensation was provided:
                    </div>

                    <div style={{ margin: '20px 40px', padding: 16, border: '1px solid #ccc', background: '#fafafa' }}>
                      <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
                        <tbody>
                          <tr><td style={{ padding: '4px 0' }}>Total Compensation:</td><td style={{ textAlign: 'right', fontWeight: 'bold' }}>{formatCurrency(verificationData.total_paid)}</td></tr>
                          <tr><td style={{ padding: '4px 0' }}>Number of Payments:</td><td style={{ textAlign: 'right' }}>{verificationData.payment_count}</td></tr>
                          <tr><td style={{ padding: '4px 0' }}>Average Monthly Income:</td><td style={{ textAlign: 'right', fontWeight: 'bold' }}>{formatCurrency(verificationData.avg_monthly)}</td></tr>
                          <tr><td style={{ padding: '4px 0' }}>Months Active:</td><td style={{ textAlign: 'right' }}>{verificationData.months_active}</td></tr>
                        </tbody>
                      </table>
                    </div>

                    <div style={{ marginBottom: 16 }}>
                      This information is provided for verification purposes only. If you have any questions or require additional information, please do not hesitate to contact us.
                    </div>

                    <div style={{ marginTop: 40 }}>
                      <div>Sincerely,</div>
                      <div style={{ marginTop: 40, borderTop: '1px solid #000', width: 250, paddingTop: 4 }}>
                        Authorized Representative
                      </div>
                      <div>{verificationData.company.name}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'overdue' && (
        <div>
          {loading ? <div style={{ padding: 20, color: '#94a3b8' }}>Loading...</div> : (() => {
            const overdue = overdueData.filter(inv => inv.days_overdue > 0);
            const current = overdueData.filter(inv => inv.days_overdue <= 0);
            const agingBuckets = {
              '1-30': overdue.filter(inv => inv.aging === '1-30'),
              '31-60': overdue.filter(inv => inv.aging === '31-60'),
              '61-90': overdue.filter(inv => inv.aging === '61-90'),
              '90+': overdue.filter(inv => inv.aging === '90+'),
            };
            const totalOverdue = overdue.reduce((s, inv) => s + inv.balance, 0);
            const totalCurrent = current.reduce((s, inv) => s + inv.balance, 0);

            return (
              <>
                {/* Aging Summary Cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 24 }}>
                  <div className="card" style={{ padding: 16, textAlign: 'center' }}>
                    <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Current</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#10b981' }}>{formatCurrency(totalCurrent)}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>{current.length} invoice{current.length !== 1 ? 's' : ''}</div>
                  </div>
                  <div className="card" style={{ padding: 16, textAlign: 'center' }}>
                    <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>1-30 Days</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#f59e0b' }}>{formatCurrency(agingBuckets['1-30'].reduce((s, i) => s + i.balance, 0))}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>{agingBuckets['1-30'].length} invoice{agingBuckets['1-30'].length !== 1 ? 's' : ''}</div>
                  </div>
                  <div className="card" style={{ padding: 16, textAlign: 'center' }}>
                    <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>31-60 Days</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#f97316' }}>{formatCurrency(agingBuckets['31-60'].reduce((s, i) => s + i.balance, 0))}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>{agingBuckets['31-60'].length} invoice{agingBuckets['31-60'].length !== 1 ? 's' : ''}</div>
                  </div>
                  <div className="card" style={{ padding: 16, textAlign: 'center' }}>
                    <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>61-90 Days</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#ef4444' }}>{formatCurrency(agingBuckets['61-90'].reduce((s, i) => s + i.balance, 0))}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>{agingBuckets['61-90'].length} invoice{agingBuckets['61-90'].length !== 1 ? 's' : ''}</div>
                  </div>
                  <div className="card" style={{ padding: 16, textAlign: 'center' }}>
                    <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>90+ Days</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#dc2626' }}>{formatCurrency(agingBuckets['90+'].reduce((s, i) => s + i.balance, 0))}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>{agingBuckets['90+'].length} invoice{agingBuckets['90+'].length !== 1 ? 's' : ''}</div>
                  </div>
                  <div className="card" style={{ padding: 16, textAlign: 'center', background: totalOverdue > 0 ? '#fef2f2' : undefined }}>
                    <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Total Overdue</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: totalOverdue > 0 ? '#dc2626' : '#10b981' }}>{formatCurrency(totalOverdue)}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>{overdue.length} invoice{overdue.length !== 1 ? 's' : ''}</div>
                  </div>
                </div>

                {/* Overdue Invoice Table */}
                {overdue.length === 0 ? (
                  <div className="card" style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>
                    No overdue invoices. All invoices are current.
                  </div>
                ) : (
                  <div className="card" style={{ padding: 0 }}>
                    <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>
                      Overdue Invoices ({overdue.length})
                    </div>
                    <div className="table-wrap">
                      <table style={{ fontSize: 13 }}>
                        <thead>
                          <tr>
                            <th>Invoice #</th>
                            <th>Customer</th>
                            <th>Project</th>
                            <th>Invoice Date</th>
                            <th>Due Date</th>
                            <th style={{ textAlign: 'center' }}>Days Overdue</th>
                            <th style={{ textAlign: 'right' }}>Total</th>
                            <th style={{ textAlign: 'right' }}>Paid</th>
                            <th style={{ textAlign: 'right' }}>Balance Due</th>
                            <th>Aging</th>
                          </tr>
                        </thead>
                        <tbody>
                          {overdue.sort((a, b) => b.days_overdue - a.days_overdue).map(inv => (
                            <tr key={inv.id}>
                              <td style={{ fontFamily: 'DM Mono, monospace' }}>{inv.invoice_number}</td>
                              <td>{inv.customer_name}</td>
                              <td style={{ fontSize: 12 }}>{inv.project_name}</td>
                              <td>{formatDate(inv.created_at)}</td>
                              <td>{formatDate(inv.due_date)}</td>
                              <td style={{ textAlign: 'center', fontWeight: 600, color: inv.days_overdue > 90 ? '#dc2626' : inv.days_overdue > 60 ? '#ef4444' : inv.days_overdue > 30 ? '#f97316' : '#f59e0b' }}>
                                {inv.days_overdue}
                              </td>
                              <td style={{ textAlign: 'right', fontFamily: 'DM Mono, monospace' }}>{formatCurrency(inv.total_amount)}</td>
                              <td style={{ textAlign: 'right', fontFamily: 'DM Mono, monospace' }}>{formatCurrency(inv.amount_paid)}</td>
                              <td style={{ textAlign: 'right', fontWeight: 600, fontFamily: 'DM Mono, monospace' }}>{formatCurrency(inv.balance)}</td>
                              <td>
                                <span style={{
                                  padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                                  background: inv.aging === '90+' ? '#fecaca' : inv.aging === '61-90' ? '#fed7aa' : inv.aging === '31-60' ? '#fef08a' : '#fef9c3',
                                  color: inv.aging === '90+' ? '#991b1b' : inv.aging === '61-90' ? '#9a3412' : inv.aging === '31-60' ? '#854d0e' : '#a16207',
                                }}>
                                  {inv.aging} days
                                </span>
                              </td>
                            </tr>
                          ))}
                          <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                            <td colSpan={6}>Totals</td>
                            <td style={{ textAlign: 'right', fontFamily: 'DM Mono, monospace' }}>{formatCurrency(overdue.reduce((s, i) => s + (i.total_amount || 0), 0))}</td>
                            <td style={{ textAlign: 'right', fontFamily: 'DM Mono, monospace' }}>{formatCurrency(overdue.reduce((s, i) => s + (i.amount_paid || 0), 0))}</td>
                            <td style={{ textAlign: 'right', fontFamily: 'DM Mono, monospace' }}>{formatCurrency(totalOverdue)}</td>
                            <td></td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Current (Not Yet Due) */}
                {current.length > 0 && (
                  <div className="card" style={{ padding: 0, marginTop: 20 }}>
                    <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>
                      Current - Not Yet Due ({current.length})
                    </div>
                    <div className="table-wrap">
                      <table style={{ fontSize: 13 }}>
                        <thead>
                          <tr>
                            <th>Invoice #</th>
                            <th>Customer</th>
                            <th>Project</th>
                            <th>Invoice Date</th>
                            <th>Due Date</th>
                            <th style={{ textAlign: 'center' }}>Days Until Due</th>
                            <th style={{ textAlign: 'right' }}>Balance Due</th>
                          </tr>
                        </thead>
                        <tbody>
                          {current.sort((a, b) => a.days_overdue - b.days_overdue).map(inv => (
                            <tr key={inv.id}>
                              <td style={{ fontFamily: 'DM Mono, monospace' }}>{inv.invoice_number}</td>
                              <td>{inv.customer_name}</td>
                              <td style={{ fontSize: 12 }}>{inv.project_name}</td>
                              <td>{formatDate(inv.created_at)}</td>
                              <td>{formatDate(inv.due_date)}</td>
                              <td style={{ textAlign: 'center', color: '#10b981' }}>{Math.abs(inv.days_overdue)}</td>
                              <td style={{ textAlign: 'right', fontFamily: 'DM Mono, monospace' }}>{formatCurrency(inv.balance)}</td>
                            </tr>
                          ))}
                          <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                            <td colSpan={6}>Total</td>
                            <td style={{ textAlign: 'right', fontFamily: 'DM Mono, monospace' }}>{formatCurrency(totalCurrent)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
