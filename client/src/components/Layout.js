import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Icons, ADMIN_NAV, ENGINEER_NAV, getPhoneBar } from './navigation';

export default function Layout({ page, setPage, children }) {
  const { user, logout } = useAuth();

  const initials = user?.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const isAdmin = user?.role === 'admin';
  const navItems = isAdmin ? ADMIN_NAV : ENGINEER_NAV;
  const phoneBarItems = getPhoneBar(isAdmin);

  return (
    <div className="app-shell">
      {/* Mobile top header */}
      <header className="mobile-top-header">
        <h1><span>UTech</span> TimeTracker</h1>
      </header>

      {/* Sidebar - desktop only */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <h1><span>UTech</span> TimeTracker</h1>
          <p>Engineering Billing System</p>
        </div>
        <nav className="sidebar-nav">
          <div className="nav-section-title">Menu</div>
          {navItems.map(item => (
            <button key={item.key} className={`nav-item ${page === item.key ? 'active' : ''}`} onClick={() => setPage(item.key)}>
              {item.icon}{item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-avatar">{initials}</div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{user?.name}</div>
              <div className="sidebar-user-role">{user?.role}</div>
            </div>
          </div>
          <button className="nav-item" onClick={logout} style={{ marginTop: 4 }}>
            {Icons.logout} Sign Out
          </button>
        </div>
      </aside>

      <main className="main-content">{children}</main>

      {/* Mobile bottom navigation */}
      <nav className="mobile-nav">
        {phoneBarItems.map(item => (
          <button
            key={item.key}
            className={`mobile-nav-item ${page === item.key ? 'active' : ''}`}
            onClick={() => setPage(item.key)}
          >
            {item.icon}
            <span>{item.shortLabel || item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
