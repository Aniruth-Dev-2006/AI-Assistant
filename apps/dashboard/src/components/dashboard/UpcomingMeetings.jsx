import React, { useState, useEffect } from 'react';
import { Video, ChevronRight, Sparkles } from 'lucide-react';
import { format, differenceInMinutes } from 'date-fns';
import { api } from '../../lib/api';

export function UpcomingMeetings({ onSeeAll, onOpenMeeting }) {
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchUpcoming() {
      try {
        let rawMeetings = [];
        try {
          const data = await api.getUpcomingMeetings();
          rawMeetings = data.meetings || [];
        } catch (e) {}

        if (window.electronAPI?.getCalendarEvents) {
          try {
            const cal = await window.electronAPI.getCalendarEvents();
            if (cal?.events) {
              rawMeetings = [...rawMeetings, ...cal.events];
            }
          } catch (e) {}
        }
        
        // No mocks, use real data only
        const now = new Date();
        rawMeetings = rawMeetings.filter(m => new Date(m.endTime || m.startTime) > now);

        const formatted = rawMeetings.map((item) => {
          const startDate = item.startTime ? new Date(item.startTime) : null;
          const endDate = item.endTime ? new Date(item.endTime) : null;
          const validStart = startDate && !Number.isNaN(startDate.getTime());
          const duration = validStart && endDate && !Number.isNaN(endDate.getTime())
            ? `${Math.max(1, differenceInMinutes(endDate, startDate))}m`
            : '';
          return {
            id: item.id,
            time: validStart ? format(startDate, 'hh:mm') : '',
            ampm: validStart ? format(startDate, 'a') : '',
            title: item.title || item.jobRole || 'Upcoming meeting',
            candidate: item.candidateName || item.jobRole || 'Participant',
            duration,
            hangoutLink: item.meetingUrl || item.hangoutLink || null
          };
        });
        setMeetings(formatted);
      } catch (err) {
        console.error(err);
        setMeetings([]);
      } finally {
        setLoading(false);
      }
    }

    fetchUpcoming();
  }, []);

  const displayMeetings = meetings.slice(0, 3);
  const hasMore = meetings.length > 3;

  return (
    <div style={{
      borderTop: '1px solid var(--border-light)',
      paddingTop: '24px',
      display: 'flex',
      flexDirection: 'column',
      flex: 1,
      minWidth: '0',
      flexShrink: 0
    }}>
      <div style={{ paddingBottom: '16px' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 600, margin: 0, color: 'var(--text-main)' }}>Upcoming Meetings</h3>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {loading && (
          <div style={{ padding: '16px 20px', fontSize: '13px', color: 'var(--text-muted)' }}>Loading…</div>
        )}
        {!loading && displayMeetings.length === 0 && (
          <div style={{ padding: '16px 20px', fontSize: '13px', color: 'var(--text-muted)' }}>
            No upcoming interviews scheduled.
          </div>
        )}
        {displayMeetings.map((meeting, i) => (
          <div key={meeting.id || i} 
          onClick={() => onOpenMeeting && onOpenMeeting(meeting.id)}
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '16px 20px',
            borderBottom: i !== displayMeetings.length - 1 ? '1px solid var(--border-light)' : 'none',
            borderLeft: i === 0 ? '2px solid var(--text-main)' : '2px solid transparent',
            background: i === 0 ? 'var(--bg-muted)' : 'transparent',
            gap: '16px',
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
          onMouseOver={(e) => { if (i !== 0) e.currentTarget.style.background = 'var(--bg-muted)'; }}
          onMouseOut={(e) => { if (i !== 0) e.currentTarget.style.background = 'transparent'; }}>
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: '60px', alignItems: 'flex-end' }}>
              <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-main)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>{meeting.time}</span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>{meeting.ampm}</span>
            </div>

            <div style={{ width: '1px', height: '32px', background: 'var(--border-light)' }} />

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <h4 style={{ fontSize: '14px', fontWeight: 600, margin: 0, color: 'var(--text-main)' }}>{meeting.title}</h4>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500 }}>{meeting.candidate}{meeting.duration ? ` • ${meeting.duration}` : ''}</span>
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.electronAPI?.launchAssist) {
                    window.electronAPI.launchAssist({
                      title: meeting.title,
                      candidateName: meeting.candidate,
                      meetingUrl: meeting.hangoutLink || ''
                    });
                  } else {
                    alert('Meeting Assist is available in desktop app.');
                  }
                }}
                style={{
                  background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
                  color: '#ffffff',
                  border: 'none',
                  padding: '6px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '11px',
                  fontWeight: 600,
                  borderRadius: '100px',
                  boxShadow: '0 2px 6px rgba(37, 99, 235, 0.3)',
                  cursor: 'pointer'
                }}
                title="Launch Dynamic Island Assist for this meeting"
              >
                <Sparkles size={12} /> Assist
              </button>
              {meeting.hangoutLink && (
                <button
                  onClick={(e) => { e.stopPropagation(); window.open(meeting.hangoutLink, '_blank'); }}
                  style={{
                    background: 'var(--bg-muted)',
                    color: 'var(--text-main)',
                    border: '1px solid var(--border-light)',
                    padding: '6px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    fontSize: '11px',
                    fontWeight: 500,
                    borderRadius: '100px',
                    cursor: 'pointer'
                  }}>
                  <Video size={12} /> Join
                </button>
              )}
            </div>
          </div>
        ))}
        
        {hasMore && (
          <div 
            onClick={onSeeAll}
            style={{ 
              padding: '16px 20px', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              gap: '8px',
              borderTop: '1px solid var(--border-light)',
              color: '#0d8abc',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'background 0.2s'
            }}
            onMouseOver={(e) => e.currentTarget.style.background = 'var(--bg-muted)'}
            onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
          >
            More <ChevronRight size={14} />
          </div>
        )}
      </div>
    </div>
  );
}
