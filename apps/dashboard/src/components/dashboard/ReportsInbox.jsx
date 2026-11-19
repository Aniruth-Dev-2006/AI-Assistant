import React, { useEffect, useState } from 'react';
import { Search, ChevronRight } from 'lucide-react';
import { api } from '../../lib/api';
import { formatMeetingDate } from '../../lib/format';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'hire', label: 'Advance / Hire' },
  { id: 'maybe', label: 'Nurture / Maybe' },
  { id: 'pass', label: 'Disqualify / Pass' },
  { id: 'generating', label: 'Generating' }
];

function recLabel(report) {
  if (report.recommendationLabel) return report.recommendationLabel;
  const rec = report.recommendation;
  if (report.salesMode) {
    if (rec === 'hire') return 'Advance';
    if (rec === 'pass') return 'Disqualify';
    if (rec === 'maybe') return 'Nurture';
  }
  if (rec === 'hire') return 'Hire';
  if (rec === 'pass') return 'No Hire';
  if (rec === 'maybe') return 'Maybe';
  return '—';
}

function recColor(rec) {
  if (rec === 'hire') return '#10b981';
  if (rec === 'pass') return '#ef4444';
  if (rec === 'maybe') return '#f59e0b';
  return 'var(--text-muted)';
}

export function ReportsInbox({ onOpenReport }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const params = {};
        if (activeFilter === 'generating') params.status = 'pending,generating';
        else if (['hire', 'maybe', 'pass'].includes(activeFilter)) params.recommendation = activeFilter;
        if (searchQuery.trim()) params.q = searchQuery.trim();
        const data = await api.getReports(params);
        if (!cancelled) setReports(data.reports || []);
        if (!cancelled) setError('');
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load reports');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    const t = setTimeout(load, searchQuery ? 250 : 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [activeFilter, searchQuery]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', padding: '24px', gap: '20px' }}>
      <div style={{
        background: 'var(--bg-panel)',
        borderRadius: '100px',
        padding: '8px 12px',
        border: '1px solid var(--border-light)',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        maxWidth: '760px',
        width: '100%',
        margin: '0 auto'
      }}>
        <Search size={14} color="var(--text-muted)" style={{ marginLeft: '4px' }} />
        <input
          type="text"
          placeholder="Search candidates, roles, or summaries..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            border: 'none',
            background: 'transparent',
            outline: 'none',
            fontSize: '13px',
            color: 'var(--text-main)',
            width: '100%',
            fontWeight: 400
          }}
        />
      </div>

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', maxWidth: '960px', width: '100%', margin: '0 auto' }}>
        <div style={{ padding: '8px 4px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 700, margin: 0, color: 'var(--text-main)', letterSpacing: '-0.4px' }}>
            Reports
          </h2>
          <span style={{
            fontSize: '12px',
            fontWeight: 600,
            color: 'var(--text-muted)',
            background: 'var(--bg-muted)',
            padding: '2px 8px',
            borderRadius: '100px'
          }}>
            {reports.length}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setActiveFilter(f.id)}
              style={{
                padding: '6px 14px',
                borderRadius: '100px',
                fontSize: '12px',
                fontWeight: 500,
                border: '1px solid',
                borderColor: activeFilter === f.id ? 'var(--text-main)' : 'var(--border-light)',
                cursor: 'pointer',
                background: 'transparent',
                color: activeFilter === f.id ? 'var(--text-main)' : 'var(--text-muted)'
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--border-light)', borderRadius: '16px', background: 'var(--bg-panel)' }}>
          {loading && <div style={{ padding: '24px', fontSize: '13px', color: 'var(--text-muted)' }}>Loading reports…</div>}
          {!loading && error && <div style={{ padding: '24px', fontSize: '13px', color: '#ef4444' }}>{error}</div>}
          {!loading && !error && reports.length === 0 && (
            <div style={{ padding: '24px', fontSize: '13px', color: 'var(--text-muted)' }}>
              No reports yet. Finish an interview from the extension to generate one.
            </div>
          )}
          {reports.map((report, i) => {
            const clickable = report.status === 'ready';
            return (
              <div
                key={report.sessionId || report.id}
                onClick={() => clickable && onOpenReport && onOpenReport(report)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '16px 20px',
                  borderBottom: i !== reports.length - 1 ? '1px solid var(--border-light)' : 'none',
                  cursor: clickable ? 'pointer' : 'default',
                  gap: '14px',
                  opacity: clickable ? 1 : 0.72
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <h4 style={{
                      fontSize: '14px',
                      fontWeight: 600,
                      margin: 0,
                      color: 'var(--text-main)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}>
                      {report.candidateName || report.title}
                    </h4>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)', flexShrink: 0, marginLeft: '12px' }}>
                      {formatMeetingDate(report.date)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>
                    <span>{report.title || report.jobRole}</span>
                    <span>•</span>
                    <span style={{ color: recColor(report.recommendation), fontWeight: 600 }}>
                      {report.status === 'ready' ? recLabel(report) : report.status}
                    </span>
                    {report.overallScore != null && report.status === 'ready' && (
                      <>
                        <span>•</span>
                        <span>{Number(report.overallScore).toFixed(1)}/10</span>
                      </>
                    )}
                  </div>
                </div>
                {clickable && <ChevronRight size={16} color="var(--text-muted)" />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
