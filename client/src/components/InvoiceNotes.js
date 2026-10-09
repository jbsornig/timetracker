import React, { useState, useEffect } from 'react';
import { apiFetch } from '../api';

const NOTES_PLACEHOLDER = 'e.g. Training dates: Sept 22-26, 2026';

export function PrintNotesField({ value, onChange }) {
  return (
    <div className="form-group">
      <label className="form-label">Notes printed on invoice (optional)</label>
      <textarea
        className="form-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={NOTES_PLACEHOLDER}
        rows={3}
      />
      <div className="form-hint">Shown at the bottom of the invoice and the emailed PDF.</div>
    </div>
  );
}

export function InvoiceNotesEditor({ invoice, onSaved }) {
  const [text, setText] = useState(invoice.print_notes || '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setText(invoice.print_notes || '');
    setMessage('');
    // Reset per invoice, not per save, so "Notes saved" stays visible
  }, [invoice.id]);

  const unchanged = text.trim() === (invoice.print_notes || '').trim();

  const save = async () => {
    setSaving(true);
    setMessage('');
    try {
      await apiFetch(`/invoices/${invoice.id}`, { method: 'PUT', body: { print_notes: text } });
      onSaved(text.trim() || null);
      setMessage('Notes saved');
    } catch (err) {
      setMessage(`Couldn't save notes: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ marginTop: 16, padding: 16, border: '1px solid var(--border)', borderRadius: 8, background: '#f0fdf4' }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Notes Printed on Invoice</div>
      <textarea
        className="form-textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={NOTES_PLACEHOLDER}
        rows={3}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={saving || unchanged}>
          {saving ? 'Saving...' : 'Save Notes'}
        </button>
        {message && <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{message}</span>}
      </div>
    </div>
  );
}
