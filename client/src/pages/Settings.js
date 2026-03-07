import React, { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../api';

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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const data = await apiFetch('/settings');
      setSettings((prev) => ({ ...prev, ...data }));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
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
      await apiFetch('/settings', { method: 'PUT', body: settings });
      setSuccess('Settings saved successfully!');
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
              onChange={(e) => handleChange('smtp_password', e.target.value)}
              placeholder="••••••••••••••••"
            />
            <div className="form-hint">
              Generate an App Password at{' '}
              <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer">
                Google Account → App Passwords
              </a>
              {' '}(requires 2-factor auth enabled)
            </div>
          </div>
        </div>

        <button className="btn btn-primary" type="submit" disabled={saving}>
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </form>
    </div>
  );
}
