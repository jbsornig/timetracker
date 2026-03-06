import React, { useState, useEffect } from 'react';
import { apiFetch } from '../api';
import Modal from '../components/Modal';

const emptyCustomer = { name: '', contact: '', contact_title: '', email: '', phone: '', address: '', supplier_number: '', payment_terms: 'Net 30' };
const PAYMENT_TERMS_OPTIONS = ['Immediate', 'Net 15', 'Net 30', 'Net 45', 'Net 60', 'Net 75', 'Net 90'];
const emptyContact = { name: '', title: '', email: '', phone: '' };

export default function Customers() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyCustomer);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [contactForm, setContactForm] = useState(emptyContact);
  const [editingContact, setEditingContact] = useState(null);

  useEffect(() => {
    loadCustomers();
  }, []);

  const loadCustomers = async () => {
    try {
      const data = await apiFetch('/customers');
      setCustomers(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const openAdd = () => {
    setForm(emptyCustomer);
    setError('');
    setModal('add');
  };

  const openEdit = (customer) => {
    setForm({ ...customer });
    setError('');
    setModal('edit');
  };

  const openContacts = async (customer) => {
    setSelectedCustomer(customer);
    setContactForm(emptyContact);
    setEditingContact(null);
    setError('');
    try {
      const data = await apiFetch(`/customers/${customer.id}/contacts`);
      setContacts(data);
    } catch (e) {
      setContacts([]);
    }
    setModal('contacts');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Name is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (modal === 'add') {
        await apiFetch('/customers', { method: 'POST', body: form });
      } else {
        await apiFetch(`/customers/${form.id}`, { method: 'PUT', body: form });
      }
      await loadCustomers();
      setModal(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this customer?')) return;
    try {
      await apiFetch(`/customers/${id}`, { method: 'DELETE' });
      await loadCustomers();
    } catch (e) {
      alert('Cannot delete: ' + e.message);
    }
  };

  const handleAddContact = async (e) => {
    e.preventDefault();
    if (!contactForm.name.trim()) {
      setError('Contact name is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (editingContact) {
        await apiFetch(`/customers/${selectedCustomer.id}/contacts/${editingContact.id}`, {
          method: 'PUT',
          body: contactForm,
        });
      } else {
        await apiFetch(`/customers/${selectedCustomer.id}/contacts`, {
          method: 'POST',
          body: contactForm,
        });
      }
      const data = await apiFetch(`/customers/${selectedCustomer.id}/contacts`);
      setContacts(data);
      setContactForm(emptyContact);
      setEditingContact(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleEditContact = (contact) => {
    setContactForm({ ...contact });
    setEditingContact(contact);
  };

  const handleCancelEditContact = () => {
    setContactForm(emptyContact);
    setEditingContact(null);
  };

  const handleDeleteContact = async (contactId) => {
    if (!window.confirm('Delete this contact?')) return;
    try {
      await apiFetch(`/customers/${selectedCustomer.id}/contacts/${contactId}`, { method: 'DELETE' });
      const data = await apiFetch(`/customers/${selectedCustomer.id}/contacts`);
      setContacts(data);
    } catch (e) {
      alert('Error: ' + e.message);
    }
  };

  if (loading) return <div style={{ padding: 40, color: '#94a3b8' }}>Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Customers</div>
          <div className="page-subtitle">Manage your customer accounts</div>
        </div>
        <button className="btn btn-primary" onClick={openAdd}>+ Add Customer</button>
      </div>

      <div className="card">
        {customers.length === 0 ? (
          <div className="empty-state">
            <h3>No customers yet</h3>
            <p>Add your first customer to get started.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Supplier #</th>
                  <th>Payment Terms</th>
                  <th>Contact</th>
                  <th>Email</th>
                  <th style={{ width: 180 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.name}</strong>
                      {c.address && <><br /><span style={{ fontSize: 12, color: '#94a3b8' }}>{c.address}</span></>}
                    </td>
                    <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 13 }}>{c.supplier_number || '—'}</td>
                    <td>{c.payment_terms || 'Net 30'}</td>
                    <td>{c.contact || '—'}</td>
                    <td>{c.email || '—'}</td>
                    <td>
                      <button className="btn btn-secondary btn-sm" onClick={() => openContacts(c)} style={{ marginRight: 4 }}>Contacts</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => openEdit(c)} style={{ marginRight: 4 }}>Edit</button>
                      <button className="btn btn-danger btn-sm" onClick={() => handleDelete(c.id)}>Delete</button>
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
          title={modal === 'add' ? 'Add Customer' : 'Edit Customer'}
          onClose={() => setModal(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
                {saving ? 'Saving...' : modal === 'add' ? 'Add Customer' : 'Save Changes'}
              </button>
            </>
          }
        >
          <form onSubmit={handleSubmit}>
            {error && <div className="alert alert-error">{error}</div>}
            <div className="form-group">
              <label className="form-label">Company Name *</label>
              <input
                className="form-input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Enter company name"
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Supplier Number</label>
                <input
                  className="form-input"
                  value={form.supplier_number}
                  onChange={(e) => setForm({ ...form, supplier_number: e.target.value })}
                  placeholder="Your supplier ID with this customer"
                />
                <div className="form-hint">The ID this customer uses for your company</div>
              </div>
              <div className="form-group">
                <label className="form-label">Payment Terms</label>
                {PAYMENT_TERMS_OPTIONS.includes(form.payment_terms) || !form.payment_terms ? (
                  <select
                    className="form-select"
                    value={form.payment_terms || 'Net 30'}
                    onChange={(e) => {
                      if (e.target.value === '__custom__') {
                        setForm({ ...form, payment_terms: '' });
                      } else {
                        setForm({ ...form, payment_terms: e.target.value });
                      }
                    }}
                  >
                    {PAYMENT_TERMS_OPTIONS.map((term) => (
                      <option key={term} value={term}>{term}</option>
                    ))}
                    <option value="__custom__">Other (custom)...</option>
                  </select>
                ) : (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      className="form-input"
                      value={form.payment_terms}
                      onChange={(e) => setForm({ ...form, payment_terms: e.target.value })}
                      placeholder="e.g., 2/10 Net 30"
                    />
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setForm({ ...form, payment_terms: 'Net 30' })}
                      style={{ whiteSpace: 'nowrap' }}
                    >
                      Preset
                    </button>
                  </div>
                )}
                <div className="form-hint">When payment is due after invoice date</div>
              </div>
            </div>
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: '#64748b' }}>Primary Contact</div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Contact Name</label>
                  <input
                    className="form-input"
                    value={form.contact}
                    onChange={(e) => setForm({ ...form, contact: e.target.value })}
                    placeholder="Primary contact name"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Title</label>
                  <input
                    className="form-input"
                    value={form.contact_title}
                    onChange={(e) => setForm({ ...form, contact_title: e.target.value })}
                    placeholder="Job title"
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input
                    className="form-input"
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="contact@company.com"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Phone</label>
                  <input
                    className="form-input"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="(555) 123-4567"
                  />
                </div>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Address</label>
              <input
                className="form-input"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="123 Main St, City, State ZIP"
              />
            </div>
          </form>
        </Modal>
      )}

      {modal === 'contacts' && selectedCustomer && (
        <Modal
          title={`Contacts - ${selectedCustomer.name}`}
          onClose={() => setModal(null)}
          footer={<button className="btn btn-secondary" onClick={() => setModal(null)}>Close</button>}
        >
          {error && <div className="alert alert-error">{error}</div>}

          <div style={{ marginBottom: 20 }}>
            <div className="card-title" style={{ fontSize: 14 }}>Contact List</div>
            {contacts.length === 0 ? (
              <p style={{ color: '#94a3b8', fontSize: 14 }}>No contacts added yet.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Title</th>
                      <th>Email</th>
                      <th style={{ width: 100 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contacts.map((contact) => (
                      <tr key={contact.id}>
                        <td><strong>{contact.name}</strong></td>
                        <td>{contact.title || '—'}</td>
                        <td>{contact.email || '—'}</td>
                        <td>
                          <button className="btn btn-secondary btn-sm" onClick={() => handleEditContact(contact)} style={{ marginRight: 4 }}>Edit</button>
                          <button className="btn btn-danger btn-sm" onClick={() => handleDeleteContact(contact.id)}>Del</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <div className="card-title" style={{ fontSize: 14 }}>
              {editingContact ? 'Edit Contact' : 'Add Contact'}
            </div>
            <form onSubmit={handleAddContact}>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Name *</label>
                  <input
                    className="form-input"
                    value={contactForm.name}
                    onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                    placeholder="Contact name"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Title</label>
                  <input
                    className="form-input"
                    value={contactForm.title}
                    onChange={(e) => setContactForm({ ...contactForm, title: e.target.value })}
                    placeholder="Job title"
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input
                    className="form-input"
                    type="email"
                    value={contactForm.email}
                    onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                    placeholder="email@company.com"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Phone</label>
                  <input
                    className="form-input"
                    value={contactForm.phone}
                    onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })}
                    placeholder="(555) 123-4567"
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" type="submit" disabled={saving}>
                  {saving ? 'Saving...' : editingContact ? 'Update Contact' : 'Add Contact'}
                </button>
                {editingContact && (
                  <button className="btn btn-secondary" type="button" onClick={handleCancelEditContact}>
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </div>
        </Modal>
      )}
    </div>
  );
}
