import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';

const MIN_PASSWORD_LENGTH = 8;

function goToSignIn() {
  window.location.replace(window.location.pathname);
}

// Opened from the welcome email: /?setup=<token>
export default function SetPassword({ token }) {
  const [account, setAccount] = useState(null);
  const [linkError, setLinkError] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    apiFetch(`/password-setup/${encodeURIComponent(token)}`)
      .then(setAccount)
      .catch((e) => setLinkError(e.message));
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Choose a password with at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('The two passwords don\'t match.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await apiFetch('/password-setup', { method: 'POST', body: { token, password } });
      setDone(true);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  const signInButton = (
    <button type="button" className="btn btn-primary" style={{ width: '100%', marginTop: 8, justifyContent: 'center', padding: '12px' }} onClick={goToSignIn}>
      Go to Sign In
    </button>
  );

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <h1><span>UTech</span> TimeTracker</h1>
          <p>Set your password</p>
        </div>
        {!account && !linkError && <p style={{ textAlign: 'center', color: '#64748b' }}>Checking your link…</p>}
        {linkError && (
          <>
            <div className="login-error">{linkError}</div>
            {signInButton}
          </>
        )}
        {account && done && (
          <>
            <p style={{ fontSize: 14 }}>Your password is set. Sign in with <strong>{account.email}</strong> and your new password.</p>
            {signInButton}
          </>
        )}
        {account && !done && (
          <form onSubmit={handleSubmit}>
            <p style={{ fontSize: 14, marginTop: 0 }}>Hi {account.name}. Choose a password for <strong>{account.email}</strong>.</p>
            {error && <div className="login-error">{error}</div>}
            <div className="form-group">
              <label className="form-label" htmlFor="new-password">New password</label>
              <input id="new-password" className="form-input" type="password" autoComplete="new-password" value={password}
                onChange={(e) => setPassword(e.target.value)} placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`} required autoFocus />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="confirm-password">Type it again</label>
              <input id="confirm-password" className="form-input" type="password" autoComplete="new-password" value={confirm}
                onChange={(e) => setConfirm(e.target.value)} required />
            </div>
            <button className="btn btn-primary" style={{ width: '100%', marginTop: 8, justifyContent: 'center', padding: '12px' }} disabled={saving}>
              {saving ? 'Saving…' : 'Set Password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
