import React from 'react';
import { useAuth } from '../contexts/AuthContext';

const Icons = {
  users: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>,
  building: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  chart: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  settings: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
  logout: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
  chevron: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>,
};

export default function More({ setPage }) {
  const { user, logout } = useAuth();

  const menuItems = [
    { key: 'customers', label: 'Customers', icon: Icons.building, description: 'Manage customer accounts' },
    { key: 'engineers', label: 'Users', icon: Icons.users, description: 'Manage engineers and admins' },
    { key: 'reports', label: 'Reports', icon: Icons.chart, description: 'Payroll and project reports' },
    { key: 'settings', label: 'Settings', icon: Icons.settings, description: 'Company and system settings' },
  ];

  const initials = user?.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">More</div>
          <div className="page-subtitle">Additional options and settings</div>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
          <div style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--navy) 0%, var(--navy-light) 100%)',
            color: 'white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 600,
            fontSize: 16
          }}>
            {initials}
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 16 }}>{user?.name}</div>
            <div style={{ color: '#64748b', fontSize: 14, textTransform: 'capitalize' }}>{user?.role}</div>
          </div>
        </div>

        {menuItems.map((item) => (
          <button
            key={item.key}
            onClick={() => setPage(item.key)}
            style={{
              display: 'flex',
              alignItems: 'center',
              width: '100%',
              padding: '16px 0',
              background: 'none',
              border: 'none',
              borderBottom: '1px solid var(--border)',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <div style={{
              width: 40,
              height: 40,
              borderRadius: 8,
              background: 'var(--bg)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: 12,
              color: 'var(--navy)'
            }}>
              <span style={{ width: 20, height: 20 }}>{item.icon}</span>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500, fontSize: 15, color: 'var(--text)' }}>{item.label}</div>
              <div style={{ fontSize: 13, color: '#64748b' }}>{item.description}</div>
            </div>
            <span style={{ width: 20, height: 20, color: '#94a3b8' }}>{Icons.chevron}</span>
          </button>
        ))}

        <button
          onClick={logout}
          style={{
            display: 'flex',
            alignItems: 'center',
            width: '100%',
            padding: '16px 0',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            textAlign: 'left',
            marginTop: 8,
          }}
        >
          <div style={{
            width: 40,
            height: 40,
            borderRadius: 8,
            background: '#fef2f2',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: 12,
            color: 'var(--danger)'
          }}>
            <span style={{ width: 20, height: 20 }}>{Icons.logout}</span>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 500, fontSize: 15, color: 'var(--danger)' }}>Sign Out</div>
            <div style={{ fontSize: 13, color: '#64748b' }}>Log out of your account</div>
          </div>
        </button>
      </div>
    </div>
  );
}
