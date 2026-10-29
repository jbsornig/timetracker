import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../api';
import Modal from './Modal';

const API_BASE = process.env.REACT_APP_API_URL || '';
const ARCHIVE_YEARS_SHOWN = 5;
const MUTED = { color: '#64748b', fontSize: 13 };

function formatDateTime(isoString) {
  if (!isoString) return '';
  return new Date(isoString).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function getFilenameFromResponse(response, fallbackName) {
  const disposition = response.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="([^"]+)"/);
  return match ? match[1] : fallbackName;
}

async function downloadFile(path, fallbackName) {
  const token = localStorage.getItem('tt_token');
  const response = await fetch(`${API_BASE}/api${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const text = await response.text();
    let message = `HTTP ${response.status}`;
    try { message = JSON.parse(text).error || message; } catch { /* not JSON */ }
    throw new Error(message);
  }
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = getFilenameFromResponse(response, fallbackName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function buildChecklistItems(checklist) {
  return [
    { count: checklist.unsubmitted_timesheets, label: 'timesheets still in draft or waiting for approval', warn: true },
    { count: checklist.uninvoiced_timesheets, label: 'approved timesheets not yet invoiced', warn: true },
    { count: checklist.open_invoices, label: 'invoices still unpaid (payments dated next year can still be recorded)', warn: false },
    { count: checklist.invoices, label: 'invoices issued', warn: false },
    { count: checklist.engineer_payments, label: 'engineer payments made', warn: false },
  ];
}

export default function YearEndClose() {
  const [state, setState] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [message, setMessage] = useState('');
  const [archiveYear, setArchiveYear] = useState(String(new Date().getFullYear() - 1));
  const [downloading, setDownloading] = useState('');
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [reopenTarget, setReopenTarget] = useState(null);

  const loadState = useCallback(async () => {
    try {
      setState(await apiFetch('/year-close'));
      setLoadError('');
    } catch (err) {
      setLoadError(`Could not load year-end status: ${err.message}`);
    }
  }, []);

  useEffect(() => { loadState(); }, [loadState]);

  const runDownload = async (key, path, fallbackName) => {
    setDownloading(key);
    try {
      await downloadFile(path, fallbackName);
    } catch (err) {
      alert(`Download failed: ${err.message}`);
    } finally {
      setDownloading('');
    }
  };

  const handleDone = (doneMessage) => {
    setShowCloseModal(false);
    setReopenTarget(null);
    setMessage(doneMessage);
    loadState();
  };

  if (loadError) return <div className="card" style={{ marginTop: 20 }}><div className="alert alert-error">{loadError}</div></div>;
  if (!state) return null;

  const archiveYears = Array.from({ length: ARCHIVE_YEARS_SHOWN }, (_, index) => String(state.current_year - index));
  const closedThrough = state.closed_through_year;

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <div className="card-title">Year-End Close</div>
      <p style={{ ...MUTED, fontSize: 14, marginBottom: 16 }}>
        Closing a year saves a permanent archive copy and locks timesheets, invoices and payments dated in that year so the numbers can't change after you file.
        Payments dated in a later year can still be recorded against old invoices.
      </p>

      {message && <div className="alert alert-success" style={{ marginBottom: 16 }}>{message}</div>}

      <div style={{ padding: '10px 14px', borderRadius: 6, marginBottom: 20, fontSize: 14, background: closedThrough ? '#f0fdf4' : '#f8fafc', border: `1px solid ${closedThrough ? '#bbf7d0' : '#e2e8f0'}` }}>
        {closedThrough
          ? <><strong>Closed through {closedThrough}.</strong> Records dated {closedThrough} and earlier are locked.</>
          : <><strong>No year is closed.</strong> All records can be edited.</>}
      </div>

      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Excel archive</div>
      <p style={{ ...MUTED, marginBottom: 12 }}>
        Invoices, payments received, engineer payments, 1099 totals and timesheets for one year. You can download it any time, before or after closing.
      </p>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 24 }}>
        <select className="form-select" value={archiveYear} onChange={(e) => setArchiveYear(e.target.value)} style={{ width: 'auto' }}>
          {archiveYears.map(year => <option key={year} value={year}>{year}</option>)}
        </select>
        <button
          className="btn btn-secondary"
          type="button"
          disabled={downloading === 'workbook'}
          onClick={() => runDownload('workbook', `/year-close/${archiveYear}/workbook`, `${archiveYear} Year-End Archive.xlsx`)}
        >
          {downloading === 'workbook' ? 'Preparing...' : `Download ${archiveYear} Excel archive`}
        </button>
      </div>

      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Close a year</div>
      {state.next_year_to_close ? (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 24 }}>
          <span style={MUTED}>{state.next_year_to_close} has ended and can be closed.</span>
          <button className="btn btn-primary" type="button" onClick={() => { setMessage(''); setShowCloseModal(true); }}>
            Close {state.next_year_to_close}...
          </button>
        </div>
      ) : (
        <p style={{ ...MUTED, marginBottom: 24 }}>
          {state.current_year} can be closed from January 1, {state.current_year + 1}.
        </p>
      )}

      {state.closures.length > 0 && (
        <ClosureHistory
          closures={state.closures}
          closedThrough={closedThrough}
          downloading={downloading}
          onDownloadArchive={(file) => runDownload(file, `/year-close/archives/${encodeURIComponent(file)}/download`, file)}
          onReopen={(year) => { setMessage(''); setReopenTarget(year); }}
        />
      )}

      {showCloseModal && (
        <CloseYearModal
          year={state.next_year_to_close}
          checklist={state.checklist_year === state.next_year_to_close ? state.checklist : null}
          onClose={() => setShowCloseModal(false)}
          onDone={handleDone}
        />
      )}
      {reopenTarget && (
        <ReopenYearModal year={reopenTarget} onClose={() => setReopenTarget(null)} onDone={handleDone} />
      )}
    </div>
  );
}

function ClosureHistory({ closures, closedThrough, downloading, onDownloadArchive, onReopen }) {
  return (
    <>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>History</div>
      <div className="table-wrap">
        <table style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th>Year</th>
              <th>Closed</th>
              <th>Reopened</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {closures.map(closure => {
              const isActive = !closure.reopened_at;
              return (
                <tr key={closure.id}>
                  <td style={{ fontWeight: 600 }}>{closure.year}</td>
                  <td>{formatDateTime(closure.closed_at)}{closure.closed_by_name ? ` by ${closure.closed_by_name}` : ''}</td>
                  <td style={{ color: isActive ? '#94a3b8' : 'inherit' }}>
                    {isActive ? '—' : `${formatDateTime(closure.reopened_at)}${closure.reopened_by_name ? ` by ${closure.reopened_by_name}` : ''}: ${closure.reopen_reason}`}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn btn-secondary btn-sm" type="button" disabled={downloading === closure.archive_file} onClick={() => onDownloadArchive(closure.archive_file)}>
                      Download archive copy
                    </button>
                    {isActive && closure.year === closedThrough && (
                      <button className="btn btn-secondary btn-sm" type="button" style={{ marginLeft: 8 }} onClick={() => onReopen(closure.year)}>
                        Reopen
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function CloseYearModal({ year, checklist, onClose, onDone }) {
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState('');

  const handleCloseYear = async () => {
    setClosing(true);
    setError('');
    try {
      const result = await apiFetch(`/year-close/${year}/close`, { method: 'POST' });
      onDone(result.message);
    } catch (err) {
      setError(err.message);
      setClosing(false);
    }
  };

  const footer = (
    <>
      <button className="btn btn-secondary" type="button" onClick={onClose} disabled={closing}>Cancel</button>
      <button className="btn btn-primary" type="button" onClick={handleCloseYear} disabled={closing}>
        {closing ? 'Closing...' : `Close ${year}`}
      </button>
    </>
  );

  return (
    <Modal title={`Close ${year}`} onClose={onClose} footer={footer}>
      {error && <div className="alert alert-error">{error}</div>}
      <p style={{ fontSize: 14, marginBottom: 12 }}>
        After closing, timesheets, invoices, customer payments and engineer payments dated {year} or earlier can't be added, edited, voided or deleted.
        A full archive copy of the database is saved first. You can reopen {year} later if something needs correcting.
      </p>
      {checklist && (
        <>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>{year} at a glance</div>
          <ul style={{ margin: '0 0 12px', paddingLeft: 20, fontSize: 13 }}>
            {buildChecklistItems(checklist).map(item => (
              <li key={item.label} style={{ color: item.warn && item.count > 0 ? '#b45309' : 'inherit', fontWeight: item.warn && item.count > 0 ? 600 : 400 }}>
                {item.count} {item.label}
              </li>
            ))}
          </ul>
        </>
      )}
      <p style={MUTED}>Download the {year} Excel archive before closing if you want a copy for your accountant.</p>
    </Modal>
  );
}

function ReopenYearModal({ year, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleReopen = async () => {
    if (!reason.trim()) { setError('Enter a reason for reopening the year.'); return; }
    setSaving(true);
    setError('');
    try {
      const result = await apiFetch(`/year-close/${year}/reopen`, { method: 'POST', body: { reason } });
      onDone(result.message);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  const footer = (
    <>
      <button className="btn btn-secondary" type="button" onClick={onClose} disabled={saving}>Cancel</button>
      <button className="btn btn-primary" type="button" onClick={handleReopen} disabled={saving}>
        {saving ? 'Reopening...' : `Reopen ${year}`}
      </button>
    </>
  );

  return (
    <Modal title={`Reopen ${year}`} onClose={onClose} footer={footer}>
      {error && <div className="alert alert-error">{error}</div>}
      <p style={{ fontSize: 14, marginBottom: 12 }}>
        Records dated {year} become editable again. Close the year again when the correction is done. The reason is kept in the history.
      </p>
      <div className="form-group">
        <label className="form-label">Reason</label>
        <textarea className="form-input" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer reissued December payment advice" />
      </div>
    </Modal>
  );
}
