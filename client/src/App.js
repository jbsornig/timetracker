import React, { useState, useEffect, useRef } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Timesheets from './pages/Timesheets';
import Customers from './pages/Customers';
import Projects from './pages/Projects';
import Engineers from './pages/Engineers';
import Invoices from './pages/Invoices';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import Account from './pages/Account';

const ENGINEER_PAGES = ['dashboard', 'timesheets', 'account'];
const ADMIN_PAGES = ['dashboard', 'timesheets', 'customers', 'projects', 'engineers', 'invoices', 'reports', 'settings'];

function AppInner() {
  const { user, loading } = useAuth();
  const [page, setPage] = useState('dashboard');
  const prevUserRef = useRef(null);

  // Reset to dashboard when user changes (login/logout/switch accounts)
  useEffect(() => {
    if (user && prevUserRef.current !== user.id) {
      setPage('dashboard');
      prevUserRef.current = user.id;
    }
    if (!user) {
      prevUserRef.current = null;
    }
  }, [user]);

  // Redirect engineer to dashboard if they're on an admin-only page
  useEffect(() => {
    if (user && user.role !== 'admin' && !ENGINEER_PAGES.includes(page)) {
      setPage('dashboard');
    }
  }, [user, page]);

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#64748b' }}>Loading…</div>;
  if (!user) return <Login />;

  const renderPage = () => {
    switch (page) {
      case 'dashboard': return <Dashboard setPage={setPage} />;
      case 'timesheets': return <Timesheets />;
      case 'customers': return <Customers />;
      case 'projects': return <Projects />;
      case 'engineers': return <Engineers />;
      case 'invoices': return <Invoices />;
      case 'reports': return <Reports />;
      case 'settings': return <Settings />;
      case 'account': return <Account />;
      default: return <Dashboard setPage={setPage} />;
    }
  };

  return (
    <Layout page={page} setPage={setPage}>
      {renderPage()}
    </Layout>
  );
}

export default function App() {
  return <AuthProvider><AppInner /></AuthProvider>;
}
