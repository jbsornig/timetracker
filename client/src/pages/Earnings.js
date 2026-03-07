import React, { useState, useEffect } from 'react';
import { apiFetch } from '../api';

export default function Earnings() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiFetch(`/reports/my-earnings?year=${year}`)
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [year]);

  const years = [];
  const currentYear = new Date().getFullYear();
  for (let y = currentYear; y >= currentYear - 5; y--) years.push(y);

  if (loading) return <div style={{ padding: 40, color: '#94a3b8' }}>Loading...</div>;

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
