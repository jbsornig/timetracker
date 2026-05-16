import React, { useState, useEffect } from 'react';
import { apiFetch } from '../api';
import Modal from '../components/Modal';

function formatPhone(value) {
  const digits = value.replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

const emptyUser = {
  name: '', email: '', password: '', engineer_id: '', role: 'engineer',
  holiday_pay_eligible: false, holiday_pay_rate: '',
  address: '', city: '', state: '', zip: '', start_date: '', phone: '',
  bank_routing: '', bank_account: '', bank_account_type: 'checking',
  bank_routing_2: '', bank_account_2: '', bank_account_type_2: 'checking',
  bank_pct_1: 100, bank_pct_2: 0,
  pay_delay_months: 0
};

export default function Engineers() {
  const [engineers, setEngineers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyUser);
  const [admins, setAdmins] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedEngineer, setSelectedEngineer] = useState(null);
  const [engineerProjects, setEngineerProjects] = useState([]);
  const [profileHistory, setProfileHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [holidays, setHolidays] = useState([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const currentYear = new Date().getFullYear();
      const [users, projs, hols] = await Promise.all([
        apiFetch('/users'),
        apiFetch('/projects'),
        apiFetch(`/holidays?year=${currentYear}`),
      ]);
      setEngineers(users.filter((u) => u.role === 'engineer'));
      setAdmins(users.filter((u) => u.role === 'admin'));
      setProjects(projs);
      setHolidays(hols);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const getProjectCount = (engineerId) => {
    return projects.filter((p) => {
      return false;
    }).length;
  };

  const openAdd = (role = 'engineer') => {
    setForm({ ...emptyUser, role });
    setError('');
    setModal('add');
  };

  const openEdit = (user) => {
    setForm({
      ...user,
      password: '',
      holiday_pay_eligible: user.holiday_pay_eligible === 1,
      holiday_pay_rate: user.holiday_pay_rate || '',
      bank_routing: '', // Don't populate - will be masked display
      bank_account: '', // Don't populate - will be masked display
      bank_account_type: user.bank_account_type || 'checking',
      bank_routing_2: '', // Don't populate - will be masked display
      bank_account_2: '', // Don't populate - will be masked display
      bank_account_type_2: user.bank_account_type_2 || 'checking',
      bank_pct_1: user.bank_pct_1 ?? 100,
      bank_pct_2: user.bank_pct_2 ?? 0,
      pay_delay_months: user.pay_delay_months || 0,
      address: user.address || '',
      city: user.city || '',
      state: user.state || '',
      zip: user.zip || '',
      start_date: user.start_date || '',
      phone: user.phone ? formatPhone(user.phone) : '',
    });
    setError('');
    setProfileHistory([]);
    setShowHistory(false);
    setModal('edit');
  };

  const openProjects = async (engineer) => {
    setSelectedEngineer(engineer);
    try {
      const allProjects = await apiFetch('/projects');
      const assignedProjects = [];
      for (const proj of allProjects) {
        try {
          const engs = await apiFetch(`/projects/${proj.id}/engineers`);
          const found = engs.find((e) => e.user_id === engineer.id);
          if (found) {
            assignedProjects.push({ ...proj, pay_rate: found.pay_rate, bill_rate: found.bill_rate });
          }
        } catch (e) {
          // ignore
        }
      }
      setEngineerProjects(assignedProjects);
    } catch (e) {
      setEngineerProjects([]);
    }
    setModal('projects');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) {
      setError('Name and email are required');
      return;
    }
    if (modal === 'add' && !form.password) {
      setError('Password is required for new engineers');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body = {
        name: form.name,
        email: form.email,
        role: form.role,
        engineer_id: form.role === 'engineer' ? (form.engineer_id || null) : null,
        holiday_pay_eligible: form.role === 'engineer' ? (form.holiday_pay_eligible ? 1 : 0) : 0,
        holiday_pay_rate: form.role === 'engineer' ? (parseFloat(form.holiday_pay_rate) || 0) : 0,
        bank_account_type: form.role === 'engineer' ? form.bank_account_type : null,
        bank_account_type_2: form.role === 'engineer' ? form.bank_account_type_2 : null,
        bank_pct_1: form.role === 'engineer' ? (parseInt(form.bank_pct_1) || 100) : 100,
        bank_pct_2: form.role === 'engineer' ? (parseInt(form.bank_pct_2) || 0) : 0,
        pay_delay_months: form.role === 'engineer' ? (parseInt(form.pay_delay_months) || 0) : 0,
        address: form.address || '',
        city: form.city || '',
        state: form.state || '',
        zip: form.zip || '',
        start_date: form.start_date || '',
        phone: form.phone || '',
      };
      // Only include banking info if provided (don't overwrite with empty)
      if (form.bank_routing) body.bank_routing = form.bank_routing;
      if (form.bank_account) body.bank_account = form.bank_account;
      if (form.bank_routing_2) body.bank_routing_2 = form.bank_routing_2;
      if (form.bank_account_2) body.bank_account_2 = form.bank_account_2;
      if (form.password) {
        body.password = form.password;
      }
      if (modal === 'add') {
        await apiFetch('/users', { method: 'POST', body });
      } else {
        await apiFetch(`/users/${form.id}`, { method: 'PUT', body });
      }
      await loadData();
      setModal(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this engineer?')) return;
    try {
      await apiFetch(`/users/${id}`, { method: 'DELETE' });
      await loadData();
    } catch (e) {
      alert('Cannot delete: ' + e.message);
    }
  };

  if (loading) return <div style={{ padding: 40, color: '#94a3b8' }}>Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Users</div>
          <div className="page-subtitle">Manage admin and engineer accounts</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => openAdd('admin')}>+ Add Admin</button>
          <button className="btn btn-primary" onClick={() => openAdd('engineer')}>+ Add Engineer</button>
        </div>
      </div>

      {/* Admin Users Section */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-title">Administrators</div>
        {admins.length === 0 ? (
          <div className="empty-state">
            <p>No admin users.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Last Login</th>
                  <th style={{ width: 180 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {admins.map((admin) => (
                  <tr key={admin.id}>
                    <td><strong>{admin.name}</strong></td>
                    <td>{admin.email}</td>
                    <td style={{ fontSize: 13, color: admin.last_login ? 'inherit' : '#94a3b8' }}>
                      {admin.last_login ? new Date(admin.last_login + 'Z').toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit'
                      }) : 'Never'}
                    </td>
                    <td>
                      <button className="btn btn-secondary btn-sm" onClick={() => openEdit(admin)} style={{ marginRight: 8 }}>Edit</button>
                      {admins.length > 1 && (
                        <button className="btn btn-danger btn-sm" onClick={() => handleDelete(admin.id)}>Delete</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Engineers Section */}
      <div className="card">
        <div className="card-title">Engineers</div>
        {engineers.length === 0 ? (
          <div className="empty-state">
            <h3>No engineers yet</h3>
            <p>Add your first engineer to get started.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Engineer ID</th>
                  <th>Bank</th>
                  <th>Holiday Pay</th>
                  <th>Last Login</th>
                  <th>Projects</th>
                  <th style={{ width: 180 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {engineers.map((eng) => (
                  <tr key={eng.id}>
                    <td>
                      <strong>{eng.name}</strong>
                      {eng.pay_delay_months > 0 && (
                        <span style={{ marginLeft: 6, fontSize: 10, background: '#dbeafe', color: '#1e40af', padding: '1px 5px', borderRadius: 4 }}>
                          {eng.pay_delay_months}mo delay
                        </span>
                      )}
                    </td>
                    <td>{eng.email}</td>
                    <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 13 }}>{eng.engineer_id || '—'}</td>
                    <td>
                      {eng.has_banking ? (
                        <div>
                          <span style={{ color: 'var(--success)', fontSize: 13 }} title={`Routing: ${eng.bank_routing_masked}\nAccount: ${eng.bank_account_masked}`}>
                            ✓ {eng.bank_account_masked}
                          </span>
                          {eng.has_split && (
                            <div style={{ fontSize: 11, color: '#64748b' }}>
                              Split: {eng.bank_pct_1}% / {eng.bank_pct_2}%
                            </div>
                          )}
                        </div>
                      ) : (
                        <span style={{ color: '#f59e0b', fontSize: 13 }}>Not set</span>
                      )}
                    </td>
                    <td>
                      {eng.holiday_pay_eligible ? (
                        <span style={{ color: 'var(--success)', fontWeight: 500 }}>
                          ${(eng.holiday_pay_rate || 0).toFixed(2)}/hr
                        </span>
                      ) : (
                        <span style={{ color: '#94a3b8' }}>—</span>
                      )}
                    </td>
                    <td style={{ fontSize: 13, color: eng.last_login ? 'inherit' : '#94a3b8' }}>
                      {eng.last_login ? new Date(eng.last_login + 'Z').toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit'
                      }) : 'Never'}
                    </td>
                    <td>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => openProjects(eng)}
                        style={{ textDecoration: 'underline', color: 'var(--blue)' }}
                      >
                        View Projects
                      </button>
                    </td>
                    <td>
                      <button className="btn btn-secondary btn-sm" onClick={() => openEdit(eng)} style={{ marginRight: 8 }}>Edit</button>
                      <button className="btn btn-danger btn-sm" onClick={() => handleDelete(eng.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {(modal === 'add' || modal === 'edit') && (
        <Modal
          title={modal === 'add' ? `Add ${form.role === 'admin' ? 'Admin' : 'Engineer'}` : `Edit ${form.role === 'admin' ? 'Admin' : 'Engineer'}`}
          onClose={() => setModal(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </>
          }
        >
          <form onSubmit={handleSubmit}>
            {error && <div className="alert alert-error">{error}</div>}
            <div className="form-group">
              <label className="form-label">Role</label>
              <select
                className="form-select"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
              >
                <option value="engineer">Engineer</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Full Name *</label>
              <input
                className="form-input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="John Smith"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Email *</label>
              <input
                className="form-input"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="john@company.com"
              />
            </div>
            <div className="form-group">
              <label className="form-label">{modal === 'add' ? 'Password *' : 'Password (leave blank to keep current)'}</label>
              <input
                className="form-input"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder={modal === 'add' ? 'Enter password' : 'Leave blank to keep current'}
              />
            </div>
            {form.role === 'engineer' && (
              <>
                <div className="form-group">
                  <label className="form-label">Engineer ID</label>
                  <input
                    className="form-input"
                    value={form.engineer_id}
                    onChange={(e) => setForm({ ...form, engineer_id: e.target.value })}
                    placeholder="ENG-001"
                  />
                  <div className="form-hint">Optional identifier for timesheets</div>
                </div>
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 16 }}>
                  <div style={{ fontWeight: 600, marginBottom: 12 }}>Contact, Address & Start Date</div>
                  <div className="form-group">
                    <label className="form-label">Cell Phone</label>
                    <input className="form-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: formatPhone(e.target.value) })} placeholder="(555) 123-4567" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Street Address</label>
                    <input className="form-input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="123 Main St" />
                  </div>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <div className="form-group" style={{ flex: 2 }}>
                      <label className="form-label">City</label>
                      <input className="form-input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Detroit" />
                    </div>
                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label">State</label>
                      <input className="form-input" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} placeholder="MI" maxLength={2} />
                    </div>
                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label">Zip</label>
                      <input className="form-input" value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value })} placeholder="48201" maxLength={10} />
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Start Date</label>
                    <input className="form-input" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
                    <div className="form-hint">Date the engineer started working for you</div>
                  </div>
                </div>
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 16 }}>
                  <div style={{ fontWeight: 600, marginBottom: 12 }}>Holiday Pay Settings</div>
                  <div className="form-group">
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={form.holiday_pay_eligible}
                        onChange={(e) => setForm({ ...form, holiday_pay_eligible: e.target.checked })}
                        style={{ width: 18, height: 18 }}
                      />
                      <span>Eligible for Holiday Pay</span>
                    </label>
                  </div>
                  {form.holiday_pay_eligible && (
                    <>
                      <div className="form-group">
                        <label className="form-label">Holiday Pay Rate ($/hr)</label>
                        <input
                          className="form-input"
                          type="number"
                          step="0.01"
                          min="0"
                          value={form.holiday_pay_rate}
                          onChange={(e) => setForm({ ...form, holiday_pay_rate: e.target.value })}
                          placeholder="0.00"
                        />
                        <div className="form-hint">Rate paid per holiday hour</div>
                      </div>
                      {holidays.length > 0 && (
                        <div style={{ background: '#f8fafc', borderRadius: 8, padding: '12px 16px', marginTop: 8 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 8 }}>
                            {new Date().getFullYear()} Holidays ({holidays.length})
                          </div>
                          {holidays.sort((a, b) => a.date.localeCompare(b.date)).map(h => (
                            <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', fontSize: 13 }}>
                              <span style={{ color: '#1e293b' }}>{h.name}</span>
                              <span style={{ color: '#64748b' }}>
                                {new Date(h.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · {h.hours || 8}h
                              </span>
                            </div>
                          ))}
                          {form.holiday_pay_rate && (
                            <div style={{ borderTop: '1px solid #e2e8f0', marginTop: 8, paddingTop: 8, fontSize: 12, color: '#64748b' }}>
                              Est. annual holiday pay: <strong style={{ color: '#1e293b' }}>
                                ${(holidays.reduce((sum, h) => sum + (h.hours || 8), 0) * parseFloat(form.holiday_pay_rate || 0)).toFixed(2)}
                              </strong>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 16 }}>
                  <div style={{ fontWeight: 600, marginBottom: 12 }}>Pay Schedule</div>
                  <div className="form-group">
                    <label className="form-label">Pay Delay</label>
                    <select
                      className="form-input"
                      value={form.pay_delay_months}
                      onChange={(e) => setForm({ ...form, pay_delay_months: parseInt(e.target.value) })}
                    >
                      <option value={0}>Paid current month (no delay)</option>
                      <option value={1}>Paid 1 month behind</option>
                      <option value={2}>Paid 2 months behind</option>
                    </select>
                    <div className="form-hint">Engineers paid behind will show previous month's work in payroll</div>
                  </div>
                </div>
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 16 }}>
                  <div style={{ fontWeight: 600, marginBottom: 12 }}>Direct Deposit / ACH</div>

                  {/* Primary Account */}
                  <div style={{ background: 'var(--surface2)', padding: 12, borderRadius: 8, marginBottom: 12 }}>
                    <div style={{ fontWeight: 500, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>Primary Account</span>
                      <span style={{ fontSize: 13, color: '#64748b' }}>{form.bank_pct_1}%</span>
                    </div>
                    {modal === 'edit' && engineers.find(e => e.id === form.id)?.has_banking && (
                      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
                        Current: {engineers.find(e => e.id === form.id)?.bank_routing_masked} / {engineers.find(e => e.id === form.id)?.bank_account_masked}
                      </div>
                    )}
                    <div className="form-row">
                      <div className="form-group" style={{ flex: 1, marginBottom: 8 }}>
                        <label className="form-label">Routing Number</label>
                        <input
                          className="form-input"
                          value={form.bank_routing}
                          onChange={(e) => setForm({ ...form, bank_routing: e.target.value.replace(/\D/g, '').slice(0, 9) })}
                          placeholder="9 digits"
                          maxLength={9}
                        />
                      </div>
                      <div className="form-group" style={{ flex: 1, marginBottom: 8 }}>
                        <label className="form-label">Account Number</label>
                        <input
                          className="form-input"
                          value={form.bank_account}
                          onChange={(e) => setForm({ ...form, bank_account: e.target.value.replace(/\D/g, '').slice(0, 17) })}
                          placeholder="Up to 17 digits"
                          maxLength={17}
                        />
                      </div>
                      <div className="form-group" style={{ flex: 0.6, marginBottom: 8 }}>
                        <label className="form-label">Type</label>
                        <select
                          className="form-select"
                          value={form.bank_account_type}
                          onChange={(e) => setForm({ ...form, bank_account_type: e.target.value })}
                        >
                          <option value="checking">Checking</option>
                          <option value="savings">Savings</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Split Deposit Toggle */}
                  <div className="form-group">
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={form.bank_pct_2 > 0}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setForm({ ...form, bank_pct_1: 80, bank_pct_2: 20 });
                          } else {
                            setForm({ ...form, bank_pct_1: 100, bank_pct_2: 0, bank_routing_2: '', bank_account_2: '' });
                          }
                        }}
                        style={{ width: 18, height: 18 }}
                      />
                      <span>Split deposit to a second account</span>
                    </label>
                  </div>

                  {/* Secondary Account (if split enabled) */}
                  {form.bank_pct_2 > 0 && (
                    <>
                      <div style={{ background: 'var(--surface2)', padding: 12, borderRadius: 8, marginBottom: 12 }}>
                        <div style={{ fontWeight: 500, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span>Secondary Account</span>
                          <span style={{ fontSize: 13, color: '#64748b' }}>{form.bank_pct_2}%</span>
                        </div>
                        {modal === 'edit' && engineers.find(e => e.id === form.id)?.has_split && (
                          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
                            Current: {engineers.find(e => e.id === form.id)?.bank_routing_2_masked} / {engineers.find(e => e.id === form.id)?.bank_account_2_masked}
                          </div>
                        )}
                        <div className="form-row">
                          <div className="form-group" style={{ flex: 1, marginBottom: 8 }}>
                            <label className="form-label">Routing Number</label>
                            <input
                              className="form-input"
                              value={form.bank_routing_2}
                              onChange={(e) => setForm({ ...form, bank_routing_2: e.target.value.replace(/\D/g, '').slice(0, 9) })}
                              placeholder="9 digits"
                              maxLength={9}
                            />
                          </div>
                          <div className="form-group" style={{ flex: 1, marginBottom: 8 }}>
                            <label className="form-label">Account Number</label>
                            <input
                              className="form-input"
                              value={form.bank_account_2}
                              onChange={(e) => setForm({ ...form, bank_account_2: e.target.value.replace(/\D/g, '').slice(0, 17) })}
                              placeholder="Up to 17 digits"
                              maxLength={17}
                            />
                          </div>
                          <div className="form-group" style={{ flex: 0.6, marginBottom: 8 }}>
                            <label className="form-label">Type</label>
                            <select
                              className="form-select"
                              value={form.bank_account_type_2}
                              onChange={(e) => setForm({ ...form, bank_account_type_2: e.target.value })}
                            >
                              <option value="checking">Checking</option>
                              <option value="savings">Savings</option>
                            </select>
                          </div>
                        </div>
                      </div>

                      {/* Split Percentage Slider */}
                      <div className="form-group">
                        <label className="form-label">Split Percentage</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <span style={{ fontSize: 13, minWidth: 70 }}>Primary: {form.bank_pct_1}%</span>
                          <input
                            type="range"
                            min="10"
                            max="90"
                            step="5"
                            value={form.bank_pct_1}
                            onChange={(e) => {
                              const pct1 = parseInt(e.target.value);
                              setForm({ ...form, bank_pct_1: pct1, bank_pct_2: 100 - pct1 });
                            }}
                            style={{ flex: 1 }}
                          />
                          <span style={{ fontSize: 13, minWidth: 80 }}>Secondary: {form.bank_pct_2}%</span>
                        </div>
                      </div>
                    </>
                  )}

                  <div className="form-hint" style={{ marginTop: 8 }}>
                    Leave fields blank to keep existing values when editing.
                  </div>
                </div>
              </>
            )}
            {modal === 'edit' && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 16 }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={async () => {
                    if (!showHistory) {
                      try {
                        const data = await apiFetch(`/users/${form.id}/profile-history`);
                        setProfileHistory(data);
                      } catch (e) { setProfileHistory([]); }
                    }
                    setShowHistory(!showHistory);
                  }}
                >
                  {showHistory ? 'Hide' : 'Show'} Profile Change History
                </button>
                {showHistory && (
                  <div style={{ marginTop: 12 }}>
                    {profileHistory.length === 0 ? (
                      <div style={{ color: '#94a3b8', fontSize: 13, fontStyle: 'italic' }}>No profile changes recorded.</div>
                    ) : (
                      <div className="table-wrap">
                        <table style={{ fontSize: 12 }}>
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>Field</th>
                              <th>Old Value</th>
                              <th>New Value</th>
                              <th>Changed By</th>
                            </tr>
                          </thead>
                          <tbody>
                            {profileHistory.map(h => (
                              <tr key={h.id}>
                                <td style={{ whiteSpace: 'nowrap' }}>{new Date(h.changed_at + 'Z').toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                                <td style={{ fontWeight: 600, textTransform: 'capitalize' }}>{h.field_name}</td>
                                <td style={{ color: h.old_value ? '#64748b' : '#94a3b8' }}>{h.old_value || '(empty)'}</td>
                                <td style={{ color: h.new_value ? '#1e40af' : '#dc2626', fontWeight: 500 }}>{h.new_value || '(cleared)'}</td>
                                <td><span style={{ padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', background: h.changed_by === 'admin' ? '#dbeafe' : '#fef3c7', color: h.changed_by === 'admin' ? '#1e40af' : '#92400e' }}>{h.changed_by}</span></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </form>
        </Modal>
      )}

      {modal === 'projects' && selectedEngineer && (
        <Modal
          title={`Projects - ${selectedEngineer.name}`}
          onClose={() => setModal(null)}
          footer={<button className="btn btn-secondary" onClick={() => setModal(null)}>Close</button>}
        >
          {engineerProjects.length === 0 ? (
            <div className="empty-state">
              <h3>No project assignments</h3>
              <p>Assign this engineer to projects from the Projects page.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Customer</th>
                    <th>Pay Rate</th>
                    <th>Bill Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {engineerProjects.map((proj) => (
                    <tr key={proj.id}>
                      <td><strong>{proj.name}</strong><br /><span style={{ fontSize: 12, color: '#94a3b8' }}>{proj.po_number || ''}</span></td>
                      <td>{proj.customer_name}</td>
                      <td>${proj.pay_rate?.toFixed(2) || '0.00'}/hr</td>
                      <td>${proj.bill_rate?.toFixed(2) || '0.00'}/hr</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
