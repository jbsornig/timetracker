import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../api';

export default function Dashboard({ setPage }) {
  const { user } = useAuth();
  const [projects, setProjects] = useState([]);
  const [timesheets, setTimesheets] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [earnings, setEarnings] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const year = new Date().getFullYear();
    Promise.all([
      apiFetch('/projects'),
      apiFetch('/timesheets'),
      user.role === 'admin' ? apiFetch('/reports/project-budget') : Promise.resolve([]),
      user.role !== 'admin' ? apiFetch(`/reports/my-earnings?year=${year}`) : Promise.resolve(null),
    ]).then(([p, t, b, e]) => { setProjects(p); setTimesheets(t); setBudgets(b); setEarnings(e); setLoading(false); }).catch(() => setLoading(false));
  }, [user]);

  if (loading) return <div style={{ padding: 40, color: '#94a3b8' }}>Loading…</div>;

  const pending = timesheets.filter(t => t.status === 'submitted').length;
  const totalHours = timesheets.reduce((s, t) => s + (t.total_hours || 0), 0);

  if (user.role === 'admin') {
    const totalBilled = budgets.reduce((s, b) => s + (b.amount_billed || 0), 0);
    const totalPO = budgets.reduce((s, b) => s + (b.po_amount || 0), 0);

    return (
      <div>
        <div className="page-header">
          <div>
            <div className="page-title">Dashboard</div>
            <div className="page-subtitle">Welcome back, {user.name}</div>
          </div>
        </div>

        <div className="stat-grid">
          <div className="stat-card accent">
            <div className="stat-label">Active Projects</div>
            <div className="stat-value">{projects.filter(p => p.status === 'active').length}</div>
            <div className="stat-sub">{projects.length} total</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Pending Approval</div>
            <div className="stat-value" style={{ color: pending > 0 ? '#f59e0b' : undefined }}>{pending}</div>
            <div className="stat-sub">timesheets awaiting review</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Total Billed</div>
            <div className="stat-value">${totalBilled.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
            <div className="stat-sub">of ${totalPO.toLocaleString()} PO value</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Total Hours Logged</div>
            <div className="stat-value">{totalHours.toFixed(1)}</div>
            <div className="stat-sub">across all approved sheets</div>
          </div>
        </div>

        {pending > 0 && (
          <div className="alert alert-info" style={{ cursor: 'pointer' }} onClick={() => setPage('timesheets')}>
            ⏳ You have <strong>{pending} timesheet{pending > 1 ? 's' : ''}</strong> waiting for approval. Click to review.
          </div>
        )}

        <div className="card">
          <div className="card-title">Project Budget Overview</div>
          {budgets.length === 0 ? <p style={{ color: '#94a3b8' }}>No projects yet.</p> : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Project</th><th>Customer</th><th>PO Amount</th><th>Billed</th><th>Remaining</th><th>Usage</th>
                  </tr>
                </thead>
                <tbody>
                  {budgets.map(b => {
                    const pct = b.po_amount > 0 ? (b.amount_billed / b.po_amount) * 100 : 0;
                    const cls = pct >= 90 ? 'progress-danger' : pct >= 70 ? 'progress-warn' : 'progress-good';
                    return (
                      <tr key={b.id}>
                        <td><strong>{b.project_name}</strong><br /><span style={{ fontSize: 12, color: '#94a3b8' }}>{b.po_number}</span></td>
                        <td>{b.customer_name}</td>
                        <td>${(b.po_amount || 0).toLocaleString()}</td>
                        <td>${(b.amount_billed || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td style={{ color: b.remaining < 0 ? '#ef4444' : undefined }}>${(b.remaining || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td style={{ minWidth: 120 }}>
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
              </table>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Engineer dashboard
  const myDraft = timesheets.filter(t => t.status === 'draft').length;
  const mySubmitted = timesheets.filter(t => t.status === 'submitted').length;
  const myApproved = timesheets.filter(t => t.status === 'approved').length;
  const currentYear = new Date().getFullYear();

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">My Dashboard</div>
          <div className="page-subtitle">Welcome back, {user.name}</div>
        </div>
        <button className="btn btn-primary" onClick={() => { localStorage.setItem('openNewTimesheet', 'true'); setPage('timesheets'); }}>+ New Timesheet</button>
      </div>

      <div className="stat-grid">
        <div className="stat-card accent">
          <div className="stat-label">{currentYear} Earnings</div>
          <div className="stat-value">${(earnings?.summary?.total_earnings || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div className="stat-sub">{(earnings?.summary?.total_hours || 0).toFixed(1)} hours approved</div>
        </div>
        <div className="stat-card" onClick={() => setPage('earnings')} style={{ cursor: 'pointer' }}>
          <div className="stat-label">Pending</div>
          <div className="stat-value" style={{ color: '#f59e0b' }}>${(earnings?.summary?.pending_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div className="stat-sub">{(earnings?.summary?.pending_hours || 0).toFixed(1)} hours awaiting approval</div>
        </div>
        <div className="stat-card" onClick={() => setPage('timesheets')} style={{ cursor: 'pointer' }}>
          <div className="stat-label">Draft</div>
          <div className="stat-value">{myDraft}</div>
          <div className="stat-sub">timesheets in progress</div>
        </div>
        <div className="stat-card" onClick={() => setPage('timesheets')} style={{ cursor: 'pointer' }}>
          <div className="stat-label">Approved</div>
          <div className="stat-value" style={{ color: '#10b981' }}>{myApproved}</div>
          <div className="stat-sub">timesheets this year</div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">My Assigned Projects</div>
        {projects.length === 0 ? (
          <p style={{ color: '#94a3b8' }}>No projects assigned yet. Contact your administrator.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Project</th><th>Customer</th><th>Location</th><th>PO #</th><th>Hours</th></tr></thead>
              <tbody>
                {projects.map(p => {
                  const remaining = p.budgeted_hours ? p.budgeted_hours - (p.hours_used || 0) : null;
                  const pct = p.budgeted_hours ? ((p.hours_used || 0) / p.budgeted_hours) * 100 : 0;
                  return (
                    <tr key={p.id}>
                      <td><strong>{p.name}</strong></td>
                      <td>{p.customer_name}</td>
                      <td>{p.location || '—'}</td>
                      <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 13 }}>{p.po_number || '—'}</td>
                      <td style={{ minWidth: 140 }}>
                        {p.project_type === 'fixed_price' ? (
                          <span style={{ color: '#64748b', fontSize: 13 }}>Fixed Price</span>
                        ) : p.budgeted_hours ? (
                          <div>
                            <div style={{ fontSize: 13, color: remaining < 0 ? '#ef4444' : pct >= 80 ? '#f59e0b' : '#10b981', fontWeight: 500 }}>
                              {remaining >= 0 ? `${remaining.toFixed(1)} hrs remaining` : `${Math.abs(remaining).toFixed(1)} hrs over`}
                            </div>
                            <div style={{ fontSize: 11, color: '#94a3b8' }}>
                              {(p.hours_used || 0).toFixed(1)} of {p.budgeted_hours.toFixed(1)} used
                            </div>
                          </div>
                        ) : (
                          <span style={{ color: '#94a3b8', fontSize: 13 }}>—</span>
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

      <div className="card" style={{ marginTop: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>Recent Timesheets</div>
          <button className="btn btn-secondary btn-sm" onClick={() => setPage('earnings')}>View Earnings Report</button>
        </div>
        {timesheets.length === 0 ? (
          <div className="empty-state">
            <div>No timesheets yet. <span style={{ color: '#2563eb', cursor: 'pointer' }} onClick={() => setPage('timesheets')}>Create your first one →</span></div>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Week Ending</th><th>Project</th><th>Hours</th><th>Amount</th><th>Status</th></tr></thead>
              <tbody>
                {timesheets.slice(0, 5).map(t => {
                  const amount = (t.total_hours || 0) * (t.pay_rate || 0);
                  return (
                    <tr key={t.id}>
                      <td>{new Date(t.week_ending + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                      <td>{t.project_name}<br /><span style={{ fontSize: 12, color: '#94a3b8' }}>{t.customer_name}</span></td>
                      <td style={{ fontFamily: 'DM Mono, monospace' }}>{(t.total_hours || 0).toFixed(2)}</td>
                      <td style={{ fontFamily: 'DM Mono, monospace', color: t.status === 'approved' ? '#10b981' : '#64748b' }}>${amount.toFixed(2)}</td>
                      <td><span className={`badge badge-${t.status}`}>{t.status}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
