import React, { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../api';
import Modal from '../components/Modal';

const API_BASE = process.env.REACT_APP_API_URL || '';

const emptyHoliday = { name: '', date: '', hours: 8 };

// Helper functions for calculating US holiday dates
function getMemorialDay(year) {
  // Last Monday of May
  const lastDay = new Date(year, 4, 31); // May 31
  const dayOfWeek = lastDay.getDay();
  const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const memorial = new Date(year, 4, 31 - diff);
  return memorial.toISOString().split('T')[0];
}

function getLaborDay(year) {
  // First Monday of September
  const sept1 = new Date(year, 8, 1);
  const dayOfWeek = sept1.getDay();
  const diff = dayOfWeek === 0 ? 1 : dayOfWeek === 1 ? 0 : 8 - dayOfWeek;
  const labor = new Date(year, 8, 1 + diff);
  return labor.toISOString().split('T')[0];
}

function getThanksgiving(year) {
  // Fourth Thursday of November
  const nov1 = new Date(year, 10, 1);
  const dayOfWeek = nov1.getDay();
  const firstThursday = dayOfWeek <= 4 ? 4 - dayOfWeek + 1 : 11 - dayOfWeek + 1;
  const thanksgiving = new Date(year, 10, firstThursday + 21);
  return thanksgiving.toISOString().split('T')[0];
}

export default function Settings() {
  const [settings, setSettings] = useState({
    company_name: '',
    company_address: '',
    company_city_state_zip: '',
    company_phone: '',
    company_fax: '',
    company_email: '',
    company_logo: '',
    next_invoice_number: '1000',
    admin_notification_email: '',
    smtp_email: '',
    smtp_password: '',
  });
  const [smtpPasswordChanged, setSmtpPasswordChanged] = useState(false);
  const [hasExistingPassword, setHasExistingPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const fileInputRef = useRef(null);

  // Holidays state
  const [holidays, setHolidays] = useState([]);
  const [holidayModal, setHolidayModal] = useState(null);
  const [holidayForm, setHolidayForm] = useState(emptyHoliday);
  const [holidayError, setHolidayError] = useState('');
  const [holidaySaving, setHolidaySaving] = useState(false);
  const [holidayYear, setHolidayYear] = useState(new Date().getFullYear().toString());

  useEffect(() => {
    loadSettings();
    loadHolidays();
  }, []);

  useEffect(() => {
    loadHolidays();
  }, [holidayYear]);

  const loadSettings = async () => {
    try {
      const data = await apiFetch('/settings');
      setSettings((prev) => ({ ...prev, ...data, smtp_password: '' }));
      setHasExistingPassword(!!data.smtp_password);
      setSmtpPasswordChanged(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadHolidays = async () => {
    try {
      const data = await apiFetch(`/holidays?year=${holidayYear}`);
      setHolidays(data);
    } catch (e) {
      console.error('Failed to load holidays:', e);
    }
  };

  const openAddHoliday = () => {
    setHolidayForm({ ...emptyHoliday, date: `${holidayYear}-01-01` });
    setHolidayError('');
    setHolidayModal('add');
  };

  const openEditHoliday = (holiday) => {
    setHolidayForm({ ...holiday });
    setHolidayError('');
    setHolidayModal('edit');
  };

  const handleHolidaySubmit = async (e) => {
    e.preventDefault();
    if (!holidayForm.name.trim() || !holidayForm.date) {
      setHolidayError('Name and date are required');
      return;
    }
    setHolidaySaving(true);
    setHolidayError('');
    try {
      if (holidayModal === 'add') {
        await apiFetch('/holidays', { method: 'POST', body: holidayForm });
      } else {
        await apiFetch(`/holidays/${holidayForm.id}`, { method: 'PUT', body: holidayForm });
      }
      await loadHolidays();
      setHolidayModal(null);
    } catch (e) {
      setHolidayError(e.message);
    } finally {
      setHolidaySaving(false);
    }
  };

  const handleDeleteHoliday = async (id) => {
    if (!window.confirm('Delete this holiday?')) return;
    try {
      await apiFetch(`/holidays/${id}`, { method: 'DELETE' });
      await loadHolidays();
    } catch (e) {
      alert('Error: ' + e.message);
    }
  };

  const formatHolidayDate = (dateStr) => {
    if (!dateStr) return '';
    return new Date(dateStr.split('T')[0] + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const handleChange = (key, value) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleLogoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file');
      return;
    }

    // Validate file size (max 500KB for base64 storage)
    if (file.size > 500 * 1024) {
      setError('Image must be less than 500KB');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result;
      if (base64) {
        handleChange('company_logo', base64);
        setError('');
      }
    };
    reader.onerror = () => {
      setError('Failed to read image file');
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveLogo = () => {
    handleChange('company_logo', '');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      // Only include smtp_password if it was changed
      const dataToSave = { ...settings };
      if (!smtpPasswordChanged) {
        delete dataToSave.smtp_password;
      }
      await apiFetch('/settings', { method: 'PUT', body: dataToSave });
      setSuccess('Settings saved successfully!');
      if (smtpPasswordChanged && settings.smtp_password) {
        setHasExistingPassword(true);
        setSmtpPasswordChanged(false);
        setSettings(prev => ({ ...prev, smtp_password: '' }));
      }
      setTimeout(() => setSuccess(''), 3000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ padding: 40, color: '#94a3b8' }}>Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Settings</div>
          <div className="page-subtitle">Configure your company information</div>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-title">Company Information</div>
          <p style={{ color: '#64748b', fontSize: 14, marginBottom: 20 }}>
            This information appears on your invoices.
          </p>

          {error && <div className="alert alert-error">{error}</div>}
          {success && <div className="alert alert-success">{success}</div>}

          <div className="form-group">
            <label className="form-label">Company Logo</label>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
              {settings.company_logo ? (
                <div style={{ position: 'relative' }}>
                  <img
                    src={settings.company_logo}
                    alt="Company Logo"
                    style={{
                      maxWidth: 200,
                      maxHeight: 80,
                      objectFit: 'contain',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      padding: 8,
                      background: 'white',
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleRemoveLogo}
                    className="btn btn-danger btn-sm"
                    style={{ marginTop: 8 }}
                  >
                    Remove Logo
                  </button>
                </div>
              ) : (
                <div
                  style={{
                    width: 200,
                    height: 80,
                    border: '2px dashed var(--border)',
                    borderRadius: 8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#94a3b8',
                    fontSize: 13,
                  }}
                >
                  No logo uploaded
                </div>
              )}
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleLogoUpload}
                  style={{ display: 'none' }}
                  id="logo-upload"
                />
                <label htmlFor="logo-upload" className="btn btn-secondary" style={{ cursor: 'pointer' }}>
                  {settings.company_logo ? 'Change Logo' : 'Upload Logo'}
                </label>
                <div className="form-hint" style={{ marginTop: 8 }}>
                  PNG or JPG, max 500KB. Recommended: 200x80px
                </div>
              </div>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Company Name</label>
            <input
              className="form-input"
              value={settings.company_name}
              onChange={(e) => handleChange('company_name', e.target.value)}
              placeholder="Your Company Name"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Street Address</label>
            <input
              className="form-input"
              value={settings.company_address}
              onChange={(e) => handleChange('company_address', e.target.value)}
              placeholder="123 Main Street"
            />
          </div>

          <div className="form-group">
            <label className="form-label">City, State ZIP</label>
            <input
              className="form-input"
              value={settings.company_city_state_zip}
              onChange={(e) => handleChange('company_city_state_zip', e.target.value)}
              placeholder="City, State 12345"
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Phone</label>
              <input
                className="form-input"
                value={settings.company_phone}
                onChange={(e) => handleChange('company_phone', e.target.value)}
                placeholder="(555) 123-4567"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Fax</label>
              <input
                className="form-input"
                value={settings.company_fax}
                onChange={(e) => handleChange('company_fax', e.target.value)}
                placeholder="(555) 123-4568"
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              className="form-input"
              type="email"
              value={settings.company_email}
              onChange={(e) => handleChange('company_email', e.target.value)}
              placeholder="billing@yourcompany.com"
            />
          </div>
        </div>

        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-title">Invoice Settings</div>

          <div className="form-group">
            <label className="form-label">Next Invoice Number</label>
            <input
              className="form-input"
              type="number"
              value={settings.next_invoice_number}
              onChange={(e) => handleChange('next_invoice_number', e.target.value)}
              placeholder="1000"
              style={{ maxWidth: 200 }}
            />
            <div className="form-hint">The next invoice will use this number (auto-increments after each invoice)</div>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-title">Holiday Pay Settings</div>
          <p style={{ color: '#64748b', fontSize: 14, marginBottom: 20 }}>
            Configure paid holidays for engineers. Eligible engineers will automatically receive holiday pay in the payroll report.
          </p>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
            <select
              className="form-select"
              value={holidayYear}
              onChange={(e) => setHolidayYear(e.target.value)}
              style={{ width: 120 }}
            >
              {[0, 1, 2, 3, 4].map(offset => {
                const year = new Date().getFullYear() + 1 - offset;
                return <option key={year} value={year}>{year}</option>;
              })}
            </select>
            <button className="btn btn-primary btn-sm" onClick={openAddHoliday}>+ Add Holiday</button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={async () => {
                if (!window.confirm(`Add common US holidays for ${holidayYear}?`)) return;
                const usHolidays = [
                  { name: "New Year's Day", date: `${holidayYear}-01-01`, hours: 8 },
                  { name: "Memorial Day", date: getMemorialDay(parseInt(holidayYear)), hours: 8 },
                  { name: "Independence Day", date: `${holidayYear}-07-04`, hours: 8 },
                  { name: "Labor Day", date: getLaborDay(parseInt(holidayYear)), hours: 8 },
                  { name: "Thanksgiving Day", date: getThanksgiving(parseInt(holidayYear)), hours: 8 },
                  { name: "Christmas Day", date: `${holidayYear}-12-25`, hours: 8 },
                ];
                for (const h of usHolidays) {
                  try {
                    await apiFetch('/holidays', { method: 'POST', body: h });
                  } catch (e) {
                    // Ignore duplicates
                  }
                }
                await loadHolidays();
              }}
            >
              Add US Holidays
            </button>
          </div>

          {holidays.length === 0 ? (
            <div style={{ padding: '24px 0', textAlign: 'center', color: '#94a3b8' }}>
              No holidays defined for {holidayYear}
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Holiday Name</th>
                    <th>Date</th>
                    <th>Hours</th>
                    <th style={{ width: 140 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {holidays.map((h) => (
                    <tr key={h.id}>
                      <td><strong>{h.name}</strong></td>
                      <td>{formatHolidayDate(h.date)}</td>
                      <td style={{ fontFamily: 'DM Mono, monospace' }}>{h.hours}</td>
                      <td>
                        <button className="btn btn-secondary btn-sm" onClick={() => openEditHoliday(h)} style={{ marginRight: 8 }}>Edit</button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDeleteHoliday(h.id)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="form-hint" style={{ marginTop: 12 }}>
            To make an engineer eligible for holiday pay, edit them on the Users page and enable "Holiday Pay" with a rate.
          </div>
        </div>

        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-title">Email Notifications</div>
          <p style={{ color: '#64748b', fontSize: 14, marginBottom: 20 }}>
            Get notified when engineers submit timesheets. Uses Gmail/Google Workspace SMTP.
          </p>

          <div className="form-group">
            <label className="form-label">Send Notifications To</label>
            <input
              className="form-input"
              type="email"
              value={settings.admin_notification_email}
              onChange={(e) => handleChange('admin_notification_email', e.target.value)}
              placeholder="admin@yourcompany.com"
            />
            <div className="form-hint">Email address that will receive timesheet notifications</div>
          </div>

          <div className="form-group">
            <label className="form-label">SMTP Email (Sender)</label>
            <input
              className="form-input"
              type="email"
              value={settings.smtp_email}
              onChange={(e) => handleChange('smtp_email', e.target.value)}
              placeholder="noreply@yourcompany.com"
            />
            <div className="form-hint">Gmail/Google Workspace email used to send notifications</div>
          </div>

          <div className="form-group">
            <label className="form-label">SMTP App Password</label>
            <input
              className="form-input"
              type="password"
              value={settings.smtp_password}
              onChange={(e) => {
                handleChange('smtp_password', e.target.value);
                setSmtpPasswordChanged(true);
              }}
              placeholder={hasExistingPassword ? '••••••••••••••••  (saved - leave blank to keep)' : 'Enter App Password'}
            />
            {hasExistingPassword && !smtpPasswordChanged && (
              <div style={{ color: '#10b981', fontSize: 12, marginTop: 4 }}>✓ Password saved</div>
            )}
            {smtpPasswordChanged && settings.smtp_password && (
              <div style={{ color: '#f59e0b', fontSize: 12, marginTop: 4 }}>New password will be saved</div>
            )}
            <div className="form-hint">
              Generate an App Password at{' '}
              <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer">
                Google Account → App Passwords
              </a>
              {' '}(requires 2-factor auth enabled)
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 16 }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={async () => {
                try {
                  const result = await apiFetch('/test-email', { method: 'POST' });
                  alert(result.message || 'Test email sent!');
                } catch (e) {
                  alert('Error: ' + e.message);
                }
              }}
            >
              Send Test Email
            </button>
            <div className="form-hint" style={{ marginTop: 8 }}>
              Save your settings first, then click to send a test email to verify your configuration.
            </div>
          </div>
        </div>

        <button className="btn btn-primary" type="submit" disabled={saving}>
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </form>

      <div className="card" style={{ marginTop: 20 }}>
        <div className="card-title">Company Data Management</div>
        <p style={{ color: '#64748b', fontSize: 14, marginBottom: 16 }}>
          Backup your data, restore from a backup, or start a new company.
        </p>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
          {/* Backup Button */}
          <button
            className="btn btn-secondary"
            onClick={async () => {
              try {
                const response = await apiFetch('/backup');
                const blob = new Blob([JSON.stringify(response, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `timetracker-backup-${new Date().toISOString().split('T')[0]}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
              } catch (e) {
                alert('Backup failed: ' + e.message);
              }
            }}
          >
            Download Backup
          </button>

          {/* Restore Button */}
          <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
            Restore from Backup
            <input
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;

                if (!window.confirm('This will replace ALL current data with the backup. Your current data will be lost. Continue?')) {
                  e.target.value = '';
                  return;
                }

                try {
                  const text = await file.text();
                  const backup = JSON.parse(text);
                  const result = await apiFetch('/restore', { method: 'POST', body: { backup } });
                  alert(result.message || 'Restore completed!');
                  window.location.reload();
                } catch (err) {
                  alert('Error: ' + err.message);
                }
                e.target.value = '';
              }}
            />
          </label>
        </div>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <div style={{ color: '#dc2626', fontWeight: 600, marginBottom: 8 }}>Danger Zone</div>
          <p style={{ color: '#64748b', fontSize: 14, marginBottom: 12 }}>
            Start a new company by clearing all data. This cannot be undone - download a backup first!
          </p>
          <button
            className="btn btn-danger"
            onClick={async () => {
              const confirm1 = window.confirm('Are you sure you want to delete ALL company data? This cannot be undone!');
              if (!confirm1) return;

              const confirm2 = window.prompt('Type "RESET" to confirm you want to delete all data:');
              if (confirm2 !== 'RESET') {
                alert('Reset cancelled.');
                return;
              }

              try {
                const result = await apiFetch('/reset-company', { method: 'POST', body: { confirm: 'RESET' } });
                alert(result.message || 'Company reset successfully!');
                window.location.reload();
              } catch (e) {
                alert('Error: ' + e.message);
              }
            }}
          >
            Reset Company (Delete All Data)
          </button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <div className="card-title">Demo Data</div>
        <p style={{ color: '#64748b', fontSize: 14, marginBottom: 16 }}>
          Generate sample customers, projects, engineers, timesheets, and invoices to test the system.
        </p>
        <button
          className="btn btn-secondary"
          onClick={async () => {
            if (!window.confirm('This will create sample customers, projects, engineers, timesheets, and 50+ unpaid invoices. Continue?')) return;
            try {
              const result = await apiFetch('/seed-demo-data', { method: 'POST' });
              alert(result.message || 'Demo data created successfully!');
              window.location.reload();
            } catch (e) {
              alert('Error: ' + e.message);
            }
          }}
        >
          Generate Demo Data
        </button>
      </div>

      {/* Holiday Modal */}
      {(holidayModal === 'add' || holidayModal === 'edit') && (
        <Modal
          title={holidayModal === 'add' ? 'Add Holiday' : 'Edit Holiday'}
          onClose={() => setHolidayModal(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setHolidayModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleHolidaySubmit} disabled={holidaySaving}>
                {holidaySaving ? 'Saving...' : 'Save'}
              </button>
            </>
          }
        >
          <form onSubmit={handleHolidaySubmit}>
            {holidayError && <div className="alert alert-error">{holidayError}</div>}
            <div className="form-group">
              <label className="form-label">Holiday Name *</label>
              <input
                className="form-input"
                value={holidayForm.name}
                onChange={(e) => setHolidayForm({ ...holidayForm, name: e.target.value })}
                placeholder="e.g., Christmas Day"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Date *</label>
              <input
                className="form-input"
                type="date"
                value={holidayForm.date}
                onChange={(e) => setHolidayForm({ ...holidayForm, date: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Hours</label>
              <input
                className="form-input"
                type="number"
                step="0.5"
                min="0"
                max="24"
                value={holidayForm.hours}
                onChange={(e) => setHolidayForm({ ...holidayForm, hours: parseFloat(e.target.value) || 8 })}
                style={{ width: 100 }}
              />
              <div className="form-hint">Number of hours paid for this holiday (default: 8)</div>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
