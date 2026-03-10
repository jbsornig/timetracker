import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../api';

export default function Earnings() {
  const { user } = useAuth();
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reportMode, setReportMode] = useState(false);
  const [dateRange, setDateRange] = useState({
    start_date: new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0],
    end_date: new Date().toISOString().split('T')[0]
  });
  const [reportData, setReportData] = useState(null);

  useEffect(() => {
    setLoading(true);
    apiFetch(`/reports/my-earnings?year=${year}`)
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [year]);

  const years = [];
  const currentYear = new Date().getFullYear();
  for (let y = currentYear; y >= currentYear - 5; y--) years.push(y);

  const generateReport = async () => {
    try {
      const d = await apiFetch(`/reports/my-earnings?start_date=${dateRange.start_date}&end_date=${dateRange.end_date}`);
      setReportData(d);
      setReportMode(true);
    } catch (e) {
      alert('Error generating report: ' + e.message);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  if (loading) return <div style={{ padding: 40, color: '#94a3b8' }}>Loading...</div>;

  if (reportMode && reportData) {
    return (
      <div>
        <style>{`
          @media print {
            .no-print { display: none !important; }
            .print-report { padding: 0 !important; }
            body { background: white !important; }
          }
        `}</style>
        <div className="page-header no-print">
          <div>
            <div className="page-title">Earnings Report</div>
            <div className="page-subtitle">
              {new Date(dateRange.start_date + 'T00:00:00').toLocaleDateString()} - {new Date(dateRange.end_date + 'T00:00:00').toLocaleDateString()}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => setReportMode(false)}>Back</button>
            <button className="btn btn-primary" onClick={handlePrint}>Print Report</button>
          </div>
        </div>

        <div className="print-report">
          <div style={{ textAlign: 'center', marginBottom: 24 }} className="print-only">
            <h2 style={{ margin: 0 }}>Earnings Report</h2>
            <p style={{ margin: '8px 0', color: '#64748b' }}>{user?.name}</p>
            <p style={{ margin: 0, fontSize: 14, color: '#64748b' }}>
              {new Date(dateRange.start_date + 'T00:00:00').toLocaleDateString()} - {new Date(dateRange.end_date + 'T00:00:00').toLocaleDateString()}
            </p>
          </div>

          {reportData.byProject?.length === 0 ? (
            <div className="card">
              <div className="empty-state">No approved timesheets found for this date range.</div>
            </div>
          ) : (
            reportData.byProject?.map((proj, idx) => (
              <div key={idx} className="card" style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 16 }}>{proj.project_name}</div>
                    <div style={{ fontSize: 13, color: '#64748b' }}>{proj.customer_name}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 600, color: '#10b981' }}>
                      ${proj.total_amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    {proj.project_type !== 'fixed_price' && (
                      <div style={{ fontSize: 12, color: '#64748b' }}>{proj.total_hours.toFixed(2)} hours</div>
                    )}
                  </div>
                </div>
                <div className="table-wrap">
                  <table style={{ fontSize: 13 }}>
                    <thead>
                      <tr>
                        <th>Date</th>
                        {proj.project_type === 'fixed_price' ? (
                          <th>Percentage</th>
                        ) : (
                          <>
                            <th>Hours</th>
                            <th>Rate</th>
                          </>
                        )}
                        <th>Amount</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {proj.timesheets.map(ts => (
                        <tr key={ts.id}>
                          <td>
                            {proj.project_type === 'fixed_price'
                              ? `${new Date(ts.period_start + 'T00:00:00').toLocaleDateString()} - ${new Date(ts.period_end + 'T00:00:00').toLocaleDateString()}`
                              : new Date(ts.week_ending + 'T00:00:00').toLocaleDateString()
                            }
                          </td>
                          {proj.project_type === 'fixed_price' ? (
                            <td>{ts.percentage}%</td>
                          ) : (
                            <>
                              <td style={{ fontFamily: 'DM Mono, monospace' }}>{(ts.total_hours || 0).toFixed(2)}</td>
                              <td style={{ fontFamily: 'DM Mono, monospace' }}>${(ts.pay_rate || 0).toFixed(2)}</td>
                            </>
                          )}
                          <td style={{ fontFamily: 'DM Mono, monospace', fontWeight: 500 }}>
                            ${(ts.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td><span className={`badge badge-${ts.status}`}>{ts.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}

          <div className="card" style={{ background: '#f0fdf4', borderColor: '#10b981' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 600, fontSize: 18 }}>Total Earnings</div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 700, fontSize: 24, color: '#10b981' }}>
                  ${(reportData.summary?.total_earnings || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div style={{ fontSize: 13, color: '#64748b' }}>
                  {(reportData.summary?.total_hours || 0).toFixed(2)} total hours
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">My Earnings</div>
          <div className="page-subtitle">View your earnings by year</div>
        </div>
        <select className="form-select" style={{ width: 120 }} value={year} onChange={e => setYear(Number(e.target.value))}>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      <div className="stat-grid">
        <div className="stat-card accent">
          <div className="stat-label">{year} Total Earnings</div>
          <div className="stat-value">${(data?.summary?.total_earnings || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div className="stat-sub">{(data?.summary?.total_hours || 0).toFixed(1)} hours approved</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Pending Approval</div>
          <div className="stat-value" style={{ color: '#f59e0b' }}>${(data?.summary?.pending_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div className="stat-sub">{(data?.summary?.pending_hours || 0).toFixed(1)} hours pending</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Avg Rate</div>
          <div className="stat-value">
            ${data?.summary?.total_hours > 0
              ? (data.summary.total_earnings / data.summary.total_hours).toFixed(2)
              : '0.00'}/hr
          </div>
          <div className="stat-sub">based on approved sheets</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">Generate Printable Report</div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>Start Date</label>
            <input
              className="form-input"
              type="date"
              value={dateRange.start_date}
              onChange={e => setDateRange({ ...dateRange, start_date: e.target.value })}
              style={{ width: 150 }}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>End Date</label>
            <input
              className="form-input"
              type="date"
              value={dateRange.end_date}
              onChange={e => setDateRange({ ...dateRange, end_date: e.target.value })}
              style={{ width: 150 }}
            />
          </div>
          <button className="btn btn-primary" onClick={generateReport}>
            Generate Report
          </button>
        </div>
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>
          Generate a printable report of your earnings sorted by project for any date range.
        </div>
      </div>

      <div className="card">
        <div className="card-title">{year} Timesheet Details</div>
        {!data?.timesheets?.length ? (
          <div className="empty-state">
            <div>No timesheets found for {year}.</div>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Week Ending</th>
                  <th>Project</th>
                  <th>Hours</th>
                  <th>Rate</th>
                  <th>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.timesheets.map(t => (
                  <tr key={t.id}>
                    <td>{new Date(t.week_ending + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
                    <td>
                      {t.project_name}
                      <br />
                      <span style={{ fontSize: 12, color: '#94a3b8' }}>{t.customer_name}</span>
                    </td>
                    <td style={{ fontFamily: 'DM Mono, monospace' }}>{(t.total_hours || 0).toFixed(2)}</td>
                    <td style={{ fontFamily: 'DM Mono, monospace' }}>${(t.pay_rate || 0).toFixed(2)}</td>
                    <td style={{ fontFamily: 'DM Mono, monospace', fontWeight: 600, color: t.status === 'approved' ? '#10b981' : '#64748b' }}>
                      ${(t.amount || 0).toFixed(2)}
                    </td>
                    <td><span className={`badge badge-${t.status}`}>{t.status}</span></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: '#f8fafc', fontWeight: 600 }}>
                  <td colSpan="2">Total Approved</td>
                  <td style={{ fontFamily: 'DM Mono, monospace' }}>{(data.summary.total_hours || 0).toFixed(2)}</td>
                  <td></td>
                  <td style={{ fontFamily: 'DM Mono, monospace', color: '#10b981' }}>${(data.summary.total_earnings || 0).toFixed(2)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
