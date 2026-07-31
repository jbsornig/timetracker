import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../api';
import Modal from '../components/Modal';

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const normalized = dateStr.includes('T') ? dateStr : dateStr.includes(' ') ? dateStr.replace(' ', 'T') : dateStr + 'T00:00:00';
  return new Date(normalized).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
}

const STATUS_COLORS = {
  draft: { bg: '#f1f5f9', color: '#475569' },
  issued: { bg: '#dbeafe', color: '#1d4ed8' },
  paid: { bg: '#dcfce7', color: '#166534' },
  cancelled: { bg: '#fee2e2', color: '#991b1b' },
};

const emptyVendor = { name: '', contact_name: '', email: '', phone: '', address: '', city_state_zip: '', payment_terms: 'Net 30', notes: '' };

const emptyLineItem = { description: '', quantity: 1, unit_price: 0 };

function VendorsTab() {
  const [vendors, setVendors] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(emptyVendor);
  const [editId, setEditId] = useState(null);

  const loadVendors = useCallback(async () => {
    const data = await apiFetch('/vendors');
    setVendors(data);
  }, []);

  useEffect(() => { loadVendors(); }, [loadVendors]);

  const handleSave = async () => {
    if (!form.name.trim()) return alert('Vendor name is required');
    if (editId) {
      await apiFetch(`/vendors/${editId}`, { method: 'PUT', body: form });
    } else {
      await apiFetch('/vendors', { method: 'POST', body: form });
    }
    setShowModal(false);
    setForm(emptyVendor);
    setEditId(null);
    loadVendors();
  };

  const handleEdit = (v) => {
    setForm({ name: v.name || '', contact_name: v.contact_name || '', email: v.email || '', phone: v.phone || '', address: v.address || '', city_state_zip: v.city_state_zip || '', payment_terms: v.payment_terms || 'Net 30', notes: v.notes || '' });
    setEditId(v.id);
    setShowModal(true);
  };

  const handleDelete = async (v) => {
    if (!window.confirm(`Delete vendor "${v.name}"?`)) return;
    try {
      await apiFetch(`/vendors/${v.id}`, { method: 'DELETE' });
      loadVendors();
    } catch (err) {
      alert(err.message || 'Cannot delete vendor with existing POs');
    }
  };

  const field = (label, key, type) => (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: '#334155' }}>{label}</label>
      {type === 'textarea' ? (
        <textarea value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} rows={3} style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, resize: 'vertical' }} />
      ) : (
        <input type={type || 'text'} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14 }} />
      )}
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 16, color: '#1e293b' }}>Vendors ({vendors.length})</h3>
        <button onClick={() => { setForm(emptyVendor); setEditId(null); setShowModal(true); }} style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>+ Add Vendor</button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
            <th style={{ padding: '10px 12px', textAlign: 'left' }}>Name</th>
            <th style={{ padding: '10px 12px', textAlign: 'left' }}>Contact</th>
            <th style={{ padding: '10px 12px', textAlign: 'left' }}>Email</th>
            <th style={{ padding: '10px 12px', textAlign: 'left' }}>Phone</th>
            <th style={{ padding: '10px 12px', textAlign: 'left' }}>Terms</th>
            <th style={{ padding: '10px 12px', textAlign: 'center' }}>Actions</th>
          </tr></thead>
          <tbody>
            {vendors.map(v => (
              <tr key={v.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                <td style={{ padding: '10px 12px', fontWeight: 600 }}>{v.name}</td>
                <td style={{ padding: '10px 12px' }}>{v.contact_name || '—'}</td>
                <td style={{ padding: '10px 12px' }}>{v.email || '—'}</td>
                <td style={{ padding: '10px 12px' }}>{v.phone || '—'}</td>
                <td style={{ padding: '10px 12px' }}>{v.payment_terms || '—'}</td>
                <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                  <button onClick={() => handleEdit(v)} style={{ padding: '4px 10px', background: '#f1f5f9', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', fontSize: 12, marginRight: 4 }}>Edit</button>
                  <button onClick={() => handleDelete(v)} style={{ padding: '4px 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 4, cursor: 'pointer', fontSize: 12, color: '#991b1b' }}>Delete</button>
                </td>
              </tr>
            ))}
            {vendors.length === 0 && <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>No vendors yet. Add one to get started.</td></tr>}
          </tbody>
        </table>
      </div>

      {showModal && (
        <Modal title={editId ? 'Edit Vendor' : 'Add Vendor'} onClose={() => setShowModal(false)}>
          <div style={{ maxWidth: 480 }}>
            {field('Company Name *', 'name')}
            {field('Contact Name', 'contact_name')}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {field('Email', 'email', 'email')}
              {field('Phone', 'phone', 'tel')}
            </div>
            {field('Address', 'address')}
            {field('City, State, Zip', 'city_state_zip')}
            {field('Payment Terms', 'payment_terms')}
            {field('Notes', 'notes', 'textarea')}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={() => setShowModal(false)} style={{ padding: '8px 16px', background: '#f1f5f9', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>Cancel</button>
              <button onClick={handleSave} style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Save</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function POPrintView({ poId, onClose }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    apiFetch(`/purchase-orders/${poId}`).then(setData);
  }, [poId]);

  if (!data) return null;
  const { po, settings } = data;

  return (
    <Modal title={`Purchase Order ${po.po_number}`} onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }} className="no-print">
        <button onClick={() => window.print()} style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Print PO</button>
      </div>
      <POContent po={po} settings={settings} />
    </Modal>
  );
}

function POContent({ po, settings }) {
  const lineItems = po.line_items || [];
  const subtotal = lineItems.reduce((s, i) => s + (i.amount || 0), 0);

  return (
    <>
      <style>{`
        @media print {
          .po-print-wrap { max-width: 100% !important; padding: 0 !important; margin: 0 !important; font-size: 10pt !important; }
          .po-print-wrap * { font-size: inherit; }
          .po-print-wrap .po-header-title { font-size: 14pt !important; }
          .po-print-wrap .po-title { font-size: 18pt !important; }
          .po-print-wrap .po-vendor-name { font-size: 11pt !important; }
          .po-print-wrap table th, .po-print-wrap table td { padding: 4px 6px !important; border: 1px solid #ccc !important; }
          .po-print-wrap .po-section-box { padding: 8px 10px !important; }
          .modal-overlay, .modal { overflow: visible !important; max-height: none !important; }
          .modal { box-shadow: none !important; border: none !important; max-width: 100% !important; width: 100% !important; padding: 0 !important; }
        }
      `}</style>
      <div className="po-print-wrap" style={{ maxWidth: 800, margin: '0 auto', fontFamily: 'Arial, sans-serif', fontSize: 11 }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            {settings.company_logo && (
              <img src={settings.company_logo} alt="Logo" style={{ height: 48, objectFit: 'contain' }} />
            )}
            <div>
              <div className="po-header-title" style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>{settings.company_name || 'Company Name'}</div>
              <div style={{ fontSize: 10, color: '#64748b', lineHeight: 1.4 }}>
                {settings.company_address && <div>{settings.company_address}</div>}
                {settings.company_city_state_zip && <div>{settings.company_city_state_zip}</div>}
                {settings.company_phone && <div>Phone: {settings.company_phone}</div>}
                {settings.company_fax && <div>Fax: {settings.company_fax}</div>}
                {settings.company_email && <div>{settings.company_email}</div>}
              </div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="po-title" style={{ fontSize: 20, fontWeight: 700, color: '#2563eb', marginBottom: 4 }}>PURCHASE ORDER</div>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{po.po_number}</div>
            <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>Date: {formatDate(po.issue_date)}</div>
            {po.due_date && <div style={{ fontSize: 10, color: '#64748b' }}>Due: {formatDate(po.due_date)}</div>}
            {po.vendor_quote_number && <div style={{ fontSize: 10, color: '#64748b' }}>Vendor Quote: {po.vendor_quote_number}</div>}
          </div>
        </div>

        {/* Vendor / Ship To */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div className="po-section-box" style={{ background: '#f8fafc', padding: 10, borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 10 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>Vendor</div>
            <div className="po-vendor-name" style={{ fontWeight: 600, fontSize: 12 }}>{po.vendor_name}</div>
            {po.vendor_contact && <div>{po.vendor_contact}</div>}
            {po.vendor_address && <div>{po.vendor_address}</div>}
            {po.vendor_city_state_zip && <div>{po.vendor_city_state_zip}</div>}
            {po.vendor_email && <div>{po.vendor_email}</div>}
            {po.vendor_phone && <div>{po.vendor_phone}</div>}
          </div>
          <div className="po-section-box" style={{ background: '#f8fafc', padding: 10, borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 10 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>Ship To</div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{po.ship_to || `${settings.company_name || ''}\n${settings.company_address || ''}\n${settings.company_city_state_zip || ''}`}</div>
          </div>
        </div>

        {/* Line Items */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
          <thead>
            <tr style={{ background: '#1e293b', color: '#fff' }}>
              <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10 }}>#</th>
              <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10 }}>Description</th>
              <th style={{ padding: '6px 8px', textAlign: 'right', fontSize: 10 }}>Qty</th>
              <th style={{ padding: '6px 8px', textAlign: 'right', fontSize: 10 }}>Unit Price</th>
              <th style={{ padding: '6px 8px', textAlign: 'right', fontSize: 10 }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {lineItems.map((item, i) => (
              <tr key={item.id || i} style={{ borderBottom: '1px solid #e2e8f0' }}>
                <td style={{ padding: '6px 8px' }}>{i + 1}</td>
                <td style={{ padding: '6px 8px' }}>{item.description}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{item.quantity}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{formatCurrency(item.unit_price)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{formatCurrency(item.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
          <div style={{ minWidth: 180 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 10, borderBottom: '1px solid #e2e8f0' }}>
              <span>Subtotal:</span><span>{formatCurrency(subtotal)}</span>
            </div>
            {po.tax_amount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 10, borderBottom: '1px solid #e2e8f0' }}>
                <span>Tax:</span><span>{formatCurrency(po.tax_amount)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontWeight: 700, fontSize: 12, borderTop: '2px solid #1e293b' }}>
              <span>Total:</span><span>{formatCurrency(po.total_amount)}</span>
            </div>
          </div>
        </div>

        {/* Terms & Notes */}
        {(po.terms || po.vendor_payment_terms) && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 2 }}>Terms & Conditions</div>
            <div style={{ fontSize: 10, whiteSpace: 'pre-wrap', color: '#475569' }}>{po.terms || `Payment Terms: ${po.vendor_payment_terms}`}</div>
          </div>
        )}
        {po.notes && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 2 }}>Notes</div>
            <div style={{ fontSize: 10, whiteSpace: 'pre-wrap', color: '#475569' }}>{po.notes}</div>
          </div>
        )}

        {/* Acknowledgment */}
        <div style={{ marginTop: 20, padding: '8px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 10, color: '#475569', textAlign: 'center' }}>
          Please confirm acceptance of this Purchase Order by sending an email to <strong>{settings.company_email || 'us'}</strong> referencing PO # <strong>{po.po_number}</strong>.
        </div>
      </div>
    </>
  );
}

function POFormModal({ editPO, vendors, projects, onClose, onSaved }) {
  const isEdit = !!editPO;
  const [form, setForm] = useState({
    vendor_id: '',
    project_id: '',
    po_number: '',
    vendor_quote_number: '',
    status: 'draft',
    issue_date: new Date().toISOString().split('T')[0],
    due_date: '',
    ship_to: '',
    notes: '',
    terms: '',
  });
  const [lineItems, setLineItems] = useState([{ ...emptyLineItem }]);

  useEffect(() => {
    if (editPO) {
      setForm({
        vendor_id: editPO.vendor_id || '',
        project_id: editPO.project_id || '',
        po_number: editPO.po_number || '',
        vendor_quote_number: editPO.vendor_quote_number || '',
        status: editPO.status || 'draft',
        issue_date: editPO.issue_date || '',
        due_date: editPO.due_date || '',
        ship_to: editPO.ship_to || '',
        notes: editPO.notes || '',
        terms: editPO.terms || '',
      });
      setLineItems(editPO.line_items?.length ? editPO.line_items.map(i => ({ description: i.description, quantity: i.quantity, unit_price: i.unit_price })) : [{ ...emptyLineItem }]);
    }
  }, [editPO]);

  const updateLineItem = (idx, field, value) => {
    setLineItems(lineItems.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  };

  const addLineItem = () => setLineItems([...lineItems, { ...emptyLineItem }]);

  const removeLineItem = (idx) => {
    if (lineItems.length === 1) return;
    setLineItems(lineItems.filter((_, i) => i !== idx));
  };

  const calcTotal = () => lineItems.reduce((s, i) => s + ((i.quantity || 0) * (i.unit_price || 0)), 0);

  const handleSave = async () => {
    if (!form.vendor_id) return alert('Please select a vendor');
    if (lineItems.every(i => !i.description.trim())) return alert('Please add at least one line item');

    const body = {
      ...form,
      line_items: lineItems.filter(i => i.description.trim()),
    };

    if (isEdit) {
      await apiFetch(`/purchase-orders/${editPO.id}`, { method: 'PUT', body });
    } else {
      await apiFetch('/purchase-orders', { method: 'POST', body });
    }
    onSaved();
  };

  const inputStyle = { width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14 };

  return (
    <Modal title={isEdit ? `Edit PO ${form.po_number}` : 'Create Purchase Order'} onClose={onClose}>
      <div style={{ maxWidth: 700 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: '#334155' }}>Vendor *</label>
            <select value={form.vendor_id} onChange={e => setForm({ ...form, vendor_id: e.target.value })} style={inputStyle}>
              <option value="">Select vendor...</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: '#334155' }}>Project (optional)</label>
            <select value={form.project_id} onChange={e => setForm({ ...form, project_id: e.target.value })} style={inputStyle}>
              <option value="">None</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: '#334155' }}>PO Number</label>
            <input type="text" value={form.po_number} onChange={e => setForm({ ...form, po_number: e.target.value })} placeholder="Auto-generated" style={inputStyle} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: '#334155' }}>Vendor Quote</label>
            <input type="text" value={form.vendor_quote_number} onChange={e => setForm({ ...form, vendor_quote_number: e.target.value })} style={inputStyle} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: '#334155' }}>Issue Date</label>
            <input type="date" value={form.issue_date} onChange={e => setForm({ ...form, issue_date: e.target.value })} style={inputStyle} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: '#334155' }}>Due Date</label>
            <input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} style={inputStyle} />
          </div>
        </div>

        {isEdit && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: '#334155' }}>Status</label>
            <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} style={{ ...inputStyle, width: 200 }}>
              <option value="draft">Draft</option>
              <option value="issued">Issued</option>
              <option value="paid">Paid</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        )}

        {/* Line Items */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>Line Items</label>
            <button onClick={addLineItem} style={{ padding: '4px 12px', background: '#f1f5f9', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>+ Add Line</button>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
              <th style={{ padding: '8px', textAlign: 'left' }}>Description</th>
              <th style={{ padding: '8px', textAlign: 'right', width: 80 }}>Qty</th>
              <th style={{ padding: '8px', textAlign: 'right', width: 110 }}>Unit Price</th>
              <th style={{ padding: '8px', textAlign: 'right', width: 100 }}>Amount</th>
              <th style={{ width: 40 }}></th>
            </tr></thead>
            <tbody>
              {lineItems.map((item, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <td style={{ padding: '4px 8px' }}><input type="text" value={item.description} onChange={e => updateLineItem(i, 'description', e.target.value)} placeholder="Item description" style={{ ...inputStyle, padding: '6px 8px' }} /></td>
                  <td style={{ padding: '4px 8px' }}><input type="number" value={item.quantity} onChange={e => updateLineItem(i, 'quantity', parseFloat(e.target.value) || 0)} min="0" step="1" style={{ ...inputStyle, padding: '6px 8px', textAlign: 'right' }} /></td>
                  <td style={{ padding: '4px 8px' }}><input type="number" value={item.unit_price} onChange={e => updateLineItem(i, 'unit_price', parseFloat(e.target.value) || 0)} min="0" step="0.01" style={{ ...inputStyle, padding: '6px 8px', textAlign: 'right' }} /></td>
                  <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 600 }}>{formatCurrency((item.quantity || 0) * (item.unit_price || 0))}</td>
                  <td style={{ padding: '4px' }}>{lineItems.length > 1 && <button onClick={() => removeLineItem(i)} style={{ padding: '2px 6px', background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 16 }}>x</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ textAlign: 'right', fontWeight: 700, fontSize: 15, marginTop: 8, paddingRight: 48 }}>Total: {formatCurrency(calcTotal())}</div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: '#334155' }}>Ship To</label>
          <textarea value={form.ship_to} onChange={e => setForm({ ...form, ship_to: e.target.value })} rows={3} placeholder="Leave blank to use company address" style={{ ...inputStyle, resize: 'vertical' }} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: '#334155' }}>Terms</label>
            <textarea value={form.terms} onChange={e => setForm({ ...form, terms: e.target.value })} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: '#334155' }}>Notes</label>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', background: '#f1f5f9', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>Cancel</button>
          <button onClick={handleSave} style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>{isEdit ? 'Update PO' : 'Create PO'}</button>
        </div>
      </div>
    </Modal>
  );
}

