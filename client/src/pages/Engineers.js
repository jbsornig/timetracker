import React, { useState, useEffect } from 'react';
import { apiFetch } from '../api';
import Modal from '../components/Modal';

const emptyEngineer = { name: '', email: '', password: '', engineer_id: '' };

export default function Engineers() {
  const [engineers, setEngineers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyEngineer);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedEngineer, setSelectedEngineer] = useState(null);
  const [engineerProjects, setEngineerProjects] = useState([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [users, projs] = await Promise.all([
        apiFetch('/users'),
        apiFetch('/projects'),
      ]);
      setEngineers(users.filter((u) => u.role === 'engineer'));
      setProjects(projs);
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

  const openAdd = () => {
    setForm(emptyEngineer);
    setError('');
    setModal('add');
  };

  const openEdit = (engineer) => {
    setForm({
      ...engineer,
      password: '',
    });
    setError('');
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
        role: 'engineer',
        engineer_id: form.engineer_id || null,
      };
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
          <div className="page-title">Engineers</div>
          <div className="page-subtitle">Manage engineer accounts and assignments</div>
        </div>
        <button className="btn btn-primary" onClick={openAdd}>+ Add Engineer</button>
      </div>

      <div className="card">
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
                  <th>Projects</th>
                  <th style={{ width: 180 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {engineers.map((eng) => (
                  <tr key={eng.id}>
                    <td><strong>{eng.name}</strong></td>
                    <td>{eng.email}</td>
                    <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 13 }}>{eng.engineer_id || '—'}</td>
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
          title={modal === 'add' ? 'Add Engineer' : 'Edit Engineer'}
          onClose={() => setModal(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
                {saving ? 'Saving...' : modal === 'add' ? 'Add Engineer' : 'Save Changes'}
              </button>
            </>
          }
        >
          <form onSubmit={handleSubmit}>
            {error && <div className="alert alert-error">{error}</div>}
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
            <div className="form-row">
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
            </div>
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
