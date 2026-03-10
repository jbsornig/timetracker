import React, { useState, useEffect } from 'react';
import { apiFetch } from '../api';
import Modal from '../components/Modal';

function formatDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount || 0);
}

function getDefaultDates() {
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - 1);
  return {
    period_start: start.toISOString().split('T')[0],
    period_end: end.toISOString().split('T')[0],
  };
}

function getDueDate(invoiceDate, paymentTerms = 'Net 30') {
  const d = new Date(invoiceDate);

  // Parse payment terms to get number of days
  let days = 30; // default
  if (paymentTerms === 'Immediate') {
    days = 0;
  } else {
    const match = paymentTerms?.match(/Net\s*(\d+)/i);
    if (match) {
      days = parseInt(match[1], 10);
    }
  }

  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
}

const emptyPayment = { amount: '', payment_date: new Date().toISOString().split('T')[0], payment_method: '', reference_number: '', notes: '' };
const PAYMENT_METHODS = ['Check', 'ACH/Wire', 'Credit Card', 'Cash', 'Other'];

export default function Invoices() {
  const [invoices, setInvoices] = useState([]);
  const [projects, setProjects] = useState([]);
  const [balances, setBalances] = useState({ total_outstanding: 0, by_customer: [], by_project: [] });
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [generateForm, setGenerateForm] = useState({ project_id: '', ...getDefaultDates(), notes: '' });
  const [viewingInvoice, setViewingInvoice] = useState(null);
  const [paymentForm, setPaymentForm] = useState(emptyPayment);
  const [payments, setPayments] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState('active');
  const [customerFilter, setCustomerFilter] = useState('');
  const [engineerFilter, setEngineerFilter] = useState('');
  const [engineers, setEngineers] = useState([]);
  const [engineerAssignments, setEngineerAssignments] = useState([]);
  const [sortField, setSortField] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');
  const [emailingId, setEmailingId] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [inv, proj, bal, users, ep] = await Promise.all([
        apiFetch('/invoices'),
        apiFetch('/projects'),
        apiFetch('/balances'),
        apiFetch('/users'),
        apiFetch('/engineer-projects'),
      ]);
      setInvoices(inv);
      setProjects(proj);
      setBalances(bal);
      setEngineers(users.filter(u => u.role === 'engineer'));
      setEngineerAssignments(ep);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const openGenerate = () => {
    setGenerateForm({ project_id: '', ...getDefaultDates(), notes: '' });
    setError('');
    setModal('generate');
  };

  const handleGenerate = async (e) => {
    e.preventDefault();
    if (!generateForm.project_id || !generateForm.period_start || !generateForm.period_end) {
      setError('All fields are required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const result = await apiFetch('/invoices/generate', {
        method: 'POST',
        body: generateForm,
      });
      setViewingInvoice(result);
      await loadData();
      setModal('view');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const viewInvoice = async (inv) => {
    try {
      const data = await apiFetch(`/invoices/${inv.id}`);
      setViewingInvoice(data);
      setModal('view');
    } catch (e) {
      alert('Error loading invoice: ' + e.message);
    }
  };

  const handleDelete = async (invoiceId, invoiceNumber) => {
    if (!window.confirm(`Are you sure you want to delete Invoice #${invoiceNumber}? This cannot be undone.`)) {
      return;
    }
    try {
      await apiFetch(`/invoices/${invoiceId}`, { method: 'DELETE' });
      await loadData();
      if (viewingInvoice?.id === invoiceId) {
        setModal(null);
        setViewingInvoice(null);
      }
    } catch (e) {
      alert('Error deleting invoice: ' + e.message);
    }
  };

  const handleRegenerate = async () => {
    if (!viewingInvoice) return;
    if (!window.confirm('This will delete the current invoice and generate a new one with updated data. The invoice number will change. Continue?')) {
      return;
    }
    setSaving(true);
    setError('');
    try {
      // Store the parameters from the current invoice
      const params = {
        project_id: viewingInvoice.project_id,
        period_start: viewingInvoice.period_start,
        period_end: viewingInvoice.period_end,
        notes: viewingInvoice.notes || '',
      };

      // Delete the old invoice
      await apiFetch(`/invoices/${viewingInvoice.id}`, { method: 'DELETE' });

      // Generate new invoice with same parameters
      const result = await apiFetch('/invoices/generate', {
        method: 'POST',
        body: params,
      });

      setViewingInvoice(result);
      await loadData();
    } catch (e) {
      setError(e.message);
      alert('Error regenerating invoice: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleEmail = async (invoice) => {
    if (!window.confirm(`Email Invoice #${invoice.invoice_number} to the customer's AP email?`)) return;
    setEmailingId(invoice.id);
    try {
      const result = await apiFetch(`/invoices/${invoice.id}/email`, { method: 'POST' });
      alert(result.message || 'Invoice emailed successfully!');
      await loadData(); // Refresh to show emailed indicator
    } catch (e) {
      alert('Error: ' + e.message);
    } finally {
      setEmailingId(null);
    }
  };

  const openPayment = async (invoice) => {
    setViewingInvoice(invoice);
    const balance = (invoice.total_amount || 0) - (invoice.amount_paid || 0);
    setPaymentForm({ ...emptyPayment, amount: balance.toFixed(2) });
    try {
      const pmts = await apiFetch(`/invoices/${invoice.id}/payments`);
      setPayments(pmts);
    } catch (e) {
      setPayments([]);
    }
    setError('');
    setModal('payment');
  };

  const handleRecordPayment = async (e) => {
    e.preventDefault();
    if (!paymentForm.amount || parseFloat(paymentForm.amount) <= 0) {
      setError('Please enter a valid payment amount');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await apiFetch(`/invoices/${viewingInvoice.id}/payments`, {
        method: 'POST',
        body: { ...paymentForm, amount: parseFloat(paymentForm.amount) },
      });
      await loadData();
      // Refresh payments list
      const pmts = await apiFetch(`/invoices/${viewingInvoice.id}/payments`);
      setPayments(pmts);
      // Refresh the invoice data
      const updatedInv = await apiFetch(`/invoices/${viewingInvoice.id}`);
      setViewingInvoice(updatedInv);
      setPaymentForm({ ...emptyPayment, amount: '' });
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePayment = async (paymentId) => {
    if (!window.confirm('Delete this payment?')) return;
    try {
      await apiFetch(`/payments/${paymentId}`, { method: 'DELETE' });
      await loadData();
      const pmts = await apiFetch(`/invoices/${viewingInvoice.id}/payments`);
      setPayments(pmts);
      const updatedInv = await apiFetch(`/invoices/${viewingInvoice.id}`);
      setViewingInvoice(updatedInv);
    } catch (e) {
      alert('Error: ' + e.message);
    }
  };

  const handleVoid = async (invoice) => {
    if (!window.confirm(`Void Invoice #${invoice.invoice_number}? This will mark the invoice as voided and exclude it from outstanding balances.`)) {
      return;
    }
    try {
      await apiFetch(`/invoices/${invoice.id}/void`, { method: 'PUT' });
      await loadData();
    } catch (e) {
      alert('Error: ' + e.message);
    }
  };

  const handleUnvoid = async (invoice) => {
    if (!window.confirm(`Restore Invoice #${invoice.invoice_number}?`)) return;
    try {
      await apiFetch(`/invoices/${invoice.id}/unvoid`, { method: 'PUT' });
      await loadData();
    } catch (e) {
      alert('Error: ' + e.message);
    }
  };

  // Filter invoices
  // Normalize status: treat null/undefined/empty/'draft' as 'unpaid'
  const getStatus = (inv) => {
    const status = inv.status || 'unpaid';
    return status === 'draft' ? 'unpaid' : status;
  };

  // Get unique customers for filter dropdown
  const uniqueCustomers = [...new Map(invoices.map(inv => [inv.customer_name, { name: inv.customer_name }])).values()].sort((a, b) => a.name.localeCompare(b.name));

  let filteredInvoices = invoices;
  if (statusFilter === 'active') {
    filteredInvoices = invoices.filter(inv => {
      const status = getStatus(inv);
      return status === 'unpaid' || status === 'partial';
    });
  } else if (statusFilter) {
    filteredInvoices = invoices.filter(inv => getStatus(inv) === statusFilter);
  }
  // Apply customer filter
  if (customerFilter) {
    filteredInvoices = filteredInvoices.filter(inv => inv.customer_name === customerFilter);
  }
  // Apply engineer filter (filter by projects that have the engineer assigned)
  if (engineerFilter) {
    const projectIdsWithEngineer = engineerAssignments
      .filter(ea => String(ea.user_id) === engineerFilter)
      .map(ea => ea.project_id);
    filteredInvoices = filteredInvoices.filter(inv => projectIdsWithEngineer.includes(inv.project_id));
  }

  // Sort invoices
  const sortedInvoices = [...filteredInvoices].sort((a, b) => {
    let aVal, bVal;
    switch (sortField) {
      case 'invoice_number':
        aVal = parseInt(a.invoice_number) || 0;
        bVal = parseInt(b.invoice_number) || 0;
        break;
      case 'customer_name':
        aVal = (a.customer_name || '').toLowerCase();
        bVal = (b.customer_name || '').toLowerCase();
        break;
      case 'created_at':
        aVal = new Date(a.created_at || 0).getTime();
        bVal = new Date(b.created_at || 0).getTime();
        break;
      case 'total_amount':
        aVal = a.total_amount || 0;
        bVal = b.total_amount || 0;
        break;
      case 'balance':
        aVal = (a.total_amount || 0) - (a.amount_paid || 0);
        bVal = (b.total_amount || 0) - (b.amount_paid || 0);
        break;
      default:
        aVal = a[sortField];
        bVal = b[sortField];
    }
    if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const SortHeader = ({ field, children }) => (
    <th
      onClick={() => handleSort(field)}
      style={{ cursor: 'pointer', userSelect: 'none' }}
    >
      {children}
      {sortField === field && (
        <span style={{ marginLeft: 4, fontSize: 10 }}>
          {sortDir === 'asc' ? '▲' : '▼'}
        </span>
      )}
    </th>
  );

  if (loading) return <div style={{ padding: 40, color: '#94a3b8' }}>Loading...</div>;

  const inv = viewingInvoice;
  const settings = inv?.settings || {};

  const getStatusBadge = (status) => {
    const styles = {
      unpaid: { background: '#fef3c7', color: '#92400e' },
      partial: { background: '#dbeafe', color: '#1e40af' },
      paid: { background: '#d1fae5', color: '#065f46' },
      voided: { background: '#f3f4f6', color: '#6b7280', textDecoration: 'line-through' },
    };
    return (
      <span style={{
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        ...styles[status]
      }}>
        {status}
      </span>
    );
  };

  return (
    <div>
      <div className="page-header no-print">
        <div>
          <div className="page-title">Invoices</div>
          <div className="page-subtitle">Generate and manage invoices</div>
        </div>
        <button className="btn btn-primary" onClick={openGenerate}>+ Generate Invoice</button>
      </div>

      {/* Outstanding Balances Summary */}
      <div className="no-print" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 20 }}>
        <div className="card" style={{ marginBottom: 0 }}>
          <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Total Outstanding</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: balances.total_outstanding > 0 ? '#dc2626' : '#16a34a', fontFamily: 'DM Mono, monospace' }}>
            {formatCurrency(balances.total_outstanding)}
          </div>
        </div>
        {balances.by_customer.slice(0, 3).map(cust => (
          <div key={cust.id} className="card" style={{ marginBottom: 0 }}>
            <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>{cust.name}</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: '#dc2626', fontFamily: 'DM Mono, monospace' }}>
              {formatCurrency(cust.outstanding)}
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>{cust.invoice_count} invoice{cust.invoice_count !== 1 ? 's' : ''}</div>
          </div>
        ))}
      </div>

      {/* Filter and Sort Controls */}
      <div className="card no-print" style={{ marginBottom: 16, padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: '#64748b' }}>Customer:</span>
            <select
              className="form-select"
              value={customerFilter}
              onChange={(e) => setCustomerFilter(e.target.value)}
              style={{ width: 'auto', minWidth: 180 }}
            >
              <option value="">All Customers</option>
              {uniqueCustomers.map((c) => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: '#64748b' }}>Engineer:</span>
            <select
              className="form-select"
              value={engineerFilter}
              onChange={(e) => setEngineerFilter(e.target.value)}
              style={{ width: 'auto', minWidth: 150 }}
            >
              <option value="">All Engineers</option>
              {engineers.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: '#64748b' }}>Status:</span>
            <select
              className="form-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{ width: 'auto', minWidth: 150 }}
            >
              <option value="active">Active (Unpaid/Partial)</option>
              <option value="">All Invoices</option>
              <option value="unpaid">Unpaid Only</option>
              <option value="partial">Partial Only</option>
              <option value="paid">Paid Only</option>
              <option value="voided">Voided Only</option>
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: '#64748b' }}>Sort by:</span>
            <select
              className="form-select"
              value={sortField}
              onChange={(e) => setSortField(e.target.value)}
              style={{ width: 'auto', minWidth: 130 }}
            >
              <option value="created_at">Invoice Date</option>
              <option value="invoice_number">Invoice #</option>
              <option value="customer_name">Customer</option>
              <option value="total_amount">Total Amount</option>
              <option value="balance">Balance Due</option>
            </select>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
              style={{ minWidth: 40 }}
            >
              {sortDir === 'asc' ? '↑' : '↓'}
            </button>
          </div>
          <span style={{ fontSize: 13, color: '#94a3b8' }}>
            Showing {sortedInvoices.length} of {invoices.length} invoices
          </span>
        </div>
      </div>

      <div className="card no-print">
        {sortedInvoices.length === 0 ? (
          <div className="empty-state">
            <h3>No invoices {statusFilter === 'active' ? 'with outstanding balance' : statusFilter ? `with status "${statusFilter}"` : 'yet'}</h3>
            <p>{statusFilter ? 'Try a different filter.' : 'Generate your first invoice from approved timesheets.'}</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <SortHeader field="invoice_number">Invoice #</SortHeader>
                  <SortHeader field="customer_name">Customer / Project</SortHeader>
                  <SortHeader field="created_at">Date</SortHeader>
                  <SortHeader field="total_amount">Total</SortHeader>
                  <th>Paid</th>
                  <SortHeader field="balance">Balance</SortHeader>
                  <th>Status</th>
                  <th style={{ width: 200 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedInvoices.map((inv) => {
                  const balance = (inv.total_amount || 0) - (inv.amount_paid || 0);
                  const invoiceDate = inv.created_at ? new Date(inv.created_at).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' }) : '—';
                  return (
                    <tr key={inv.id} style={inv.status === 'voided' ? { opacity: 0.6 } : {}}>
                      <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 13 }}>{inv.invoice_number}</td>
                      <td>
                        <strong>{inv.customer_name}</strong>
                        <br />
                        <span style={{ fontSize: 12, color: '#94a3b8' }}>{inv.project_name}</span>
                      </td>
                      <td style={{ fontSize: 13 }}>
                        {invoiceDate}
                      </td>
                      <td style={{ fontFamily: 'DM Mono, monospace' }}>
                        {formatCurrency(inv.total_amount)}
                      </td>
                      <td style={{ fontFamily: 'DM Mono, monospace', color: '#16a34a' }}>
                        {formatCurrency(inv.amount_paid || 0)}
                      </td>
                      <td style={{ fontFamily: 'DM Mono, monospace', fontWeight: 600, color: balance > 0 ? '#dc2626' : '#16a34a' }}>
                        {formatCurrency(balance)}
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {getStatusBadge(getStatus(inv))}
                          {inv.emailed_at && (
                            <span title={`Emailed ${new Date(inv.emailed_at).toLocaleDateString()}`} style={{ color: '#16a34a', fontSize: 13 }}>✉</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <button className="btn btn-secondary btn-sm" onClick={() => viewInvoice(inv)} style={{ marginRight: 4 }}>View</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => handleEmail(inv)} disabled={emailingId === inv.id} style={{ marginRight: 4 }}>{emailingId === inv.id ? 'Sending...' : 'Email'}</button>
                        {getStatus(inv) !== 'voided' && getStatus(inv) !== 'paid' && (
                          <button className="btn btn-primary btn-sm" onClick={() => openPayment(inv)} style={{ marginRight: 4 }}>Paid</button>
                        )}
                        {getStatus(inv) === 'voided' ? (
                          <button className="btn btn-secondary btn-sm" onClick={() => handleUnvoid(inv)} style={{ marginRight: 4 }}>Restore</button>
                        ) : (
                          <button className="btn btn-danger btn-sm" onClick={() => handleVoid(inv)}>Void</button>
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

      {modal === 'generate' && (
        <Modal
          title="Generate Invoice"
          onClose={() => setModal(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleGenerate} disabled={saving}>
                {saving ? 'Generating...' : 'Generate Invoice'}
              </button>
            </>
          }
        >
          <form onSubmit={handleGenerate}>
            {error && <div className="alert alert-error">{error}</div>}
            <div className="alert alert-info">
              This will generate an invoice from all approved timesheets for the selected project within the date range.
            </div>
            <div className="form-group">
              <label className="form-label">Project *</label>
              <select
                className="form-select"
                value={generateForm.project_id}
                onChange={(e) => setGenerateForm({ ...generateForm, project_id: e.target.value })}
              >
                <option value="">Select a project...</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.customer_name})
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Period Start *</label>
                <input
                  className="form-input"
                  type="date"
                  value={generateForm.period_start}
                  onChange={(e) => setGenerateForm({ ...generateForm, period_start: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Period End *</label>
                <input
                  className="form-input"
                  type="date"
                  value={generateForm.period_end}
                  onChange={(e) => setGenerateForm({ ...generateForm, period_end: e.target.value })}
                />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Notes (optional)</label>
              <textarea
                className="form-textarea"
                value={generateForm.notes}
                onChange={(e) => setGenerateForm({ ...generateForm, notes: e.target.value })}
                placeholder="Additional notes for the invoice..."
                rows={3}
              />
            </div>
          </form>
        </Modal>
      )}

      {modal === 'view' && inv && (
        <>
          {/* Invoice View Modal (non-print) */}
          <div className="modal-overlay no-print" onClick={() => setModal(null)}>
            <div className="modal" style={{ maxWidth: 900 }} onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-title">Invoice #{inv.invoice_number}</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-primary" onClick={handlePrint}>Print</button>
                  <button className="btn btn-secondary" onClick={handleRegenerate} disabled={saving}>
                    {saving ? 'Regenerating...' : 'Regenerate'}
                  </button>
                  <button className="btn btn-danger" onClick={() => handleDelete(inv.id, inv.invoice_number)}>Delete</button>
                  <button className="btn btn-secondary" onClick={() => setModal(null)}>Close</button>
                </div>
              </div>

              {/* Invoice Preview */}
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 24, background: 'white' }}>
                <InvoiceContent inv={inv} settings={settings} />
              </div>
            </div>
          </div>

          {/* Print-only Invoice + Timesheets */}
          <div className="print-only" style={{ display: 'none' }}>
            <style>
              {`
                .print-only { display: none; }
                @media print {
                  .print-only { display: block !important; }
                  .no-print, .sidebar, .mobile-header, .mobile-top-header, .mobile-nav, .page-header { display: none !important; }
                  body { background: white !important; padding: 0 !important; margin: 0 !important; font-size: 8pt !important; }
                  .main-content { margin: 0 !important; padding: 0 !important; }
                  .card { display: none !important; }
                  .app-shell { display: block !important; }
                  .print-invoice { padding: 8px; font-size: 10px; }
                  .print-invoice table { font-size: 9px; }
                  .timesheet-page { page-break-before: always !important; break-before: page !important; page-break-inside: avoid; padding: 10px; }
                  .daily-time-report { font-family: Arial, sans-serif; font-size: 6pt; padding: 0; }
                  .daily-time-report table { border-collapse: collapse; width: 100%; }
                  .daily-time-report th, .daily-time-report td { border: 1px solid #000; padding: 1px 2px; font-size: 6pt; }
                  .daily-time-report th { background: #f5f5f5 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                }
                @page { margin: 0.25in; size: letter; }
              `}
            </style>
            <div className="print-invoice">
              <InvoiceContent inv={inv} settings={settings} />
            </div>
            {/* Print timesheets after invoice (only if include_timesheets is enabled) */}
            {inv.include_timesheets && inv.timesheetDetails && inv.timesheetDetails.map((ts, idx) => (
              <div key={ts.id} className="timesheet-page">
                <DailyTimeReport
                  timesheet={ts}
                  settings={settings}
                  projectName={inv.project_name || inv.project?.name}
                  customerName={inv.customer_name || inv.project?.customer_name}
                  location={inv.location || inv.project?.location}
                  poNumber={inv.po_number || inv.project?.po_number}
                />
              </div>
            ))}
          </div>
        </>
      )}

      {modal === 'payment' && viewingInvoice && (
        <Modal
          title={`Record Payment - Invoice #${viewingInvoice.invoice_number}`}
          onClose={() => setModal(null)}
          footer={<button className="btn btn-secondary" onClick={() => setModal(null)}>Close</button>}
        >
          {error && <div className="alert alert-error">{error}</div>}

          {/* Invoice Summary */}
          <div style={{ background: '#f8fafc', padding: 16, borderRadius: 8, marginBottom: 20 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, textAlign: 'center' }}>
              <div>
                <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase' }}>Total</div>
                <div style={{ fontSize: 18, fontWeight: 600, fontFamily: 'DM Mono, monospace' }}>
                  {formatCurrency(viewingInvoice.total_amount)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase' }}>Paid</div>
                <div style={{ fontSize: 18, fontWeight: 600, fontFamily: 'DM Mono, monospace', color: '#16a34a' }}>
                  {formatCurrency(viewingInvoice.amount_paid || 0)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase' }}>Balance Due</div>
                <div style={{ fontSize: 18, fontWeight: 600, fontFamily: 'DM Mono, monospace', color: '#dc2626' }}>
                  {formatCurrency((viewingInvoice.total_amount || 0) - (viewingInvoice.amount_paid || 0))}
                </div>
              </div>
            </div>
          </div>

          {/* Payment History */}
          {payments.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Payment History</div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Amount</th>
                      <th>Method</th>
                      <th>Reference</th>
                      <th style={{ width: 60 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map(pmt => (
                      <tr key={pmt.id}>
                        <td>{formatDate(pmt.payment_date)}</td>
                        <td style={{ fontFamily: 'DM Mono, monospace', color: '#16a34a' }}>{formatCurrency(pmt.amount)}</td>
                        <td>{pmt.payment_method || '—'}</td>
                        <td style={{ fontSize: 12 }}>{pmt.reference_number || '—'}</td>
                        <td>
                          <button className="btn btn-danger btn-sm" onClick={() => handleDeletePayment(pmt.id)}>Del</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Record New Payment */}
          {(viewingInvoice.total_amount || 0) - (viewingInvoice.amount_paid || 0) > 0 && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Record New Payment</div>
              <form onSubmit={handleRecordPayment}>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Amount *</label>
                    <input
                      className="form-input"
                      type="number"
                      step="0.01"
                      value={paymentForm.amount}
                      onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Payment Date *</label>
                    <input
                      className="form-input"
                      type="date"
                      value={paymentForm.payment_date}
                      onChange={(e) => setPaymentForm({ ...paymentForm, payment_date: e.target.value })}
                    />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Payment Method</label>
                    <select
                      className="form-select"
                      value={paymentForm.payment_method}
                      onChange={(e) => setPaymentForm({ ...paymentForm, payment_method: e.target.value })}
                    >
                      <option value="">Select...</option>
                      {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Reference # (Check #, etc.)</label>
                    <input
                      className="form-input"
                      value={paymentForm.reference_number}
                      onChange={(e) => setPaymentForm({ ...paymentForm, reference_number: e.target.value })}
                      placeholder="Check number, transaction ID..."
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Notes</label>
                  <input
                    className="form-input"
                    value={paymentForm.notes}
                    onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                    placeholder="Optional notes..."
                  />
                </div>
                <button className="btn btn-primary" type="submit" disabled={saving}>
                  {saving ? 'Recording...' : 'Record Payment'}
                </button>
              </form>
            </div>
          )}

          {(viewingInvoice.total_amount || 0) - (viewingInvoice.amount_paid || 0) <= 0 && (
            <div className="alert alert-success">
              This invoice has been paid in full.
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function DailyTimeReport({ timesheet, settings, projectName, customerName, location, poNumber }) {
  const ts = timesheet;
  const weekEnding = ts.week_ending
    ? new Date(ts.week_ending + 'T00:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' })
    : '';

  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // Create a map of entries by date
  const entriesByDate = {};
  if (ts.entries) {
    ts.entries.forEach(e => {
      const dateKey = e.entry_date ? e.entry_date.split('T')[0] : '';
      if (dateKey) entriesByDate[dateKey] = e;
    });
  }

  // Calculate week dates (Monday through Sunday)
  const getWeekDates = () => {
    if (!ts.week_ending) return [];
    const weekEnd = new Date(ts.week_ending + 'T00:00:00');
    const dates = [];
    for (let i = -6; i <= 0; i++) {
      const d = new Date(weekEnd);
      d.setDate(weekEnd.getDate() + i);
      dates.push(d.toISOString().split('T')[0]);
    }
    return dates;
  };

  const weekDates = getWeekDates();

  // Calculate totals
  let totalST = 0, totalOT = 0, totalPT = 0;
  weekDates.forEach(date => {
    const entry = entriesByDate[date];
    if (entry && entry.hours) {
      totalST += entry.hours; // All hours as ST for now
    }
  });
  const grandTotal = totalST + totalOT + totalPT;
  const rate = ts.bill_rate || 0;
  const laborSubtotal = grandTotal * rate;

  // Styles - ultra compact to fit on one page even on mobile
  const cellStyle = { border: '1px solid #000', padding: '1px 2px', fontSize: '6pt', height: '14px', verticalAlign: 'middle' };
  const headerCell = { ...cellStyle, fontWeight: 'bold', background: '#f5f5f5', textAlign: 'center', height: '12px' };
  const centerCell = { ...cellStyle, textAlign: 'center' };
  const rightCell = { ...cellStyle, textAlign: 'right' };
  const descRowStyle = { border: '1px solid #000', padding: '1px 2px', fontSize: '6pt', height: '45px', verticalAlign: 'top' };

  const formatTime = (time) => {
    if (!time) return '';
    const [h, m] = time.split(':');
    const hour = parseInt(h);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return `${hour12}:${m} ${ampm}`;
  };

  return (
    <div className="daily-time-report" style={{ fontFamily: 'Arial, sans-serif', fontSize: '6pt', padding: 0, width: '100%' }}>
      {/* Header Section - ultra compact */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1px', width: '100%' }}>
        {/* Left: Logo and Company Info */}
        <div style={{ flex: '0 0 auto', width: '160px', paddingRight: '5px' }}>
          {settings?.company_logo && (
            <img src={settings.company_logo} alt="Logo" style={{ maxWidth: '80px', maxHeight: '30px', marginBottom: '1px', display: 'block' }} />
          )}
          <div style={{ fontWeight: 'bold', fontStyle: 'italic', fontSize: '7pt' }}>
            {settings?.company_name || 'Company Name'}
          </div>
          <div style={{ fontSize: '5pt' }}>Service at: <strong>{customerName}</strong></div>
          <div style={{ fontSize: '5pt' }}>Location: {location || ''}</div>
        </div>
        {/* Center: Title and Rate Info */}
        <div style={{ flex: '0 0 auto', width: '160px', textAlign: 'center', padding: '0 5px' }}>
          <div style={{ fontWeight: 'bold', fontSize: '9pt', marginBottom: '1px' }}>Daily Time Report</div>
          <div style={{ fontSize: '5pt', lineHeight: '1.2' }}>
            Mon shift 1 - Sun shift 3<br/>
            ${rate.toFixed(2)}/hr | ST = All | OT/PT = N/A
          </div>
        </div>
        {/* Right: Timesheet Info - compact */}
        <div style={{ flex: '0 0 auto', width: '180px', fontSize: '5pt', lineHeight: '1.1' }}>
          <div><span style={{ display: 'inline-block', width: '55px', textAlign: 'right', paddingRight: '2px' }}>Week Ending:</span><strong>{weekEnding}</strong></div>
          <div><span style={{ display: 'inline-block', width: '55px', textAlign: 'right', paddingRight: '2px' }}>Engineer:</span>{ts.engineer_name}</div>
          <div><span style={{ display: 'inline-block', width: '55px', textAlign: 'right', paddingRight: '2px' }}>Engineer ID:</span>{ts.engineer_id || ''}</div>
          <div><span style={{ display: 'inline-block', width: '55px', textAlign: 'right', paddingRight: '2px' }}>Work Order #:</span>{poNumber || ''}</div>
          <div><span style={{ display: 'inline-block', width: '55px', textAlign: 'right', paddingRight: '2px' }}>Project:</span>{projectName}</div>
        </div>
      </div>

      {/* Daily Entries Table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '4px' }}>
        <thead>
          <tr>
            <th style={{ ...headerCell, width: '55px' }}>Date</th>
            <th style={{ ...headerCell, width: '50px' }}>Travel To</th>
            <th style={{ ...headerCell, width: '55px' }}>Travel From</th>
            <th style={{ ...headerCell, width: '30px' }}>Shift</th>
            <th style={{ ...headerCell, width: '40px' }}>On Call</th>
            <th style={{ ...headerCell, width: '50px' }}>Start Time</th>
            <th style={{ ...headerCell, width: '50px' }}>End Time</th>
            <th style={{ ...headerCell, width: '28px' }}>ST</th>
            <th style={{ ...headerCell, width: '28px' }}>OT</th>
            <th style={{ ...headerCell, width: '28px' }}>PT</th>
            <th style={{ ...headerCell, width: '28px' }}>STT</th>
            <th style={{ ...headerCell, width: '28px' }}>OTT</th>
            <th style={{ ...headerCell, width: '35px' }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {weekDates.map((date, idx) => {
            const entry = entriesByDate[date] || {};
            const dateObj = new Date(date + 'T00:00:00');
            const formattedDate = `${dateObj.getMonth() + 1}/${dateObj.getDate()}/${dateObj.getFullYear()}`;
            const hours = entry.hours || 0;
            const st = hours > 0 ? hours.toFixed(1) : '0.0';

            return (
              <React.Fragment key={date}>
                {/* Time Row */}
                <tr>
                  <td style={{ ...centerCell, whiteSpace: 'nowrap' }}>{formattedDate} {dayNames[idx]}</td>
                  <td style={centerCell}>{location || ''}</td>
                  <td style={centerCell}></td>
                  <td style={centerCell}>{entry.shift || '1'}</td>
                  <td style={centerCell}></td>
                  <td style={centerCell}>{formatTime(entry.start_time)}</td>
                  <td style={centerCell}>{formatTime(entry.end_time)}</td>
                  <td style={centerCell}>{hours > 0 ? st : '0.0'}</td>
                  <td style={centerCell}>0.0</td>
                  <td style={centerCell}>0.0</td>
                  <td style={centerCell}>0.0</td>
                  <td style={centerCell}>0.0</td>
                  <td style={{ ...centerCell, fontWeight: 'bold' }}>{hours > 0 ? st : '0.0'}</td>
                </tr>
                {/* Description Row */}
                <tr>
                  <td style={descRowStyle}><strong>Detailed Description of Work:</strong></td>
                  <td colSpan={12} style={descRowStyle}>{entry.description || ''}</td>
                </tr>
              </React.Fragment>
            );
          })}
          {/* Weekly Totals Row */}
          <tr style={{ background: '#f5f5f5' }}>
            <td colSpan={7} style={{ ...cellStyle, fontWeight: 'bold' }}>Weekly Totals:</td>
            <td style={{ ...centerCell, fontWeight: 'bold' }}>{totalST.toFixed(1)}</td>
            <td style={{ ...centerCell, fontWeight: 'bold' }}>{totalOT.toFixed(1)}</td>
            <td style={{ ...centerCell, fontWeight: 'bold' }}>{totalPT.toFixed(1)}</td>
            <td style={{ ...centerCell, fontWeight: 'bold' }}>0.0</td>
            <td style={{ ...centerCell, fontWeight: 'bold' }}>0.0</td>
            <td style={{ ...centerCell, fontWeight: 'bold' }}>{grandTotal.toFixed(1)}</td>
          </tr>
        </tbody>
      </table>

      {/* Bottom Section: Signatures and Pay Totals - ultra compact */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '5pt', lineHeight: '1.1', marginTop: '2px' }}>
        {/* Left: Signatures */}
        <div style={{ width: '48%', paddingRight: '5px' }}>
          <div style={{ marginBottom: '2px' }}>
            <div style={{ borderBottom: '1px solid #000', height: '10px', marginBottom: '1px' }}></div>
            <div>Certified by: <span style={{ marginLeft: '20px' }}>Date: _______</span></div>
            <div style={{ fontSize: '4pt' }}>{settings?.company_name || 'Company'} Site Lead</div>
          </div>
          <div>
            <div style={{ borderBottom: '1px solid #000', height: '10px', marginBottom: '1px' }}></div>
            <div>Approved by: <span style={{ marginLeft: '20px' }}>Date: _______</span></div>
            <div style={{ fontSize: '4pt' }}>Customer Representative</div>
          </div>
        </div>
        {/* Right: Expenses/Pay Summary - compact */}
        <div style={{ width: '50%', border: '1px solid #000' }}>
          <div style={{ background: '#f5f5f5', textAlign: 'center', fontWeight: 'bold', borderBottom: '1px solid #000', padding: '0px 1px', fontSize: '5pt' }}>Expenses</div>
          <div style={{ display: 'flex', padding: '0px 2px', fontSize: '5pt' }}>
            <span>Air: $0 | Car: $0 | Meals: $0 | Parking: $0 | Misc: $0</span>
          </div>
          <div style={{ textAlign: 'right', padding: '0px 2px', fontSize: '5pt' }}><strong>Exp Subtotal:</strong> $0.00</div>
          <div style={{ textAlign: 'right', padding: '0px 2px', fontSize: '5pt' }}>Rate: ${rate.toFixed(2)}/hr | Hours: {grandTotal.toFixed(1)}</div>
          <div style={{ textAlign: 'right', padding: '1px 2px', fontWeight: 'bold', fontSize: '6pt' }}>Total: ${laborSubtotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
        </div>
      </div>
    </div>
  );
}

function InvoiceContent({ inv, settings }) {
  // Handle both generated (nested in project) and loaded (flat) invoice data structures
  const customerName = inv.customer_name || inv.project?.customer_name || '';
  const customerAddress = inv.customer_address || inv.project?.customer_address || '';
  const supplierNumber = inv.supplier_number || inv.project?.supplier_number || '';
  const paymentTerms = inv.payment_terms || inv.project?.payment_terms || 'Net 30';
  const poNumber = inv.po_number || inv.project?.po_number || '';
  const projectName = inv.project_name || inv.project?.name || '';
  const projectDescription = inv.project_description || inv.project?.project_description || inv.project?.description || '';
  const contactName = inv.contact_name || inv.project?.contact_name || '';
  const periodRange = `${formatDate(inv.period_start)} to ${formatDate(inv.period_end)}`;

  const invoiceDate = inv.created_at ? new Date(inv.created_at).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' }) : formatDate(new Date().toISOString().split('T')[0]);
  const dueDate = getDueDate(inv.created_at || new Date(), paymentTerms);

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', color: '#000' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
        {/* Company Info */}
        <div style={{ lineHeight: 1.4 }}>
          <div style={{ fontWeight: 'bold', fontSize: 16 }}>{settings.company_name || 'Your Company Name'}</div>
          {settings.company_address && <div>{settings.company_address}</div>}
          {settings.company_city_state_zip && <div>{settings.company_city_state_zip}</div>}
          {settings.company_phone && <div>Phone: {settings.company_phone}</div>}
          {settings.company_fax && <div>Fax: {settings.company_fax}</div>}
          {settings.company_email && <div>E-mail: {settings.company_email}</div>}
        </div>

        {/* Invoice Details */}
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 'bold', fontSize: 18, marginBottom: 8 }}>Invoice</div>
          <table style={{ marginLeft: 'auto', borderCollapse: 'collapse', fontSize: 12 }}>
            <tbody>
              <tr>
                <td style={{ padding: '2px 8px', textAlign: 'left' }}>Invoice no:</td>
                <td style={{ padding: '2px 8px', textAlign: 'right', fontWeight: 'bold' }}>{inv.invoice_number}</td>
              </tr>
              <tr>
                <td style={{ padding: '2px 8px', textAlign: 'left' }}>Invoice date:</td>
                <td style={{ padding: '2px 8px', textAlign: 'right' }}>{invoiceDate}</td>
              </tr>
              <tr>
                <td style={{ padding: '2px 8px', textAlign: 'left' }}>Due date:</td>
                <td style={{ padding: '2px 8px', textAlign: 'right' }}>{dueDate}</td>
              </tr>
              <tr>
                <td style={{ padding: '2px 8px', textAlign: 'left' }}>Supplier ID:</td>
                <td style={{ padding: '2px 8px', textAlign: 'right' }}>{supplierNumber || '—'}</td>
              </tr>
              <tr>
                <td style={{ padding: '2px 8px', textAlign: 'left' }}>PO Number:</td>
                <td style={{ padding: '2px 8px', textAlign: 'right', fontWeight: 'bold' }}>{poNumber || '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Bill To and Logo */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ fontWeight: 'bold', marginBottom: 4 }}>To:</div>
          <div style={{ lineHeight: 1.5, marginLeft: 20 }}>
            <div style={{ fontWeight: 'bold' }}>{customerName}</div>
            {customerAddress && customerAddress.split('\n').map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        </div>
        {settings.company_logo && (
          <div style={{ textAlign: 'right' }}>
            <img
              src={settings.company_logo}
              alt="Company Logo"
              style={{ maxWidth: 200, maxHeight: 80, objectFit: 'contain' }}
            />
          </div>
        )}
      </div>

      {/* Project Info */}
      <div style={{ marginBottom: 16, padding: '8px 12px', background: '#f5f5f5', borderRadius: 4 }}>
        <strong>Project:</strong> {projectName}
      </div>

      {/* Sales Info */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, fontSize: 12, borderTop: '1px solid #ccc', borderBottom: '1px solid #ccc', padding: '8px 0' }}>
        <div><strong>Sales Person:</strong> {settings.company_name || '—'}</div>
        <div><strong>Contact name:</strong> {contactName || '—'}</div>
        <div><strong>Payment terms:</strong> {paymentTerms}</div>
      </div>

      {/* Line Items Table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
        <thead>
          <tr style={{ background: '#f0f0f0' }}>
            <th style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'left' }}>Qty.</th>
            <th style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'left' }}>Item</th>
            <th style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'left' }}>Description</th>
            <th style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'right' }}>Unit Price</th>
            <th style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'right' }}>Discount</th>
            <th style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'right' }}>Line Total</th>
          </tr>
        </thead>
        <tbody>
          {inv.lineItems && inv.lineItems.length > 0 ? (
            inv.lineItems.map((item, idx) => (
              <tr key={idx}>
                <td style={{ border: '1px solid #ccc', padding: '8px' }}>
                  {item.is_fixed_price ? `${item.percentage}%` : item.hours?.toFixed(0)}
                </td>
                <td style={{ border: '1px solid #ccc', padding: '8px' }}>{poNumber || 'Engineering'}</td>
                <td style={{ border: '1px solid #ccc', padding: '8px' }}>
                  {item.is_fixed_price
                    ? `${projectDescription || 'Fixed Price Service'} - ${item.engineer}`
                    : `${projectDescription || 'Engineering Labor Hours'} - ${item.engineer} - ${periodRange}`
                  }
                </td>
                <td style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'right' }}>
                  {item.is_fixed_price ? 'Fixed' : `$${item.rate?.toFixed(2) || '0.00'}`}
                </td>
                <td style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'right' }}></td>
                <td style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'right' }}>${item.amount?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td style={{ border: '1px solid #ccc', padding: '8px' }}>{inv.total_hours?.toFixed(0) || 0}</td>
              <td style={{ border: '1px solid #ccc', padding: '8px' }}>{poNumber || 'Engineering'}</td>
              <td style={{ border: '1px solid #ccc', padding: '8px' }}>
                {projectDescription || 'Engineering Labor Hours'} - {periodRange}
              </td>
              <td style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'right' }}>—</td>
              <td style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'right' }}></td>
              <td style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'right' }}>${inv.total_amount?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}</td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Totals */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <table style={{ borderCollapse: 'collapse', minWidth: 200 }}>
          <tbody>
            <tr>
              <td style={{ padding: '4px 12px', textAlign: 'right' }}>Subtotal</td>
              <td style={{ padding: '4px 12px', textAlign: 'right', fontWeight: 'bold' }}>
                ${inv.total_amount?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
              </td>
            </tr>
            <tr>
              <td style={{ padding: '4px 12px', textAlign: 'right' }}>Sales tax</td>
              <td style={{ padding: '4px 12px', textAlign: 'right' }}>$0.00</td>
            </tr>
            <tr style={{ borderTop: '2px solid #000' }}>
              <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 'bold', fontSize: 14 }}>Total</td>
              <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 'bold', fontSize: 14 }}>
                ${inv.total_amount?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
