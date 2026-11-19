import React, { useState, useEffect } from 'react';
import { AlignLeft, Clock } from 'lucide-react';
import { format, isToday, isYesterday } from 'date-fns';
import { api } from '../../lib/api';

function formatWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (isToday(d)) return `Today, ${format(d, 'h:mm a')}`;
  if (isYesterday(d)) return `Yesterday, ${format(d, 'h:mm a')}`;
  return format(d, 'MMM d, h:mm a');
}

export function RecentTranscripts({ onOpenReport, onViewAll }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.getReports({ status: 'ready', limit: 2 });
        if (cancelled) return;
        setItems((data.reports || []).slice(0, 2));
      } catch (e) {
        console.error(e);
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div style={{
      background: 'var(--bg-panel)',
      border: '1px solid var(--border-light)',
      borderRadius: '16px',
      display: 'flex',
      flexDirection: 'column',
      flex: 1,
      minWidth: '0'
    }}>
      <div style={{ padding: '20px', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 600, margin: 0, color: 'var(--text-main)' }}>Recent Reports</h3>
        {onViewAll ? (
          <button
            type="button"
            onClick={onViewAll}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', padding: 0
            }}
          >
            View all
          </button>
        ) : null}
      </div>
      
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {loading && (
          <div style={{ padding: '16px 20px', fontSize: '13px', color: 'var(--text-muted)' }}>Loading…</div>
        )}
        {!loading && items.length === 0 && (
          <div style={{ padding: '16px 20px', fontSize: '13px', color: 'var(--text-muted)' }}>
            No completed reports yet. Finish an interview to generate one.
          </div>
        )}
        {items.map((r, i) => (
          <div
            key={r.sessionId || i}
            onClick={() => onOpenReport && onOpenReport({ sessionId: r.sessionId, id: r.sessionId })}
            style={{ 
              padding: '20px',
              borderBottom: i !== items.length - 1 ? '1px solid var(--border-light)' : 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              cursor: onOpenReport ? 'pointer' : 'default'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h4 style={{ fontSize: '14px', fontWeight: 600, margin: '0 0 6px 0', color: 'var(--text-main)' }}>
                  {r.title || r.jobRole || r.candidateName || 'Interview'}
                </h4>
                <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: 'var(--text-muted)', alignItems: 'center' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Clock size={12} /> {formatWhen(r.date)}
                    {r.candidateName ? ` • ${r.candidateName}` : ''}
                  </span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                {r.overallScore != null && (
                  <span style={{ 
                    padding: '2px 8px', 
                    background: 'var(--bg-muted)', 
                    color: 'var(--text-main)', 
                    fontSize: '11px', 
                    fontWeight: 500, 
                    borderRadius: '100px',
                    border: '1px solid var(--border-light)'
                  }}>
                    {r.overallScore}/10
                  </span>
                )}
                {r.recommendation && (
                  <span style={{ 
                    padding: '2px 8px', 
                    background: 'var(--bg-muted)', 
                    color: 'var(--text-main)', 
                    fontSize: '11px', 
                    fontWeight: 500, 
                    borderRadius: '100px',
                    border: '1px solid var(--border-light)',
                    textTransform: 'capitalize'
                  }}>
                    {r.recommendation}
                  </span>
                )}
              </div>
            </div>

            {r.summary ? (
              <div style={{ 
                padding: '16px', 
                background: 'var(--bg-muted)', 
                borderRadius: '8px',
                border: '1px solid var(--border-light)',
                fontSize: '13px',
                color: 'var(--text-main)',
                lineHeight: 1.6,
                display: 'flex',
                gap: '12px'
              }}>
                <AlignLeft size={16} color="var(--text-muted)" style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <span style={{ fontWeight: 600, display: 'block', marginBottom: '6px', fontSize: '12px', color: 'var(--text-muted)' }}>SUMMARY</span>
                  <span style={{ color: 'var(--text-main)' }}>{r.summary}</span>
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
