import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import GridBlocks from '../components/ui/GridBlocks';
import { setSession, clearAuth } from '../lib/auth';
import { api } from '../lib/api';
import '../index.css';

function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const hash = window.location.hash || '';
    let token = '';
    const qIndex = hash.indexOf('?');
    if (qIndex !== -1) {
      token = new URLSearchParams(hash.slice(qIndex + 1)).get('auth_token') || '';
    }
    if (!token) {
      const match = hash.match(/auth_token=([^&]+)/);
      if (match) token = decodeURIComponent(match[1]);
    }
    if (!token) return;
    setSession({ authToken: token });
    window.location.replace(`${window.location.pathname}${window.location.search}#/dashboard`);
  }, []);

  const handleLogin = async (e) => {
    e?.preventDefault?.();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      clearAuth();
      const res = await api.login({ email: email.trim(), password });
      if (!res.token) throw new Error('No token returned');
      setSession({
        authToken: res.token,
        userName: res.user?.displayName || '',
        userEmail: res.user?.email || email.trim(),
        userAvatar: res.user?.avatarUrl || ''
      });
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  const handleDemoLogin = () => {
    setSession({
      authToken: 'demo-token',
      userName: 'Demo User',
      userEmail: 'demo@example.com'
    });
    navigate('/dashboard', { replace: true });
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-form-side" style={{ position: 'relative' }}>
        <div style={{ position: 'absolute', top: '40px', left: '40px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: '8px',
            background: '#0f172a',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: '15px'
          }}>
            S
          </div>
          <span style={{ fontSize: '16px', fontWeight: 600, color: '#0f172a', letterSpacing: '-0.02em' }}>
            SaaS App
          </span>
        </div>

        <div className="auth-form-container">
          <h1 className="auth-title">Welcome back</h1>
          <p className="auth-subtitle">Sign in to your account</p>

          <form className="auth-form" onSubmit={handleLogin}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="auth-input"
              placeholder="Email address"
              autoComplete="email"
              required
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="auth-input"
              placeholder="Password"
              autoComplete="current-password"
              required
              style={{ marginTop: 10 }}
            />
            {error ? (
              <p style={{ margin: '10px 0 0', fontSize: 13, color: '#DC2626' }}>{error}</p>
            ) : null}
            <button className="auth-btn-primary" type="submit" disabled={busy} style={{ marginTop: 14 }}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <button
              type="button"
              onClick={handleDemoLogin}
              style={{
                marginTop: 10,
                width: '100%',
                padding: '10px 16px',
                borderRadius: '8px',
                border: '1px solid var(--border-light, #e2e8f0)',
                background: 'transparent',
                color: 'var(--text-main, #0f172a)',
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer'
              }}
            >
              Continue with Demo
            </button>
          </form>

          <div className="auth-switch-link">
            Don&apos;t have an account? <span onClick={() => navigate('/signup')}>Sign up</span>
          </div>
         
        </div>

        <footer className="auth-footer">
          <a href="#">Privacy</a>
          <a href="#">Terms</a>
        </footer>
      </div>

      <div className="auth-brand-side" style={{ position: 'relative' }}>
        <GridBlocks />
        <div className="auth-brand-content" style={{ position: 'relative', zIndex: 1 }}>
          <h2 className="auth-brand-title">Scale your product with confidence.</h2>
          <p className="auth-brand-subtitle">
            Analytics, insights, and workspace management — all in one place.
          </p>
        </div>
      </div>
    </div>
  );
}

export default Login;
