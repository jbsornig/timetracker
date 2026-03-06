import React, { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../api';
import { useAuth } from '../contexts/AuthContext';

export default function Settings() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [settings, setSettings] = useState({
    company_name: '',
    company_address: '',
    company_city_state_zip: '',
    company_phone: '',
    company_fax: '',
    company_email: '',
    company_logo: '',
    next_invoice_number: '1000',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const fileInputRef = useRef(null);

  // Password change state
  const [passwordForm, setPasswordForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  });
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

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

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (passwordForm.new_password !== passwordForm.confirm_password) {
      setPasswordError('New passwords do not match');
      return;
    }
    if (passwordForm.new_password.length < 6) {
      setPasswordError('Password must be at least 6 characters');
      return;
    }

    setPasswordSaving(true);
    try {
      await apiFetch('/users/change-password', {
        method: 'PUT',
        body: {
          current_password: passwordForm.current_password,
          new_password: passwordForm.new_password,
        },
      });
      setPasswordSuccess('Password changed successfully!');
      setPasswordForm({ current_password: '', new_password: '', confirm_password: '' });
      setTimeout(() => setPasswordSuccess(''), 3000);
    } catch (e) {
      setPasswordError(e.message);
    } finally {
      setPasswordSaving(false);
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

        <button className="btn btn-primary" type="submit" disabled={saving}>
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </form>

      {/* Password Change Section - Available to all users */}
      <div className="card" style={{ marginTop: 20 }}>
        <div className="card-title">Change Password</div>
        <p style={{ color: '#64748b', fontSize: 14, marginBottom: 20 }}>
          Update your account password.
        </p>

        {passwordError && <div className="alert alert-error">{passwordError}</div>}
        {passwordSuccess && <div className="alert alert-success">{passwordSuccess}</div>}

        <form onSubmit={handlePasswordChange}>
          <div className="form-group">
            <label className="form-label">Current Password</label>
            <input
              className="form-input"
              type="password"
              value={passwordForm.current_password}
              onChange={(e) => setPasswordForm({ ...passwordForm, current_password: e.target.value })}
              required
              style={{ maxWidth: 300 }}
            />
          </div>

          <div className="form-group">
            <label className="form-label">New Password</label>
            <input
              className="form-input"
              type="password"
              value={passwordForm.new_password}
              onChange={(e) => setPasswordForm({ ...passwordForm, new_password: e.target.value })}
              required
              minLength={6}
              style={{ maxWidth: 300 }}
            />
            <div className="form-hint">Minimum 6 characters</div>
          </div>

          <div className="form-group">
            <label className="form-label">Confirm New Password</label>
            <input
              className="form-input"
              type="password"
              value={passwordForm.confirm_password}
              onChange={(e) => setPasswordForm({ ...passwordForm, confirm_password: e.target.value })}
              required
              style={{ maxWidth: 300 }}
            />
          </div>

          <button className="btn btn-primary" type="submit" disabled={passwordSaving}>
            {passwordSaving ? 'Changing...' : 'Change Password'}
          </button>
        </form>
      </div>
    </div>
  );
}
