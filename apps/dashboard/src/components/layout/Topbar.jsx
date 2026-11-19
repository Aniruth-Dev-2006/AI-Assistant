import React, { useState } from 'react';
import { Bell, Moon, Sun, X } from 'lucide-react';

const ICON_STROKE = 1.75;

export function Topbar({ isDark, toggleTheme }) {
  const [showNotifs, setShowNotifs] = useState(false);

  return (
    <header className="topbar" style={{ justifyContent: 'flex-end', position: 'relative' }}>

      <div className="topbar-actions">
        {/* Theme Toggle Button */}
        <button className="icon-btn" onClick={toggleTheme} data-tooltip="Toggle Theme">
          {isDark ? <Sun size={18} strokeWidth={ICON_STROKE} /> : <Moon size={18} strokeWidth={ICON_STROKE} />}
        </button>

        <div style={{ position: 'relative' }}>
          <button 
            className="icon-btn" 
            data-tooltip="Notifications"
            onClick={() => setShowNotifs(!showNotifs)}
          >
            <Bell size={18} strokeWidth={ICON_STROKE} />
            <div className="notification-badge">3</div>
          </button>
          
          {showNotifs && (
            <div style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: '8px',
              width: '320px',
              background: 'var(--bg-card)',
              border: '1px solid var(--border-light)',
              borderRadius: 'var(--radius-md)',
              boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)',
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
                <button onClick={() => setShowNotifs(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                  <X size={16} />
                </button>
              </div>
              <div style={{ padding: '8px 0', maxHeight: '300px', overflowY: 'auto' }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-light)', cursor: 'pointer' }}>
                  <p style={{ fontSize: '13px', fontWeight: 500, margin: '0 0 4px 0' }}>Meeting Completed</p>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>Your meeting with John Doe is ready to review.</p>
                </div>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-light)', cursor: 'pointer' }}>
                  <p style={{ fontSize: '13px', fontWeight: 500, margin: '0 0 4px 0' }}>Action Items Extracted</p>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>3 new action items from Marketing Sync.</p>
                </div>
                <div style={{ padding: '12px 16px', cursor: 'pointer' }}>
                  <p style={{ fontSize: '13px', fontWeight: 500, margin: '0 0 4px 0' }}>Integration Connected</p>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>Google Calendar successfully linked.</p>
                </div>
              </div>
              <div style={{ padding: '10px', background: 'var(--bg-muted)', textAlign: 'center', borderTop: '1px solid var(--border-light)', cursor: 'pointer', fontSize: '12px', color: 'var(--primary)', fontWeight: 600 }}>
                Mark all as read
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
