import React, { useState, useEffect } from 'react';
import { Video, Calendar, FileText, BarChart2, ArrowUpRight } from 'lucide-react';
import { api } from '../../lib/api';

export function StatCards() {
  const [stats, setStats] = useState([
    { label: 'Past Interviews', value: '—', change: '', icon: <Video size={18} strokeWidth={1.5} /> },
    { label: 'Upcoming', value: '—', change: '', icon: <Calendar size={18} strokeWidth={1.5} /> },
    { label: 'Reports Ready', value: '—', change: '', icon: <FileText size={18} strokeWidth={1.5} /> },
    { label: 'Avg Score', value: '—', change: '', icon: <BarChart2 size={18} strokeWidth={1.5} /> },
  ]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [upcoming, past, reports] = await Promise.all([
          api.getUpcomingMeetings().catch(() => ({ meetings: [] })),
          api.getPastMeetings().catch(() => ({ meetings: [] })),
          api.getReports({ status: 'ready', limit: 100 }).catch(() => ({ reports: [] }))
        ]);
        if (cancelled) return;
        const pastList = past.meetings || [];
        const upList = upcoming.meetings || [];
        const reportList = reports.reports || [];
        const scores = reportList.map((r) => Number(r.overallScore)).filter((n) => Number.isFinite(n));
        const avg = scores.length
          ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)
          : '—';

        setStats([
          { label: 'Past Interviews', value: String(pastList.length), change: '', icon: <Video size={18} strokeWidth={1.5} /> },
          { label: 'Upcoming', value: String(upList.length), change: upList.length ? 'Scheduled' : 'None', icon: <Calendar size={18} strokeWidth={1.5} /> },
          { label: 'Reports Ready', value: String(reportList.length), change: '', icon: <FileText size={18} strokeWidth={1.5} /> },
          { label: 'Avg Score', value: String(avg), change: scores.length ? `${scores.length} scored` : '', icon: <BarChart2 size={18} strokeWidth={1.5} /> },
        ]);
      } catch (e) {
        console.error(e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
      {stats.map((stat, i) => (
        <div key={i} style={{ 
          background: 'var(--bg-panel)',
          border: '1px solid var(--border-light)',
          borderRadius: '16px',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)' }}>{stat.label}</span>
            <div style={{ background: 'var(--bg-muted)', padding: '6px', borderRadius: '8px', color: 'var(--text-main)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {stat.icon}
            </div>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span style={{ fontSize: '32px', fontWeight: 700, color: 'var(--text-main)', letterSpacing: '-1px' }}>{stat.value}</span>
            {stat.change ? (
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '2px', background: 'var(--bg-muted)', padding: '2px 6px', borderRadius: '4px' }}>
                {stat.change.includes('+') && <ArrowUpRight size={12} />} {stat.change}
              </span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
