import React, { useState } from 'react';
import { apiFetch } from '../api';

const SENT_LABEL_MS = 4000;

export async function sendWelcomeEmail(userId) {
  return apiFetch(`/users/${userId}/welcome-email`, { method: 'POST' });
}

// Emails the user a one-time link to set their password, after the admin confirms.
export default function WelcomeEmailButton({ user, className = 'btn btn-secondary btn-sm', style }) {
  const [state, setState] = useState('idle');

  const handleClick = async () => {
    if (!user.email) {
      window.alert(`${user.name} has no email address. Add one first.`);
      return;
    }
    const confirmed = window.confirm(
      `Send a welcome email to ${user.name} at ${user.email}?\n\nIt explains how to sign in and has a link to set their password. Any earlier link stops working.`,
    );
    if (!confirmed) return;
    setState('sending');
    try {
      await sendWelcomeEmail(user.id);
      setState('sent');
      setTimeout(() => setState('idle'), SENT_LABEL_MS);
    } catch (error) {
      setState('idle');
      window.alert(`The welcome email was not sent: ${error.message}`);
    }
  };

  const label = state === 'sending' ? 'Sending...' : state === 'sent' ? 'Sent ✓' : 'Welcome Email';
  return (
    <button type="button" className={className} style={style} onClick={handleClick} disabled={state === 'sending'}
      title="Email sign-in instructions and a link to set their password">
      {label}
    </button>
  );
}
