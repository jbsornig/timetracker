import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiFetch } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('tt_token');
    if (token) {
      apiFetch('/me').then(u => { setUser(u); setLoading(false); }).catch(() => { localStorage.removeItem('tt_token'); setLoading(false); });
    } else setLoading(false);
  }, []);

  const login = async (email, password) => {
    const data = await apiFetch('/login', { method: 'POST', body: { email, password } });
    localStorage.setItem('tt_token', data.token);
    setUser(data.user);
    return data.user;
  };

  const logout = () => { localStorage.removeItem('tt_token'); setUser(null); };

  return <AuthContext.Provider value={{ user, login, logout, loading }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
