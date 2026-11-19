import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import '../index.css';

import { Sidebar } from '../components/layout/Sidebar';
import { Integrations } from '../components/dashboard/Integrations';
import { Overview } from '../components/dashboard/Overview';
import { Insights } from '../components/dashboard/Insights';
import { CalendarView } from '../components/dashboard/CalendarView';
import { MeetingsView } from '../components/dashboard/MeetingsView';
import { ReportsInbox } from '../components/dashboard/ReportsInbox';
import { ReportView } from '../components/dashboard/ReportView';
import { api } from '../lib/api';
import { mapReportDetail } from '../lib/format';
import { syncProfileLocal } from '../lib/auth';

function Dashboard() {
  const [isDark, setIsDark] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const activeView = searchParams.get('view') || 'overview';
  
  const [meetingsFilter, setMeetingsFilter] = useState('all');
  const [meetingsId, setMeetingsId] = useState(null);
  const [selectedReportMeeting, setSelectedReportMeeting] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const reportReqRef = React.useRef(0);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const prefs = await api.getPreferences();
        if (cancelled || !prefs) return;
        syncProfileLocal({
          displayName: prefs.displayName || '',
          email: prefs.email || '',
          avatarUrl: prefs.avatarUrl || ''
        });
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => {
    if (isDark) {
      document.documentElement.setAttribute('data-theme', 'dark');
      document.documentElement.classList.add('dark');
      if (window.electronAPI?.setTheme) window.electronAPI.setTheme('dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
      document.documentElement.classList.remove('dark');
      if (window.electronAPI?.setTheme) window.electronAPI.setTheme('light');
    }
  }, [isDark]);

  const toggleTheme = () => setIsDark(!isDark);

  const handleOpenReport = async (meeting) => {
    const sessionId = meeting?.sessionId || meeting?.id;
    if (!sessionId) return;
    const reqId = ++reportReqRef.current;
    setSearchParams({ view: 'reports' });
    setReportLoading(true);
    try {
      const full = await api.getReport(sessionId);
      if (reqId !== reportReqRef.current) return;
      setSelectedReportMeeting(mapReportDetail(full));
    } catch (e) {
      console.error(e);
      if (reqId !== reportReqRef.current) return;
      setSelectedReportMeeting(null);
      alert(e.message || 'Report not available yet for this meeting.');
      setSearchParams({ view: 'meetings' });
    } finally {
      if (reqId === reportReqRef.current) setReportLoading(false);
    }
  };

  const handleViewChange = (view) => {
    setSearchParams({ view });
    if (view === 'reports') {
      reportReqRef.current += 1;
      setSelectedReportMeeting(null);
      setReportLoading(false);
    }
    setIsMobileMenuOpen(false);
  };

  const handleOpenMeetings = (filter = 'all', meetingId = null) => {
    setMeetingsFilter(filter);
    setMeetingsId(meetingId);
    handleViewChange('meetings');
  };

  return (
    <div className="flex h-full w-full bg-[var(--bg-panel)] overflow-hidden relative">
      {isMobileMenuOpen && (
        <div 
          className="md:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      <div className={`${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 fixed md:relative z-50 h-full transition-transform duration-200 ease-in-out`}>
        <Sidebar 
          isDark={isDark} 
          toggleTheme={toggleTheme} 
          activeView={activeView} 
          setActiveView={handleViewChange}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        />
      </div>

      <main className="flex-1 flex flex-col min-w-0 bg-[var(--bg-main)] h-full overflow-y-auto">
        <div className="md:hidden flex items-center justify-between p-4 border-b border-[var(--border-light)] bg-[var(--bg-panel)] sticky top-0 z-30">
          <span className="font-bold text-[var(--text-main)]">SaaS App</span>
          <button 
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-2 -mr-2 text-[var(--text-main)]"
          >
            {isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {activeView === 'overview' && (
          <Overview
            onOpenReport={handleOpenReport}
            onOpenMeetings={handleOpenMeetings}
            onOpenReports={() => handleViewChange('reports')}
            onOpenCalendar={() => handleViewChange('calendar')}
          />
        )}
        {activeView === 'insights' && <Insights />}
        {activeView === 'meetings' && <MeetingsView onOpenReport={handleOpenReport} initialFilter={meetingsFilter} initialMeetingId={meetingsId} />}
        {activeView === 'reports' && (
          selectedReportMeeting
            ? <ReportView meeting={selectedReportMeeting} onBack={() => setSelectedReportMeeting(null)} />
            : reportLoading
              ? <div style={{ padding: '40px', color: 'var(--text-muted)', fontSize: '14px' }}>Loading report…</div>
              : <ReportsInbox onOpenReport={handleOpenReport} />
        )}
        {activeView === 'integrations' && <Integrations initialSection="integrations" />}
        {activeView === 'settings' && <Integrations initialSection="general" />}
        {activeView === 'calendar' && <CalendarView />}
      </main>
    </div>
  );
}

export default Dashboard;