function PaymentModal({ po, onClose, onSaved }) {
  const [form, setForm] = useState({ amount: '', payment_date: new Date().toISOString().split('T')[0], payment_method: '', reference_number: '', notes: '' });

  const handleSave = async () => {
    if (!form.amount || parseFloat(form.amount) <= 0) return alert('Enter a valid amount');
    await apiFetch(`/purchase-orders/${po.id}/payments`, { method: 'POST', body: form });
    onSaved();
  };

  const inputStyle = { width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14 };
  const remaining = (po.total_amount || 0) - (po.amount_paid || 0);

  return (
    <Modal title={`Record Payment — ${po.po_number}`} onClose={onClose}>
      <div style={{ maxWidth: 400 }}>
        <div style={{ background: '#f8fafc', padding: 12, borderRadius: 6, marginBottom: 16, fontSize: 13 }}>
          <div>Total: {formatCurrency(po.total_amount)} | Paid: {formatCurrency(po.amount_paid)} | <strong>Remaining: {formatCurrency(remaining)}</strong></div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Amount *</label>
          <input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} step="0.01" min="0" style={inputStyle} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Payment Date *</label>
          <input type="date" value={form.payment_date} onChange={e => setForm({ ...form, payment_date: e.target.value })} style={inputStyle} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Method</label>
            <select value={form.payment_method} onChange={e => setForm({ ...form, payment_method: e.target.value })} style={inputStyle}>
              <option value="">—</option>
              <option value="check">Check</option>
              <option value="ach">ACH</option>
              <option value="wire">Wire Transfer</option>
              <option value="credit_card">Credit Card</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Reference #</label>
            <input type="text" value={form.reference_number} onChange={e => setForm({ ...form, reference_number: e.target.value })} style={inputStyle} />
          </div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Notes</label>
          <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', background: '#f1f5f9', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>Cancel</button>
          <button onClick={handleSave} style={{ padding: '8px 16px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Record Payment</button>
        </div>
      </div>
    </Modal>
  );
}

function PurchaseOrdersTab() {
  const [pos, setPOs] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [projects, setProjects] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editPO, setEditPO] = useState(null);
  const [printPOId, setPrintPOId] = useState(null);
  const [paymentPO, setPaymentPO] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [emailingId, setEmailingId] = useState(null);

  const loadData = useCallback(async () => {
    const [posData, vendorsData, projectsData] = await Promise.all([
      apiFetch('/purchase-orders'),
      apiFetch('/vendors'),
      apiFetch('/projects'),
    ]);
    setPOs(posData);
    setVendors(vendorsData);
    setProjects(projectsData);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleDelete = async (po) => {
    if (!window.confirm(`Delete PO ${po.po_number}? This cannot be undone.`)) return;
    await apiFetch(`/purchase-orders/${po.id}`, { method: 'DELETE' });
    loadData();
  };

  const handleEmail = async (po) => {
    setEmailingId(po.id);
    try {
      const result = await apiFetch(`/purchase-orders/${po.id}/email`, { method: 'POST' });
      alert(result.message);
    } catch (err) {
      alert(err.message || 'Failed to send email');
    } finally {
      setEmailingId(null);
    }
  };

  const filtered = filterStatus === 'all' ? pos : pos.filter(p => p.status === filterStatus);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 16, color: '#1e293b' }}>Purchase Orders ({filtered.length})</h3>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 12 }}>
            <option value="all">All</option>
            <option value="draft">Draft</option>
            <option value="issued">Issued</option>
            <option value="paid">Paid</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <button onClick={() => { setEditPO(null); setShowForm(true); }} style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>+ Create PO</button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
            <th style={{ padding: '10px 12px', textAlign: 'left' }}>PO #</th>
            <th style={{ padding: '10px 12px', textAlign: 'left' }}>Vendor</th>
            <th style={{ padding: '10px 12px', textAlign: 'left' }}>Project</th>
            <th style={{ padding: '10px 12px', textAlign: 'center' }}>Status</th>
            <th style={{ padding: '10px 12px', textAlign: 'left' }}>Date</th>
            <th style={{ padding: '10px 12px', textAlign: 'right' }}>Total</th>
            <th style={{ padding: '10px 12px', textAlign: 'right' }}>Paid</th>
            <th style={{ padding: '10px 12px', textAlign: 'center' }}>Actions</th>
          </tr></thead>
          <tbody>
            {filtered.map(po => {
              const sc = STATUS_COLORS[po.status] || STATUS_COLORS.draft;
              return (
                <tr key={po.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 600 }}>{po.po_number}</td>
                  <td style={{ padding: '10px 12px' }}>{po.vendor_name}</td>
                  <td style={{ padding: '10px 12px' }}>{po.project_name || '—'}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                    <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: sc.bg, color: sc.color }}>{po.status}</span>
                  </td>
                  <td style={{ padding: '10px 12px' }}>{formatDate(po.issue_date)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>{formatCurrency(po.total_amount)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>{formatCurrency(po.amount_paid)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                    <button onClick={() => setPrintPOId(po.id)} style={{ padding: '4px 8px', background: '#f1f5f9', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', fontSize: 11, marginRight: 4 }} title="View/Print">View</button>
                    <button onClick={() => handleEmail(po)} disabled={emailingId === po.id} style={{ padding: '4px 8px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 4, cursor: 'pointer', fontSize: 11, color: '#1d4ed8', marginRight: 4 }}>{emailingId === po.id ? 'Sending...' : 'Email'}</button>
                    <button onClick={() => { setEditPO(po); setShowForm(true); }} style={{ padding: '4px 8px', background: '#f1f5f9', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', fontSize: 11, marginRight: 4 }}>Edit</button>
                    <button onClick={() => setPaymentPO(po)} style={{ padding: '4px 8px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 4, cursor: 'pointer', fontSize: 11, color: '#166534', marginRight: 4 }}>Pay</button>
                    <button onClick={() => handleDelete(po)} style={{ padding: '4px 8px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 4, cursor: 'pointer', fontSize: 11, color: '#991b1b' }}>Del</button>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>No purchase orders found.</td></tr>}
          </tbody>
        </table>
      </div>

      {showForm && (
        <POFormModal
          editPO={editPO}
          vendors={vendors}
          projects={projects}
          onClose={() => { setShowForm(false); setEditPO(null); }}
          onSaved={() => { setShowForm(false); setEditPO(null); loadData(); }}
        />
      )}
      {printPOId && <POPrintView poId={printPOId} onClose={() => setPrintPOId(null)} />}
      {paymentPO && <PaymentModal po={paymentPO} onClose={() => setPaymentPO(null)} onSaved={() => { setPaymentPO(null); loadData(); }} />}
    </div>
  );
}

export default function PurchaseOrders() {
  const [activeTab, setActiveTab] = useState('orders');

  const tabStyle = (active) => ({
    padding: '8px 20px',
    background: active ? '#2563eb' : '#f1f5f9',
    color: active ? '#fff' : '#475569',
    border: active ? '1px solid #2563eb' : '1px solid #d1d5db',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: active ? 600 : 400,
  });

  return (
    <div style={{ padding: '24px 32px' }}>
      <h2 style={{ margin: '0 0 16px', fontSize: 20, color: '#1e293b' }}>Purchase Orders</h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button style={tabStyle(activeTab === 'orders')} onClick={() => setActiveTab('orders')}>Purchase Orders</button>
        <button style={tabStyle(activeTab === 'vendors')} onClick={() => setActiveTab('vendors')}>Vendors</button>
      </div>
      {activeTab === 'orders' && <PurchaseOrdersTab />}
      {activeTab === 'vendors' && <VendorsTab />}
    </div>
  );
}
