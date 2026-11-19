import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, Calendar, BarChart3, PieChart,
  Settings, Link2, HelpCircle, LogOut, Search, ChevronDown, Moon, Sun, PanelLeftClose, PanelLeftOpen
} from 'lucide-react';
import { getProfileLocal, clearAuth } from '../../lib/auth';

const ICON_SIZE = 16;
const ICON_STROKE = 1.75;

function avatarSrc(name, url) {
  if (url && url !== 'null' && url !== 'undefined') return url;
  const safeName = (name || 'Account').replace(/[^a-zA-Z0-9 ]/g, '').trim() || 'Account';
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(safeName)}&background=0D8ABC&color=fff`;
}

export function Sidebar({ isDark, toggleTheme, activeView, setActiveView, isCollapsed, onToggleCollapse }) {
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [profile, setProfile] = useState(() => getProfileLocal());

  useEffect(() => {
    const refresh = () => setProfile(getProfileLocal());
    window.addEventListener('xobin:profile', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('xobin:profile', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const userName = profile.displayName || 'Account';
  const photo = avatarSrc(userName, profile.avatarUrl);

  return (
    <aside className="sidebar h-full" style={{ 
      justifyContent: 'space-between', 
      padding: isCollapsed ? '24px 12px' : '24px 20px', 
      width: isCollapsed ? '80px' : '240px',
      transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        
        {/* Header section with profile & toggle */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: isCollapsed ? 'center' : 'space-between', 
          flexDirection: isCollapsed ? 'column' : 'row',
          marginBottom: '24px', 
          gap: isCollapsed ? '16px' : '8px' 
        }}>
          
          {/* Profile Dropdown */}
          <div 
            onClick={() => !isCollapsed && setShowProfileMenu(!showProfileMenu)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: isCollapsed ? 'center' : 'space-between',
              padding: '8px', borderRadius: 'var(--radius-sm)', cursor: isCollapsed ? 'default' : 'pointer',
              background: showProfileMenu ? 'var(--bg-muted)' : 'transparent',
              transition: 'background 0.2s ease', 
              margin: isCollapsed ? '0' : '-8px 0 0 -8px', 
              flex: 1, minWidth: 0, width: isCollapsed ? '100%' : 'auto'
            }}
            onMouseOver={(e) => { if(!showProfileMenu && !isCollapsed) e.currentTarget.style.background = 'var(--bg-muted)' }}
            onMouseOut={(e) => { if(!showProfileMenu) e.currentTarget.style.background = 'transparent' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, justifyContent: isCollapsed ? 'center' : 'flex-start', width: '100%' }}>
              <img 
                src={photo}
                alt="Avatar" 
                style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
              />
              <div style={{ minWidth: 0, display: isCollapsed ? 'none' : 'block' }}>
                <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {userName}
                </div>
                {profile.email ? (
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {profile.email}
                  </div>
                ) : null}
              </div>
            </div>
            {!isCollapsed && <ChevronDown size={14} color="var(--text-muted)" style={{ transform: showProfileMenu ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease', flexShrink: 0 }} />}
          </div>

          {/* Toggle Button */}
          <button 
            onClick={onToggleCollapse} 
            style={{ 
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', padding: '6px', borderRadius: '6px',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
            onMouseOver={(e) => e.currentTarget.style.background = 'var(--bg-muted)'}
            onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
          >
            {isCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>

        {/* Profile menu absolute popup */}
        {showProfileMenu && !isCollapsed && (
          <div style={{
            position: 'absolute', top: '70px', left: '20px', width: '200px',
            background: 'var(--bg-panel)', border: '1px solid var(--border-light)',
            borderRadius: 'var(--radius-md)', padding: '8px',
            boxShadow: 'var(--shadow-md)', zIndex: 50,
            display: 'flex', flexDirection: 'column', gap: '2px'
          }}>
            <div 
              className="nav-item" 
              style={{cursor: 'pointer'}} 
              onClick={() => { toggleTheme(); setShowProfileMenu(false); }}
            >
              {isDark ? <Sun size={ICON_SIZE} strokeWidth={ICON_STROKE}/> : <Moon size={ICON_SIZE} strokeWidth={ICON_STROKE}/>} 
              {isDark ? 'Light Mode' : 'Dark Mode'}
            </div>
            <div
              className="nav-item"
              style={{cursor: 'pointer'}}
              onClick={() => { setActiveView('settings'); setShowProfileMenu(false); }}
            >
              <Settings size={ICON_SIZE} strokeWidth={ICON_STROKE}/> Settings
            </div>
            <div
              className="nav-item"
              style={{cursor: 'pointer'}}
              onClick={() => { setActiveView('integrations'); setShowProfileMenu(false); }}
            >
              <Link2 size={ICON_SIZE} strokeWidth={ICON_STROKE}/> Integrations
            </div>
            <div className="nav-item" style={{cursor: 'pointer', opacity: 0.55}}>
              <HelpCircle size={ICON_SIZE} strokeWidth={ICON_STROKE}/> Support
            </div>
            <div style={{ height: '1px', background: 'var(--border-light)', margin: '4px 0' }} />
            <div 
              className="nav-item" 
              style={{cursor: 'pointer', color: '#ef4444'}}
              onClick={() => {
                clearAuth();
                window.location.href = '#/login';
                window.location.reload();
              }}
            >
              <LogOut size={ICON_SIZE} strokeWidth={ICON_STROKE}/> Log out
            </div>
          </div>
        )}
        


        <nav className="sidebar-nav" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div className={`nav-item ${activeView === 'overview' ? 'active' : ''}`} style={{cursor: 'pointer', fontSize: '13px', justifyContent: isCollapsed ? 'center' : 'flex-start', padding: isCollapsed ? '10px' : ''}} onClick={() => setActiveView('overview')}>
            <LayoutDashboard size={ICON_SIZE} strokeWidth={ICON_STROKE}/> 
            {!isCollapsed && <span>Dashboard</span>}
          </div>
          <div className={`nav-item ${activeView === 'insights' ? 'active' : ''}`} style={{cursor: 'pointer', fontSize: '13px', justifyContent: isCollapsed ? 'center' : 'flex-start', padding: isCollapsed ? '10px' : ''}} onClick={() => setActiveView('insights')}>
            <PieChart size={ICON_SIZE} strokeWidth={ICON_STROKE}/> 
            {!isCollapsed && <span>Insights</span>}
          </div>
          <div className={`nav-item ${activeView === 'meetings' ? 'active' : ''}`} style={{cursor: 'pointer', fontSize: '13px', justifyContent: isCollapsed ? 'center' : 'flex-start', padding: isCollapsed ? '10px' : ''}} onClick={() => setActiveView('meetings')}>
            <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={ICON_STROKE} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M4 10v4" />
              <path d="M8 6v12" />
              <path d="M12 3v18" />
              <path d="M16 7v10" />
              <path d="M20 11v2" />
            </svg>
            {!isCollapsed && <span>Meetings</span>}
          </div>
          <div className={`nav-item ${activeView === 'calendar' ? 'active' : ''}`} style={{cursor: 'pointer', fontSize: '13px', justifyContent: isCollapsed ? 'center' : 'flex-start', padding: isCollapsed ? '10px' : ''}} onClick={() => setActiveView('calendar')}>
            <Calendar size={ICON_SIZE} strokeWidth={ICON_STROKE}/> 
            {!isCollapsed && <span>Calendar</span>}
          </div>
          <div className={`nav-item ${activeView === 'reports' ? 'active' : ''}`} style={{cursor: 'pointer', fontSize: '13px', justifyContent: isCollapsed ? 'center' : 'flex-start', padding: isCollapsed ? '10px' : ''}} onClick={() => setActiveView('reports')}>
            <BarChart3 size={ICON_SIZE} strokeWidth={ICON_STROKE}/> 
            {!isCollapsed && <span>Reports</span>}
          </div>
        </nav>
      </div>


    </aside>
  );
}
