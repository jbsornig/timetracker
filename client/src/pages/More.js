import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Icons, getMorePageItems } from '../components/navigation';

export default function More({ setPage }) {
  const { user, logout } = useAuth();

  const menuItems = getMorePageItems();

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
