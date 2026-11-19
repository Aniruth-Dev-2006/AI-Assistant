import React from 'react';
import { ArrowUpRight, MapPin, Briefcase, Video, Sparkles } from 'lucide-react';

export function NextMeetingCard({ meeting }) {
  if (!meeting) {
    return (
      <div style={{
        background: 'var(--bg-panel)',
        border: '1px dashed var(--border-light)',
        borderRadius: '20px',
        padding: '36px 32px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        color: 'var(--text-muted)'
      }}>
        <Briefcase size={28} strokeWidth={1.5} style={{ opacity: 0.6 }} />
        <p style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--text-main)' }}>No upcoming meetings scheduled</p>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>Launch dynamic island overlay for an ad-hoc session or connect calendar.</p>
        <button
          onClick={() => {
            if (window.electronAPI?.launchAssist) {
              window.electronAPI.launchAssist({ title: 'Ad-hoc Meeting Assist' });
            } else {
              alert('Meeting Assist is available in the desktop app.');
            }
          }}
          style={{
            marginTop: '4px',
            padding: '10px 24px',
            background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
            border: 'none',
            borderRadius: '100px',
            fontSize: '14px',
            fontWeight: 600,
            color: '#ffffff',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            boxShadow: '0 4px 14px rgba(37, 99, 235, 0.4)'
          }}
        >
          <Sparkles size={16} />
          Launch Assist
        </button>
      </div>
    );
  }

  const startDate = meeting.startTime ? new Date(meeting.startTime) : null;
  const isSoon = startDate && (startDate.getTime() - Date.now() < 30 * 60 * 1000) && (startDate.getTime() > Date.now());
  const participants = Array.isArray(meeting.participants) ? meeting.participants : (meeting.candidateName ? [{name: meeting.candidateName}] : []);

  return (
    <div style={{
      background: 'var(--bg-panel)',
      border: '1px solid var(--border-light)',
      borderRadius: '20px',
      padding: '24px 32px',
      boxShadow: '0 4px 20px rgba(0,0,0,0.04)',
      display: 'flex',
      flexDirection: 'column',
      gap: '20px',
      position: 'relative',
      overflow: 'hidden',
      flexShrink: 0
    }}>
      {/* Decorative light ash gradient on the right */}
      <div style={{
        position: 'absolute',
        top: '-10%',
        right: '-5%',
        width: '60%',
        height: '140%',
        background: 'radial-gradient(ellipse at 100% 50%, rgba(71, 85, 105, 0.4) 0%, rgba(100, 116, 139, 0.15) 50%, transparent 80%)',
        zIndex: 0,
        pointerEvents: 'none'
      }} />

      <div style={{ zIndex: 1, position: 'relative' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#3b82f6', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          {isSoon && <div style={{ width: '8px', height: '8px', background: '#3b82f6', borderRadius: '50%', animation: 'pulse 2s infinite' }} />}
          {isSoon ? 'Starting soon' : 'Next meeting'}
        </div>
        <h2 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-main)', margin: '0 0 16px 0', letterSpacing: '-0.5px' }}>
          {meeting.title || meeting.jobRole || 'Upcoming Meeting'}
        </h2>

        {/* Attendees */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap' }}>
          {participants.map((p, i) => (
            <span key={i} style={{ 
              padding: '4px 12px', 
              background: i === 0 ? 'var(--bg-main)' : 'transparent', 
              border: i === 0 ? '1px solid var(--border-light)' : 'none', 
              borderRadius: '100px', 
              fontSize: '13px', 
              fontWeight: i === 0 ? 500 : 400,
              color: i === 0 ? 'var(--text-main)' : 'var(--text-muted)'
            }}>{typeof p === 'string' ? p : p.name}</span>
          ))}
        </div>

        {/* Coresignal Insights Box (or placeholder for intelligence) */}
        {meeting.preMeetingBrief && (
          <div style={{
            background: 'var(--bg-muted)',
            borderRadius: '16px',
            padding: '20px',
            border: '1px solid var(--border-light)'
          }}>
            <div style={{ display: 'flex', gap: '16px', marginBottom: '12px', fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <MapPin size={14} /> {meeting.preMeetingBrief.location || 'Unknown'}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Briefcase size={14} /> {meeting.preMeetingBrief.industry || 'Unknown'}
              </div>
            </div>
            <p style={{ margin: 0, fontSize: '14px', lineHeight: '1.5', color: 'var(--text-main)' }}>
              {meeting.preMeetingBrief.summary || 'No brief generated.'}
            </p>
          </div>
        )}
      </div>

      <div style={{ zIndex: 1, position: 'relative', display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
        <button style={{
          padding: '10px 20px',
          background: 'transparent',
          border: '1px solid var(--border-light)',
          borderRadius: '100px',
          fontSize: '14px',
          fontWeight: 500,
          color: 'var(--text-main)',
          cursor: 'pointer'
        }}>
          Dismiss
        </button>
        <button 
          onClick={() => {
            if (window.electronAPI?.launchAssist) {
              window.electronAPI.launchAssist({
                title: meeting.title || meeting.jobRole,
                candidateName: (participants[0] && (typeof participants[0] === 'string' ? participants[0] : participants[0].name)) || '',
                meetingUrl: meeting.meetingUrl || ''
              });
            } else {
              alert('Meeting Assist is available in the desktop app.');
            }
          }}
          style={{
            padding: '10px 24px',
            background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
            border: 'none',
            borderRadius: '100px',
            fontSize: '14px',
            fontWeight: 700,
            color: '#ffffff',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            boxShadow: '0 4px 18px rgba(37, 99, 235, 0.45)'
          }}
        >
          <Sparkles size={16} />
          Launch Assist
        </button>
        {meeting.meetingUrl && (
          <button 
            onClick={() => window.open(meeting.meetingUrl, '_blank')}
            style={{
            padding: '10px 20px',
            background: 'var(--bg-muted)',
            border: '1px solid var(--border-light)',
            borderRadius: '100px',
            fontSize: '14px',
            fontWeight: 500,
            color: 'var(--text-main)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <Video size={16} />
            Join Meeting
          </button>
        )}
      </div>
      
      <style>{`
        @keyframes pulse {
          0% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.4); }
          70% { box-shadow: 0 0 0 6px rgba(59, 130, 246, 0); }
          100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); }
        }
      `}</style>
    </div>
  );
}
