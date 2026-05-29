import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../api';
import Modal from '../components/Modal';

const emptyProject = { customer_id: '', contact_id: '', name: '', description: '', po_number: '', po_amount: '', location: '', status: 'active', include_timesheets: true, project_type: 'hourly', total_cost: '', requires_daily_logs: true, billing_method: 'percentage', monthly_engineer_pay: '', monthly_invoice_amount: '', internal: false };

export default function Projects() {
  const [projects, setProjects] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [engineers, setEngineers] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyProject);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedProject, setSelectedProject] = useState(null);
  const [projectEngineers, setProjectEngineers] = useState([]);
  const [assignForm, setAssignForm] = useState({ user_id: '', pay_rate: '', bill_rate: '', total_payment: '', monthly_pay: '', monthly_bill: '' });
  const [customerFilter, setCustomerFilter] = useState('');
  const [engineerFilter, setEngineerFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [engineerAssignments, setEngineerAssignments] = useState([]);
  const [notifying, setNotifying] = useState(null);
  const [sortField, setSortField] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [p, c, u, ep] = await Promise.all([
        apiFetch('/projects'),
        apiFetch('/customers'),
        apiFetch('/users'),
        apiFetch('/engineer-projects'),
      ]);
      setProjects(p);
      setCustomers(c);
      setEngineers(u.filter((user) => user.role === 'engineer'));
      setEngineerAssignments(ep);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadContacts = useCallback(async (customerId) => {
    if (!customerId) {
      setContacts([]);
      return;
    }
    try {
      const data = await apiFetch(`/customers/${customerId}/contacts`);
      setContacts(data);
    } catch (e) {
      setContacts([]);
    }
  }, []);

  const openAdd = () => {
    setForm(emptyProject);
    setContacts([]);
    setError('');
    setModal('add');
  };

  const openEdit = async (project) => {
    setForm({
      ...project,
      contact_id: project.contact_id || '',
      description: project.description || '',
      po_amount: project.po_amount || '',
      include_timesheets: project.include_timesheets !== 0,
      project_type: project.project_type || 'hourly',
      total_cost: project.total_cost || '',
      requires_daily_logs: project.requires_daily_logs !== 0,
      billing_method: project.billing_method || 'percentage',
      monthly_engineer_pay: project.monthly_engineer_pay || '',
      monthly_invoice_amount: project.monthly_invoice_amount || '',
      internal: project.internal === 1,
    });
    setError('');
    if (project.customer_id) {
      await loadContacts(project.customer_id);
    }
    setModal('edit');
  };

  const openAssign = async (project) => {
    setSelectedProject(project);
    setAssignForm({ user_id: '', pay_rate: '', bill_rate: '', total_payment: '' });
    try {
      const engs = await apiFetch(`/projects/${project.id}/engineers`);
      setProjectEngineers(engs);
    } catch (e) {
      setProjectEngineers([]);
    }
    setModal('assign');
  };

  const handleCustomerChange = async (customerId) => {
    setForm({ ...form, customer_id: customerId, contact_id: '' });
    await loadContacts(customerId);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.customer_id) {
      setError('Customer and project name are required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body = {
        ...form,
        contact_id: form.contact_id || null,
        po_amount: form.po_amount ? parseFloat(form.po_amount) : 0,
        total_cost: form.total_cost ? parseFloat(form.total_cost) : 0,
        monthly_engineer_pay: form.monthly_engineer_pay ? parseFloat(form.monthly_engineer_pay) : 0,
        monthly_invoice_amount: form.monthly_invoice_amount ? parseFloat(form.monthly_invoice_amount) : 0,
      };
      if (modal === 'add') {
        await apiFetch('/projects', { method: 'POST', body });
      } else {
        await apiFetch(`/projects/${form.id}`, { method: 'PUT', body });
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
    if (!window.confirm('Are you sure you want to delete this project?')) return;
    try {
      await apiFetch(`/projects/${id}`, { method: 'DELETE' });
      await loadData();
    } catch (e) {
      alert('Cannot delete: ' + e.message);
    }
  };

  const handleAssignEngineer = async (e) => {
    e.preventDefault();
    const isFixedPrice = selectedProject?.project_type === 'fixed_price';
    const isFixedMonthly = selectedProject?.project_type === 'fixed_monthly';
    if (isFixedPrice) {
      if (!assignForm.user_id || !assignForm.total_payment) {
        setError('Engineer and total payment are required');
        return;
      }
    } else if (isFixedMonthly) {
      if (!assignForm.user_id || !assignForm.monthly_pay || !assignForm.monthly_bill) {
        setError('Engineer, monthly pay, and monthly bill are required');
        return;
      }
    } else {
      if (!assignForm.user_id || !assignForm.pay_rate || !assignForm.bill_rate) {
        setError('All fields are required');
        return;
      }
    }
    setSaving(true);
    setError('');
    try {
      await apiFetch(`/projects/${selectedProject.id}/engineers`, {
        method: 'POST',
        body: {
          user_id: parseInt(assignForm.user_id),
          pay_rate: isFixedPrice || isFixedMonthly ? 0 : parseFloat(assignForm.pay_rate),
          bill_rate: isFixedPrice || isFixedMonthly ? 0 : parseFloat(assignForm.bill_rate),
          total_payment: isFixedPrice ? parseFloat(assignForm.total_payment) : 0,
          monthly_pay: isFixedMonthly ? parseFloat(assignForm.monthly_pay) : 0,
          monthly_bill: isFixedMonthly ? parseFloat(assignForm.monthly_bill) : 0,
        },
      });
      const engs = await apiFetch(`/projects/${selectedProject.id}/engineers`);
      setProjectEngineers(engs);
      setAssignForm({ user_id: '', pay_rate: '', bill_rate: '', total_payment: '', monthly_pay: '', monthly_bill: '' });
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleUnassignEngineer = async (userId) => {
    if (!window.confirm('Remove this engineer from the project?')) return;
    try {
      await apiFetch(`/projects/${selectedProject.id}/engineers/${userId}`, { method: 'DELETE' });
      const engs = await apiFetch(`/projects/${selectedProject.id}/engineers`);
      setProjectEngineers(engs);
    } catch (e) {
      alert('Error: ' + e.message);
    }
  };

  const [emailPreview, setEmailPreview] = useState(null);

  const handleNotifyEngineer = async (userId) => {
    setNotifying(userId);
    try {
      const result = await apiFetch(`/projects/${selectedProject.id}/notify-engineer`, {
        method: 'POST',
        body: { user_id: userId, preview: true },
      });
      setEmailPreview({ ...result, userId });
    } catch (e) {
      alert('Error: ' + e.message);
    } finally {
      setNotifying(null);
    }
  };

  const handleSendNotification = async () => {
    if (!emailPreview) return;
    try {
      const result = await apiFetch(`/projects/${selectedProject.id}/notify-engineer`, {
        method: 'POST',
        body: { user_id: emailPreview.userId, preview: false },
      });
      alert(result.message);
      setEmailPreview(null);
    } catch (e) {
      alert('Error: ' + e.message);
    }
  };

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir(field === 'created_at' ? 'desc' : 'asc');
    }
  };

  const sortIndicator = (field) => sortField === field ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  if (loading) return <div style={{ padding: 40, color: '#94a3b8' }}>Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Projects</div>
          <div className="page-subtitle">Manage projects and engineer assignments</div>
        </div>
        <button className="btn btn-primary" onClick={openAdd}>+ Add Project</button>
      </div>

      <div className="card" style={{ marginBottom: 16, padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: '#64748b' }}>Status:</span>
            <select
              className="form-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{ width: 'auto', minWidth: 130 }}
            >
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: '#64748b' }}>Customer:</span>
            <select
              className="form-select"
              value={customerFilter}
              onChange={(e) => setCustomerFilter(e.target.value)}
              style={{ width: 'auto', minWidth: 200 }}
            >
              <option value="">All Customers</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: '#64748b' }}>Engineer:</span>
            <select
              className="form-select"
              value={engineerFilter}
              onChange={(e) => setEngineerFilter(e.target.value)}
              style={{ width: 'auto', minWidth: 180 }}
            >
              <option value="">All Engineers</option>
              {engineers.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: '#64748b' }}>Created:</span>
            <input type="date" className="form-input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={{ width: 140, padding: '4px 8px', fontSize: 13 }} />
            <span style={{ fontSize: 13, color: '#64748b' }}>to</span>
            <input type="date" className="form-input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={{ width: 140, padding: '4px 8px', fontSize: 13 }} />
            {(dateFrom || dateTo) && <button className="btn btn-secondary btn-sm" onClick={() => { setDateFrom(''); setDateTo(''); }} style={{ padding: '2px 8px', fontSize: 11 }}>Clear</button>}
          </div>
          <span style={{ fontSize: 13, color: '#94a3b8', marginLeft: 'auto' }}>
            {projects.filter(p => {
              if (statusFilter && p.status !== statusFilter) return false;
              if (customerFilter && String(p.customer_id) !== customerFilter) return false;
              if (engineerFilter && !engineerAssignments.some(ea => ea.project_id === p.id && String(ea.user_id) === engineerFilter)) return false;
              if (dateFrom && p.created_at && p.created_at.slice(0, 10) < dateFrom) return false;
              if (dateTo && p.created_at && p.created_at.slice(0, 10) > dateTo) return false;
              return true;
            }).length} of {projects.length} projects
          </span>
        </div>
      </div>

      <div className="card">
        {projects.length === 0 ? (
          <div className="empty-state">
            <h3>No projects yet</h3>
            <p>Add your first project to get started.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th onClick={() => handleSort('name')} style={{ cursor: 'pointer', userSelect: 'none' }}>Project{sortIndicator('name')}</th>
                  <th>Type</th>
                  <th onClick={() => handleSort('customer')} style={{ cursor: 'pointer', userSelect: 'none' }}>Customer{sortIndicator('customer')}</th>
                  <th>Contact</th>
                  <th>PO #</th>
                  <th>Budget</th>
                  <th>Billed</th>
                  <th>Remaining</th>
                  <th>Progress</th>
                  <th>Status</th>
                  <th onClick={() => handleSort('created_at')} style={{ cursor: 'pointer', userSelect: 'none' }}>Created{sortIndicator('created_at')}</th>
                  <th style={{ width: 180 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {projects.filter(p => {
                  if (statusFilter && p.status !== statusFilter) return false;
                  if (customerFilter && String(p.customer_id) !== customerFilter) return false;
                  if (engineerFilter && !engineerAssignments.some(ea => ea.project_id === p.id && String(ea.user_id) === engineerFilter)) return false;
                  if (dateFrom && p.created_at && p.created_at.slice(0, 10) < dateFrom) return false;
                  if (dateTo && p.created_at && p.created_at.slice(0, 10) > dateTo) return false;
                  return true;
                }).sort((a, b) => {
                  let aVal, bVal;
                  if (sortField === 'created_at') {
                    aVal = a.created_at || '';
                    bVal = b.created_at || '';
                  } else if (sortField === 'customer') {
                    aVal = (a.customer_name || '').toLowerCase();
                    bVal = (b.customer_name || '').toLowerCase();
                  } else {
                    aVal = (a.name || '').toLowerCase();
                    bVal = (b.name || '').toLowerCase();
                  }
                  if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
                  if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
                  return 0;
                }).map((p) => {
                  const isFixedPrice = p.project_type === 'fixed_price';
                  const isFixedMonthly = p.project_type === 'fixed_monthly';
                  const budget = isFixedPrice ? (p.total_cost || 0) : (p.po_amount || 0);
                  const billed = p.amount_billed || 0;
                  const remaining = budget - billed;
                  const pct = budget > 0 ? (billed / budget) * 100 : 0;
                  const cls = pct >= 90 ? 'progress-danger' : pct >= 70 ? 'progress-warn' : 'progress-good';
                  return (
                    <tr key={p.id}>
                      <td><strong>{p.name}</strong><br /><span style={{ fontSize: 12, color: '#94a3b8' }}>{p.location || ''}</span></td>
                      <td>
                        <span className={`badge ${isFixedPrice ? 'badge-fixed' : isFixedMonthly ? 'badge-fixed' : 'badge-hourly'}`} style={{ fontSize: 11 }}>
                          {isFixedPrice ? 'Fixed Price' : isFixedMonthly ? 'Fixed Monthly' : 'Hourly'}
                        </span>
                        {p.internal === 1 && (
                          <span className="badge" style={{ fontSize: 10, marginLeft: 4, background: '#dbeafe', color: '#1d4ed8' }}>Internal</span>
                        )}
                      </td>
                      <td>{p.customer_name}</td>
                      <td>{p.contact_name || '—'}</td>
                      <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 13 }}>{p.po_number || '—'}</td>
                      <td>${budget.toLocaleString()}</td>
                      <td>${billed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td style={{ color: remaining < 0 ? '#ef4444' : undefined }}>
                        ${remaining.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td style={{ minWidth: 100 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div className="progress-bar" style={{ flex: 1 }}>
                            <div className={`progress-fill ${cls}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                          </div>
                          <span style={{ fontSize: 11, color: '#64748b', minWidth: 30 }}>{pct.toFixed(0)}%</span>
                        </div>
                      </td>
                      <td>
                        <span className={`badge badge-${p.status === 'active' ? 'active' : 'inactive'}`}>{p.status}</span>
                      </td>
                      <td style={{ fontSize: 12, color: '#64748b' }}>
                        {p.created_at ? new Date(p.created_at).toLocaleDateString() : '—'}
                      </td>
                      <td>
                        <button className="btn btn-secondary btn-sm" onClick={() => openAssign(p)} style={{ marginRight: 4 }}>Engineers</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => openEdit(p)} style={{ marginRight: 4 }}>Edit</button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDelete(p.id)}>Delete</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {(modal === 'add' || modal === 'edit') && (
        <Modal
          title={modal === 'add' ? 'Add Project' : 'Edit Project'}
          onClose={() => setModal(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
                {saving ? 'Saving...' : modal === 'add' ? 'Add Project' : 'Save Changes'}
              </button>
            </>
          }
        >
          <form onSubmit={handleSubmit}>
            {error && <div className="alert alert-error">{error}</div>}
            <div className="form-group">
              <label className="form-label">Customer *</label>
              <select
                className="form-select"
                value={form.customer_id}
                onChange={(e) => handleCustomerChange(e.target.value)}
              >
                <option value="">Select a customer...</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Customer Contact</label>
              <select
                className="form-select"
                value={form.contact_id}
                onChange={(e) => setForm({ ...form, contact_id: e.target.value })}
                disabled={!form.customer_id}
              >
                <option value="">Select a contact...</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.title ? ` - ${c.title}` : ''}</option>
                ))}
              </select>
              <div className="form-hint">The main person from the customer for this project (appears on invoices)</div>
            </div>
            <div className="form-group">
              <label className="form-label">Project Name *</label>
              <input
                className="form-input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Enter project name"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Invoice Description</label>
              <textarea
                className="form-textarea"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Description that appears on invoices (e.g., 'Engineering Labor Hours')"
                rows={2}
              />
              <div className="form-hint">This description will appear on invoice line items</div>
            </div>
            <div className="form-group">
              <label className="form-label">Project Type</label>
              <div style={{ display: 'flex', gap: 16 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="project_type"
                    value="hourly"
                    checked={form.project_type === 'hourly'}
                    onChange={(e) => setForm({ ...form, project_type: e.target.value })}
                  />
                  <span>Hourly</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="project_type"
                    value="fixed_monthly"
                    checked={form.project_type === 'fixed_monthly'}
                    onChange={(e) => setForm({ ...form, project_type: e.target.value })}
                  />
                  <span>Fixed Monthly</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="project_type"
                    value="fixed_price"
                    checked={form.project_type === 'fixed_price'}
                    onChange={(e) => setForm({ ...form, project_type: e.target.value })}
                  />
                  <span>Fixed Price</span>
                </label>
              </div>
              <div className="form-hint">
                {form.project_type === 'hourly'
                  ? 'Engineers bill by the hour with time entries'
                  : form.project_type === 'fixed_monthly'
                  ? 'Fixed monthly pay and billing — timesheets required for detail only'
                  : 'Engineers bill a percentage of their total payment'}
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">PO Number</label>
                <input
                  className="form-input"
                  value={form.po_number}
                  onChange={(e) => setForm({ ...form, po_number: e.target.value })}
                  placeholder="PO-12345"
                />
              </div>
              <div className="form-group">
                <label className="form-label">{form.project_type === 'fixed_price' ? 'Total Cost ($)' : 'PO Amount ($)'}</label>
                {form.project_type === 'fixed_price' ? (
                  <input
                    className="form-input"
                    type="number"
                    step="0.01"
                    value={form.total_cost}
                    onChange={(e) => setForm({ ...form, total_cost: e.target.value })}
                    placeholder="0.00"
                  />
                ) : (
                  <input
                    className="form-input"
                    type="number"
                    step="0.01"
                    value={form.po_amount}
                    onChange={(e) => setForm({ ...form, po_amount: e.target.value })}
                    placeholder="0.00"
                  />
                )}
                <div className="form-hint">
                  {form.project_type === 'fixed_price'
                    ? 'Total amount to bill the customer for this project'
                    : 'Budget limit for hourly billing'}
                </div>
              </div>
            </div>
            {form.project_type === 'fixed_price' && (
              <div style={{ background: '#f0f9ff', padding: 16, borderRadius: 8, marginBottom: 16 }}>
                <div style={{ fontWeight: 600, marginBottom: 12 }}>Billing Method</div>
                <div className="form-group">
                  <select
                    className="form-select"
                    value={form.billing_method}
                    onChange={(e) => setForm({ ...form, billing_method: e.target.value })}
                  >
                    <option value="percentage">Percentage-based (engineer enters %)</option>
                    <option value="monthly_installment">Monthly Installment (fixed monthly amounts)</option>
                  </select>
                </div>
                {form.billing_method === 'monthly_installment' && (
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Monthly Engineer Pay ($)</label>
                      <input
                        className="form-input"
                        type="number"
                        step="0.01"
                        value={form.monthly_engineer_pay}
                        onChange={(e) => setForm({ ...form, monthly_engineer_pay: e.target.value })}
                        placeholder="0.00"
                      />
                      <div className="form-hint">Amount paid to engineer each month</div>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Monthly Invoice Amount ($)</label>
                      <input
                        className="form-input"
                        type="number"
                        step="0.01"
                        value={form.monthly_invoice_amount}
                        onChange={(e) => setForm({ ...form, monthly_invoice_amount: e.target.value })}
                        placeholder="0.00"
                      />
                      <div className="form-hint">Amount billed to customer each month</div>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Location</label>
                <input
                  className="form-input"
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  placeholder="Job site location"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Status</label>
                <select
                  className="form-select"
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>
            <div className="form-group" style={{ marginTop: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={form.include_timesheets}
                  onChange={(e) => setForm({ ...form, include_timesheets: e.target.checked })}
                  style={{ width: 18, height: 18 }}
                />
                <span>Include timesheets with invoice emails</span>
              </label>
              <div className="form-hint">When checked, emailed invoices will include detailed timesheet reports</div>
            </div>
            {(form.project_type === 'hourly' || form.project_type === 'fixed_monthly') && (
              <div className="form-group" style={{ marginTop: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={form.requires_daily_logs}
                    onChange={(e) => setForm({ ...form, requires_daily_logs: e.target.checked })}
                    style={{ width: 18, height: 18 }}
                  />
                  <span>Requires daily time logs</span>
                </label>
                <div className="form-hint">When unchecked, engineers can submit monthly hour totals instead of daily logs</div>
              </div>
            )}
            <div className="form-group" style={{ marginTop: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={form.internal}
                  onChange={(e) => setForm({ ...form, internal: e.target.checked })}
                  style={{ width: 18, height: 18 }}
                />
                <span>Internal Project</span>
              </label>
              <div className="form-hint">Internal projects are not invoiced to customers but engineers still get paid for their time</div>
            </div>
          </form>
        </Modal>
      )}

      {modal === 'assign' && selectedProject && (
        <Modal
          title={`Engineers - ${selectedProject.name}`}
          onClose={() => setModal(null)}
          footer={<button className="btn btn-secondary" onClick={() => setModal(null)}>Close</button>}
        >
          {error && <div className="alert alert-error">{error}</div>}

          <div style={{ marginBottom: 20 }}>
            <div className="card-title" style={{ fontSize: 14 }}>
              Assigned Engineers
              {selectedProject.project_type === 'fixed_price' && (
                <span style={{ fontWeight: 400, color: '#64748b', marginLeft: 8 }}>(Fixed Price Project)</span>
              )}
              {selectedProject.project_type === 'fixed_monthly' && (
                <span style={{ fontWeight: 400, color: '#64748b', marginLeft: 8 }}>(Fixed Monthly Project)</span>
              )}
            </div>
            {projectEngineers.length === 0 ? (
              <p style={{ color: '#94a3b8', fontSize: 14 }}>No engineers assigned yet.</p>
            ) : (
              <div>
                {projectEngineers.map((eng) => (
                  <div key={eng.user_id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 16px', marginBottom: 10, background: '#f8fafc' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                      <div>
                        <strong>{eng.name}</strong>
                        <div style={{ fontSize: 12, color: '#94a3b8' }}>{eng.engineer_id || eng.email}</div>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', textAlign: 'right' }}>
                        {selectedProject.project_type === 'fixed_price'
                          ? `$${(eng.total_payment || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          : selectedProject.project_type === 'fixed_monthly'
                            ? `$${(eng.monthly_pay || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mo`
                            : `$${eng.pay_rate?.toFixed(2) || '0.00'}/hr`
                        }
                        {selectedProject.project_type === 'fixed_monthly' && (
                          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 400 }}>Bill: ${(eng.monthly_bill || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mo</div>
                        )}
                        {selectedProject.project_type === 'hourly' && (
                          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 400 }}>Bill: ${eng.bill_rate?.toFixed(2) || '0.00'}/hr</div>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleNotifyEngineer(eng.user_id)}
                        disabled={notifying === eng.user_id}
                      >
                        {notifying === eng.user_id ? 'Sending...' : 'Send Assignment Email'}
                      </button>
                      <button className="btn btn-danger btn-sm" onClick={() => handleUnassignEngineer(eng.user_id)}>Remove</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <div className="card-title" style={{ fontSize: 14 }}>Add Engineer</div>
            <form onSubmit={handleAssignEngineer}>
              <div className="form-group">
                <label className="form-label">Engineer</label>
                <select
                  className="form-select"
                  value={assignForm.user_id}
                  onChange={(e) => setAssignForm({ ...assignForm, user_id: e.target.value })}
                >
                  <option value="">Select an engineer...</option>
                  {engineers
                    .filter((eng) => !projectEngineers.some((pe) => pe.user_id === eng.id))
                    .map((eng) => (
                      <option key={eng.id} value={eng.id}>{eng.name}</option>
                    ))}
                </select>
              </div>
              {selectedProject.project_type === 'fixed_price' ? (
                <div className="form-group">
                  <label className="form-label">Total Payment ($)</label>
                  <input
                    className="form-input"
                    type="number"
                    step="0.01"
                    value={assignForm.total_payment}
                    onChange={(e) => setAssignForm({ ...assignForm, total_payment: e.target.value })}
                    placeholder="0.00"
                  />
                  <div className="form-hint">Total amount the engineer will be paid for this project</div>
                </div>
              ) : selectedProject.project_type === 'fixed_monthly' ? (
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Monthly Pay ($)</label>
                    <input
                      className="form-input"
                      type="number"
                      step="0.01"
                      value={assignForm.monthly_pay}
                      onChange={(e) => setAssignForm({ ...assignForm, monthly_pay: e.target.value })}
                      placeholder="0.00"
                    />
                    <div className="form-hint">Amount paid to engineer each month</div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Monthly Bill ($)</label>
                    <input
                      className="form-input"
                      type="number"
                      step="0.01"
                      value={assignForm.monthly_bill}
                      onChange={(e) => setAssignForm({ ...assignForm, monthly_bill: e.target.value })}
                      placeholder="0.00"
                    />
                    <div className="form-hint">Amount billed to customer each month</div>
                  </div>
                </div>
              ) : (
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Pay Rate ($/hr)</label>
                    <input
                      className="form-input"
                      type="number"
                      step="0.01"
                      value={assignForm.pay_rate}
                      onChange={(e) => setAssignForm({ ...assignForm, pay_rate: e.target.value })}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Bill Rate ($/hr)</label>
                    <input
                      className="form-input"
                      type="number"
                      step="0.01"
                      value={assignForm.bill_rate}
                      onChange={(e) => setAssignForm({ ...assignForm, bill_rate: e.target.value })}
                      placeholder="0.00"
                    />
                  </div>
                </div>
              )}
              <button className="btn btn-primary" type="submit" disabled={saving}>
                {saving ? 'Adding...' : 'Add to Project'}
              </button>
            </form>
          </div>
        </Modal>
      )}

      {emailPreview && (
        <Modal title="Email Preview" onClose={() => setEmailPreview(null)} width={640}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 4 }}><strong>To:</strong> {emailPreview.to}</div>
            <div style={{ fontSize: 13, color: '#64748b' }}><strong>Subject:</strong> {emailPreview.subject}</div>
          </div>
          <div
            style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 20, background: '#fff', maxHeight: 400, overflowY: 'auto' }}
            dangerouslySetInnerHTML={{ __html: emailPreview.html }}
          />
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="btn btn-secondary" onClick={() => setEmailPreview(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSendNotification}>Send Email</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
