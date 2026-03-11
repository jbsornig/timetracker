import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../api';
import Modal from '../components/Modal';

const emptyProject = { customer_id: '', contact_id: '', name: '', description: '', po_number: '', po_amount: '', location: '', status: 'active', include_timesheets: true, project_type: 'hourly', total_cost: '', requires_daily_logs: true };

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
  const [assignForm, setAssignForm] = useState({ user_id: '', pay_rate: '', bill_rate: '', total_payment: '' });
  const [customerFilter, setCustomerFilter] = useState('');
  const [engineerFilter, setEngineerFilter] = useState('');
  const [engineerAssignments, setEngineerAssignments] = useState([]);

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
    if (isFixedPrice) {
      if (!assignForm.user_id || !assignForm.total_payment) {
        setError('Engineer and total payment are required');
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
          pay_rate: isFixedPrice ? 0 : parseFloat(assignForm.pay_rate),
          bill_rate: isFixedPrice ? 0 : parseFloat(assignForm.bill_rate),
          total_payment: isFixedPrice ? parseFloat(assignForm.total_payment) : 0,
        },
      });
      const engs = await apiFetch(`/projects/${selectedProject.id}/engineers`);
      setProjectEngineers(engs);
      setAssignForm({ user_id: '', pay_rate: '', bill_rate: '', total_payment: '' });
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
          <span style={{ fontSize: 13, color: '#94a3b8' }}>
            Showing {projects.filter(p => (!customerFilter || String(p.customer_id) === customerFilter) && (!engineerFilter || engineerAssignments.some(ea => ea.project_id === p.id && String(ea.user_id) === engineerFilter))).length} of {projects.length} projects
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
                  <th>Project</th>
                  <th>Type</th>
                  <th>Customer</th>
                  <th>Contact</th>
                  <th>PO #</th>
                  <th>Budget</th>
                  <th>Billed</th>
                  <th>Remaining</th>
                  <th>Progress</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th style={{ width: 180 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {projects.filter(p => (!customerFilter || String(p.customer_id) === customerFilter) && (!engineerFilter || engineerAssignments.some(ea => ea.project_id === p.id && String(ea.user_id) === engineerFilter))).map((p) => {
                  const isFixedPrice = p.project_type === 'fixed_price';
                  const budget = isFixedPrice ? (p.total_cost || 0) : (p.po_amount || 0);
                  const billed = p.amount_billed || 0;
                  const remaining = budget - billed;
                  const pct = budget > 0 ? (billed / budget) * 100 : 0;
                  const cls = pct >= 90 ? 'progress-danger' : pct >= 70 ? 'progress-warn' : 'progress-good';
                  return (
                    <tr key={p.id}>
                      <td><strong>{p.name}</strong><br /><span style={{ fontSize: 12, color: '#94a3b8' }}>{p.location || ''}</span></td>
                      <td>
                        <span className={`badge ${isFixedPrice ? 'badge-fixed' : 'badge-hourly'}`} style={{ fontSize: 11 }}>
                          {isFixedPrice ? 'Fixed' : 'Hourly'}
                        </span>
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
            {form.project_type === 'hourly' && (
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
            </div>
            {projectEngineers.length === 0 ? (
              <p style={{ color: '#94a3b8', fontSize: 14 }}>No engineers assigned yet.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Engineer</th>
                      {selectedProject.project_type === 'fixed_price' ? (
                        <th>Total Payment</th>
                      ) : (
                        <>
                          <th>Pay Rate</th>
                          <th>Bill Rate</th>
                        </>
                      )}
                      <th style={{ width: 80 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projectEngineers.map((eng) => (
                      <tr key={eng.user_id}>
                        <td><strong>{eng.name}</strong><br /><span style={{ fontSize: 12, color: '#94a3b8' }}>{eng.engineer_id || eng.email}</span></td>
                        {selectedProject.project_type === 'fixed_price' ? (
                          <td>${(eng.total_payment || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        ) : (
                          <>
                            <td>${eng.pay_rate?.toFixed(2) || '0.00'}/hr</td>
                            <td>${eng.bill_rate?.toFixed(2) || '0.00'}/hr</td>
                          </>
                        )}
                        <td>
                          <button className="btn btn-danger btn-sm" onClick={() => handleUnassignEngineer(eng.user_id)}>Remove</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
    </div>
  );
}
