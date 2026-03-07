import React from 'react';
import { useAuth } from '../contexts/AuthContext';

const Icons = {
  dashboard: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>,
  clock: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  dollar: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>,
  users: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>,
  folder: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>,
  building: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  invoice: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,
  chart: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  settings: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
  logout: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
  menu: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>,
};

export default function Layout({ page, setPage, children }) {
  const { user, logout } = useAuth();

  const initials = user?.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  const navEngineer = [
    { key: 'dashboard', label: 'Dashboard', icon: Icons.dashboard },
    { key: 'timesheets', label: 'My Timesheets', icon: Icons.clock },
    { key: 'earnings', label: 'My Earnings', icon: Icons.dollar },
    { key: 'account', label: 'My Account', icon: Icons.settings },
  ];

  const navAdmin = [
    { key: 'dashboard', label: 'Dashboard', icon: Icons.dashboard },
    { key: 'timesheets', label: 'Timesheets', icon: Icons.clock },
    { key: 'customers', label: 'Customers', icon: Icons.building },
    { key: 'projects', label: 'Projects', icon: Icons.folder },
    { key: 'engineers', label: 'Users', icon: Icons.users },
    { key: 'invoices', label: 'Invoices', icon: Icons.invoice },
    { key: 'reports', label: 'Reports', icon: Icons.chart },
    { key: 'settings', label: 'Settings', icon: Icons.settings },
  ];

  const navItems = user?.role === 'admin' ? navAdmin : navEngineer;

  const nav = (key) => { setPage(key); };

  // Mobile nav items (simplified)
  const mobileNavEngineer = [
    { key: 'dashboard', label: 'Home', icon: Icons.dashboard },
    { key: 'timesheets', label: 'Time', icon: Icons.clock },
    { key: 'earnings', label: 'Earnings', icon: Icons.dollar },
    { key: 'account', label: 'Account', icon: Icons.settings },
  ];

  const mobileNavAdmin = [
    { key: 'dashboard', label: 'Home', icon: Icons.dashboard },
    { key: 'timesheets', label: 'Time', icon: Icons.clock },
    { key: 'projects', label: 'Projects', icon: Icons.folder },
    { key: 'invoices', label: 'Invoices', icon: Icons.invoice },
    { key: 'settings', label: 'More', icon: Icons.settings },
  ];

  const mobileNavItems = user?.role === 'admin' ? mobileNavAdmin : mobileNavEngineer;

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
            <button key={item.key} className={`nav-item ${page === item.key ? 'active' : ''}`} onClick={() => nav(item.key)}>
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
        {mobileNavItems.map(item => (
          <button
            key={item.key}
            className={`mobile-nav-item ${page === item.key ? 'active' : ''}`}
            onClick={() => nav(item.key)}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
