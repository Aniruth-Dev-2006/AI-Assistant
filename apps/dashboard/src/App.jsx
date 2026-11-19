import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Inbox, X, Sparkles } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import Signup from './pages/Signup';
import NotificationToast from './components/dashboard/NotificationToast';
import { isAuthenticated, purgeInvalidAuth, setSession } from './lib/auth';
import { api } from './lib/api';
import './index.css';

purgeInvalidAuth();

function consumeAuthTokenFromUrl() {
  const hash = window.location.hash || '';
  const qIndex = hash.indexOf('?');
  if (qIndex !== -1) {
    const params = new URLSearchParams(hash.slice(qIndex + 1));
    const token = params.get('auth_token');
    if (token) {
      setSession({ authToken: decodeURIComponent(token) });
      const path = hash.slice(1, qIndex) || '/dashboard';
      const cleanPath = path.startsWith('/') ? path : `/${path}`;
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${cleanPath}`);
      return true;
    }
  }
  const legacy = hash.match(/^#?\/?auth_token=([^&]+)/) || hash.match(/[#&?]auth_token=([^&]+)/);
  if (legacy && legacy[1] && !hash.includes('/login') && !hash.includes('/dashboard')) {
    if (/^#auth_token=/.test(hash) || /^#\/auth_token=/.test(hash)) {
      setSession({ authToken: decodeURIComponent(legacy[1]) });
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/dashboard`);
      return true;
    }
  }
  if (/^#auth_token=/.test(hash)) {
    const token = decodeURIComponent(hash.replace(/^#auth_token=/, '').split('&')[0]);
    if (token) {
      setSession({ authToken: token });
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/dashboard`);
      return true;
    }
  }
  return false;
}

consumeAuthTokenFromUrl();

function TitleBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [showNotifs, setShowNotifs] = useState(false);
  const isAuthPage = ['/login', '/signup', '/'].includes(location.pathname);
  
  const notifRef = React.useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (notifRef.current && !notifRef.current.contains(event.target)) {
        setShowNotifs(false);
      }
    }
    if (showNotifs) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showNotifs]);

  const testNotification = () => {
    const data = {
      title: 'Workspace Update',
      timeContext: 'Just now',
      mainParticipant: 'System',
      otherParticipants: '',
      joinUrl: '#'
    };

    if (window.electronAPI && window.electronAPI.showCustomNotification) {
      window.electronAPI.showCustomNotification(data);
    } else {
      console.log('Electron API not found - notification test triggered', data);
    }
    setShowNotifs(false);
  };

  return (
    <div className="flex items-center justify-between relative z-[9999] border-b border-[var(--border-light)] bg-[var(--bg-panel)] px-4" style={{
      height: '38px',
      WebkitAppRegion: 'drag',
    }}>
      <div style={{ display: 'flex', gap: '4px', WebkitAppRegion: 'no-drag', width: '100px' }}>
        {!isAuthPage && (
          <>
            <button type="button" className="titlebar-btn" onClick={() => navigate(-1)} title="Back">
              <ArrowLeft size={12} />
            </button>
            <button type="button" className="titlebar-btn" onClick={() => navigate(1)} title="Forward">
              <ArrowRight size={12} />
            </button>
          </>
        )}
      </div>

      <div style={{
        fontSize: '12px',
        fontWeight: 600,
        letterSpacing: '0.5px',
        color: 'var(--text-muted)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'absolute',
        left: '50%',
        transform: 'translateX(-50%)'
      }}>
        SaaS Template
      </div>

      <div style={{ position: 'absolute', right: '240px', top: 0, height: '100%', display: 'flex', alignItems: 'center', gap: '8px', WebkitAppRegion: 'no-drag' }}>
        {!isAuthPage && (
          <>
            <button
              type="button"
              onClick={() => {
                if (window.electronAPI?.launchAssist) {
                  window.electronAPI.launchAssist({ title: 'Ad-hoc Meeting Assist' });
                }
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 12px',
                borderRadius: '100px',
                border: 'none',
                background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
                color: '#ffffff',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(37, 99, 235, 0.4)',
                letterSpacing: '0.2px'
              }}
              title="Launch Dynamic Island Overlay"
            >
              <Sparkles size={12} color="#ffffff" />
              Launch Assist
            </button>
            <div ref={notifRef} style={{ position: 'relative' }}>
            <button
              type="button"
              className="icon-btn"
              style={{ width: '24px', height: '24px', background: 'transparent' }}
              onClick={() => setShowNotifs(!showNotifs)}
            >
              <Inbox size={14} color="var(--text-muted)" />
            </button>

            {showNotifs && (
              <div style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: '8px',
                width: '320px',
                background: 'var(--bg-panel)',
                border: '1px solid var(--border-light)',
                borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-lg)',
                zIndex: 100,
                overflow: 'hidden'
              }}>
                <div style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--border-light)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <h3 style={{ fontSize: '14px', fontWeight: 600, margin: 0 }}>Notifications</h3>
                  <button type="button" onClick={() => setShowNotifs(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                    <X size={16} />
                  </button>
                </div>
                <div style={{ padding: '16px', fontSize: '13px', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <p style={{ margin: 0 }}>No notifications yet. Report-ready alerts will appear here.</p>
                </div>
              </div>
            )}
          </div>
          </>
        )}
      </div>
    </div>
  );
}

function App() {
  const location = useLocation();
  const [authed, setAuthed] = useState(() => isAuthenticated());

  useEffect(() => {
    setAuthed(isAuthenticated());
  }, [location.pathname, location.key]);

  useEffect(() => {
    const sync = () => setAuthed(isAuthenticated());
    window.addEventListener('xobin:auth', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('xobin:auth', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  // Auto-launch assist when scheduled meeting time is reached
  useEffect(() => {
    if (!authed) return;
    const notified = new Set();
    const interval = setInterval(async () => {
      try {
        const res = await api.getUpcomingMeetings?.();
        const meetings = res?.meetings || [];
        const now = Date.now();
        const startingMeeting = meetings.find((m) => {
          if (!m.startTime || notified.has(m.id)) return false;
          const diff = Math.abs(new Date(m.startTime).getTime() - now);
          return diff < 60000; // Starting within 60 seconds
        });
        if (startingMeeting) {
          notified.add(startingMeeting.id);
          if (window.electronAPI?.launchAssist) {
            window.electronAPI.launchAssist({
              title: startingMeeting.title || startingMeeting.jobRole,
              candidateName: startingMeeting.candidateName || '',
              meetingUrl: startingMeeting.meetingUrl || ''
            });
          }
        }
      } catch (e) {
        // Safe no-op when running without backend
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [authed]);

  return (
    <div className="app-container" style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      <Routes>
        <Route path="/notification-toast" element={<NotificationToast />} />
        <Route path="*" element={
          <>
            <TitleBar />
            <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
              <Routes>
                <Route path="/" element={<Navigate to={authed ? '/dashboard' : '/login'} replace />} />
                <Route path="/login" element={authed ? <Navigate to="/dashboard" replace /> : <Login />} />
                <Route path="/signup" element={authed ? <Navigate to="/dashboard" replace /> : <Signup />} />
                <Route path="/dashboard" element={authed ? <Dashboard /> : <Navigate to="/login" replace />} />
                <Route path="*" element={<Navigate to={authed ? '/dashboard' : '/login'} replace />} />
              </Routes>
            </div>
          </>
        } />
      </Routes>
    </div>
  );
}

export default App;
