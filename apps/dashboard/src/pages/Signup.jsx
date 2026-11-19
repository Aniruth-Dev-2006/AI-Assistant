import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import GridBlocks from '../components/ui/GridBlocks';
import { setSession, clearAuth } from '../lib/auth';
import { api } from '../lib/api';
import '../index.css';

function readInviteFromHash() {
  try {
    const hash = window.location.hash || '';
    const qIndex = hash.indexOf('?');
    if (qIndex === -1) return '';
    return new URLSearchParams(hash.slice(qIndex + 1)).get('invite') || '';
  } catch {
    return '';
  }
}

function Signup() {
  const navigate = useNavigate();
  const initialInvite = useMemo(() => readInviteFromHash(), []);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [inviteToken, setInviteToken] = useState(initialInvite);
  const [joiningInvite, setJoiningInvite] = useState(!!initialInvite);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleSignup = async (e) => {
    e?.preventDefault?.();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      clearAuth();
      const body = {
        email: email.trim(),
        password,
        displayName: displayName.trim(),
        organizationName: organizationName.trim()
      };
      if (joiningInvite && inviteToken.trim()) body.inviteToken = inviteToken.trim();
      const res = await api.register(body);
      if (!res.token) throw new Error('No token returned');
      setSession({
        authToken: res.token,
        userName: res.user?.displayName || displayName.trim(),
        userEmail: res.user?.email || email.trim(),
        userAvatar: res.user?.avatarUrl || ''
      });
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err.message || 'Signup failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrapper reverse">
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
          <h1 className="auth-title">Create an account</h1>
          <p className="auth-subtitle">
            {joiningInvite ? 'Join your team with an invite' : 'Create your workspace with email'}
          </p>

          <form className="auth-form" onSubmit={handleSignup}>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="auth-input"
              placeholder="Full name"
              autoComplete="name"
            />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="auth-input"
              placeholder="Work email"
              autoComplete="email"
              required
              style={{ marginTop: 10 }}
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="auth-input"
              placeholder="Password (min 8 characters)"
              autoComplete="new-password"
              required
              style={{ marginTop: 10 }}
            />
            {!joiningInvite ? (
              <input
                type="text"
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
                className="auth-input"
                placeholder="Organization / workspace name"
                style={{ marginTop: 10 }}
              />
            ) : (
              <input
                type="text"
                value={inviteToken}
                onChange={(e) => setInviteToken(e.target.value)}
                className="auth-input"
                placeholder="Invite token"
                required
                style={{ marginTop: 10 }}
              />
            )}
            <button
              type="button"
              onClick={() => setJoiningInvite((v) => !v)}
              style={{
                marginTop: 8,
                border: 'none',
                background: 'transparent',
                color: 'var(--text-muted)',
                fontSize: 12,
                cursor: 'pointer',
                padding: 0,
                textAlign: 'left'
              }}
            >
              {joiningInvite ? 'Create a new organization instead' : 'Have an invite token instead?'}
            </button>
            {error ? (
              <p style={{ margin: '10px 0 0', fontSize: 13, color: '#DC2626' }}>{error}</p>
            ) : null}
            <button className="auth-btn-primary" type="submit" disabled={busy} style={{ marginTop: 14 }}>
              {busy ? 'Creating…' : 'Create account'}
            </button>
          </form>

          <div className="auth-switch-link">
            Already have an account? <span onClick={() => navigate('/login')}>Sign in</span>
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
          <h2 className="auth-brand-title">Build faster with your team.</h2>
          <p className="auth-brand-subtitle">
            Analytics, insights, and workspace management — all in one place.
          </p>
        </div>
      </div>
    </div>
  );
}

export default Signup;
