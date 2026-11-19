import React, { useState, useEffect } from 'react';
import { format, differenceInMinutes, parseISO } from 'date-fns';
import { ChevronRight } from 'lucide-react';
import { UpcomingMeetings } from './UpcomingMeetings';
import { NextMeetingCard } from './NextMeetingCard';
import { getProfileLocal } from '../../lib/auth';
import { api } from '../../lib/api';

// Icons replaced with external images

export function Overview({ onOpenReport, onOpenMeetings, onOpenReports, onOpenCalendar }) {
  const [profile, setProfile] = useState(() => getProfileLocal());
  const [activeDate, setActiveDate] = useState(() => new Date());
  
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);

  // Generate 7 dates centered on activeDate
  const days = [];
  for (let i = -3; i <= 3; i++) {
    const d = new Date(activeDate);
    d.setDate(d.getDate() + i);
    days.push(d);
  }

  useEffect(() => {
    const refresh = () => setProfile(getProfileLocal());
    window.addEventListener('xobin:profile', refresh);
    return () => window.removeEventListener('xobin:profile', refresh);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [upcomingRes, pastRes] = await Promise.all([
          api.getUpcomingMeetings().catch(() => ({ meetings: [] })),
          api.getPastMeetings().catch(() => ({ meetings: [] }))
        ]);
        if (cancelled) return;
        let upcoming = (upcomingRes.meetings || []).map(m => ({...m, kind: 'upcoming'}));
        const past = (pastRes.meetings || []).map(m => ({...m, kind: 'past'}));

        // Include desktop Google Calendar events if connected
        if (window.electronAPI?.getCalendarEvents) {
          try {
            const cal = await window.electronAPI.getCalendarEvents();
            if (cal?.events) {
              const calUpcoming = cal.events.map(ev => ({
                id: ev.id,
                title: ev.title,
                startTime: ev.startTime,
                endTime: ev.endTime,
                meetingUrl: ev.meetingUrl || ev.hangoutLink,
                candidateName: ev.candidateName || (ev.participants?.[0] || ''),
                participants: ev.participants || [],
                kind: 'upcoming'
              }));
              upcoming = [...upcoming, ...calUpcoming];
            }
          } catch (e) {}
        }

        // Deduplicate: If an upcoming meeting has already been recorded as a past session, hide the upcoming one.
        const pastSessionIds = new Set(past.map(p => p.sessionId).filter(Boolean));
        
        const filteredUpcoming = upcoming.filter(u => {
          if (u.sessionId && pastSessionIds.has(u.sessionId)) return false;
          if (u.meetingUrl) {
            const uTime = new Date(u.startTime).getTime();
            const hasSameMeeting = past.some(p => {
              if (p.meetingUrl !== u.meetingUrl) return false;
              const pTime = new Date(p.startTime).getTime();
              // Deduplicate only if they share the same URL AND start within 60 mins of each other
              return Math.abs(uTime - pTime) < 60 * 60 * 1000;
            });
            if (hasSameMeeting) return false;
          }
          return true;
        });

        const all = [...filteredUpcoming, ...past].filter(m => m.startTime).sort((a,b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
        setMeetings(all);
      } catch (err) {
        console.error(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    
    load();

    // Only sync if this user actually connected Google Calendar (never invent meetings).
    api.getCalendarConnections().then((res) => {
      const list = (res && res.connections) || res || [];
      const hasGoogle = Array.isArray(list) && list.some((c) => c.provider === 'google' && c.enabled !== false);
      if (!hasGoogle) return null;
      return api.syncCalendar();
    }).then((synced) => {
      if (synced && !cancelled) load();
    }).catch(() => {});

    return () => { cancelled = true; };
  }, []);

  const todayString = format(new Date(), 'yyyy-MM-dd');
  const todayCount = meetings.filter(m => format(new Date(m.startTime), 'yyyy-MM-dd') === todayString).length;

  const now = new Date();
  const upcomingMeetings = meetings.filter(m => m.kind === 'upcoming' && new Date(m.endTime) > now);
  const nextMeeting = upcomingMeetings.length > 0 ? upcomingMeetings[0] : null;
  
  let nextSyncText = "No upcoming meetings scheduled today.";
  if (nextMeeting) {
    const diff = differenceInMinutes(new Date(nextMeeting.startTime), new Date());
    if (diff > 0 && diff < 60) {
      nextSyncText = `Your next sync starts in exactly ${diff} minutes.`;
    } else if (diff >= 60) {
      nextSyncText = `Your next sync starts in about ${Math.round(diff/60)} hours.`;
    } else if (diff <= 0 && diff > -120) {
      nextSyncText = `Your next sync is happening now.`;
    }
  }

  const activeDateString = format(activeDate, 'yyyy-MM-dd');
  const calendarEvents = meetings.filter(m => format(new Date(m.startTime), 'yyyy-MM-dd') === activeDateString);

  return (
    <div style={{ padding: '32px 40px', width: '100%', maxWidth: '1600px', height: '100%', overflow: 'hidden', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '40px' }}>
      
      {/* Modern Hybrid Welcome Message */}
      <div style={{ marginBottom: '8px' }}>
        <h1 style={{ 
          fontSize: '32px', 
          fontWeight: 700, 
          margin: 0, 
          color: 'var(--text-main)', 
          letterSpacing: '-0.8px',
          fontFamily: '"SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
        }}>
          Good morning, {profile.displayName || 'Dinesh'}
        </h1>
        <p style={{ 
          fontSize: '15px', 
          color: 'var(--text-muted)', 
          margin: '8px 0 0 0', 
          fontWeight: 400,
          lineHeight: '1.5'
        }}>
          You have <span style={{color: 'var(--text-main)', fontWeight: 600}}>{todayCount} meeting{todayCount !== 1 ? 's' : ''}</span> today. {nextSyncText}
        </p>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: '40px', alignItems: 'stretch', justifyContent: 'center' }}>
        
        {/* Left Column */}
        <div style={{ flex: '1.4', display: 'flex', flexDirection: 'column', gap: '32px', minWidth: 0, maxWidth: '950px', overflowY: 'auto', paddingRight: '8px' }}>
          <NextMeetingCard meeting={nextMeeting} />
          <UpcomingMeetings 
            onSeeAll={() => onOpenMeetings('upcoming')} 
            onOpenMeeting={(id) => onOpenMeetings('upcoming', id)} 
          />
        </div>

        {/* Right Column - Calendar */}
        <div style={{ flex: '1', minHeight: 0, minWidth: '420px', maxWidth: '480px', display: 'flex', flexDirection: 'column' }}>
        
        <div style={{ 
          paddingLeft: '40px', 
          borderLeft: '1px solid var(--border-light)',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0
        }}>
          <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-main)', margin: 0, display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                Calendar <span style={{fontSize:'13px', color:'var(--text-muted)', fontWeight:500}}>{format(activeDate, 'MMMM, yyyy')}</span>
              </h3>
              <span onClick={onOpenCalendar} style={{ fontSize: '13px', color: '#0d8abc', fontWeight: 500, cursor: 'pointer', transition: 'opacity 0.2s' }} onMouseOver={(e)=>e.currentTarget.style.opacity=0.8} onMouseOut={(e)=>e.currentTarget.style.opacity=1}>Go to Calendar &gt;</span>
            </div>
            
            {/* Horizontal Dates */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '32px', alignItems: 'center' }}>
              <span style={{color:'var(--text-muted)', fontSize:'12px', cursor: 'pointer', padding: '4px'}} onClick={() => { const nd = new Date(activeDate); nd.setDate(nd.getDate() - 1); setActiveDate(nd); }}>&lt;</span>
              {days.map((d) => {
                const isActive = d.getTime() === activeDate.getTime();
                const dayStr = format(d, 'EEE');
                const dateNum = format(d, 'd');
                return (
                  <div key={d.getTime()} onClick={() => setActiveDate(d)} style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', cursor: 'pointer',
                    background: isActive ? 'var(--text-main)' : 'transparent',
                    color: isActive ? 'var(--bg-main)' : 'var(--text-main)',
                    padding: isActive ? '8px 14px' : '8px 10px',
                    borderRadius: '14px',
                    boxShadow: isActive ? '0 4px 12px rgba(0,0,0,0.1)' : 'none',
                    transform: isActive ? 'scale(1.15)' : 'scale(1)',
                    transition: 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
                  }}>
                    <span style={{ fontSize: '12px', color: isActive ? 'var(--bg-main)' : 'var(--text-muted)', fontWeight: isActive ? 600 : 400, transition: 'color 0.3s ease' }}>{dayStr}</span>
                    <span style={{ fontSize: '15px', fontWeight: isActive ? 800 : 600 }}>{dateNum}</span>
                  </div>
                );
              })}
              <span style={{color:'var(--text-muted)', fontSize:'12px', cursor: 'pointer', padding: '4px'}} onClick={() => { const nd = new Date(activeDate); nd.setDate(nd.getDate() + 1); setActiveDate(nd); }}>&gt;</span>
            </div>

            {/* Events */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: '4px', paddingBottom: '16px' }}>
               <style>{`
                 .calendar-event-card {
                   position: relative;
                   padding: 16px 0;
                   border-bottom: 1px solid var(--border-light);
                   transition: opacity 0.2s ease;
                 }
                 .calendar-event-card:last-child {
                   border-bottom: none;
                 }
                 .event-platform-pill {
                   position: relative;
                   overflow: hidden;
                   display: flex;
                   align-items: center;
                   gap: 6px;
                   padding: 6px 12px;
                   border-radius: 12px;
                   border: 1px solid var(--border-light);
                   background: transparent;
                   cursor: pointer;
                 }
                 .join-overlay {
                   position: absolute;
                   inset: 0;
                   background: rgba(128, 128, 128, 0.1);
                   backdrop-filter: blur(4px);
                   display: flex;
                   align-items: center;
                   justify-content: center;
                   opacity: 0;
                   transition: all 0.3s ease;
                   z-index: 10;
                 }
                 .event-platform-pill:hover .join-overlay {
                   opacity: 1;
                 }
                 .join-text {
                   color: var(--text-main);
                   font-size: 13px;
                   font-weight: 700;
                   transform: translateY(10px);
                   transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                 }
                 .event-platform-pill:hover .join-text {
                   transform: translateY(0);
                 }
                 .avatar-group-container {
                   position: relative;
                   display: flex;
                   cursor: pointer;
                 }
                 .avatar-popover {
                   position: absolute;
                   top: 100%;
                   left: 0;
                   margin-top: 8px;
                   background: var(--bg-panel);
                   border: 1px solid var(--border-light);
                   border-radius: 16px;
                   padding: 16px;
                   width: 260px;
                   box-shadow: 0 12px 32px rgba(0,0,0,0.15);
                   display: flex;
                   flex-wrap: wrap;
                   gap: 16px;
                   opacity: 0;
                   visibility: hidden;
                   transform: translateY(10px);
                   transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                   z-index: 50;
                 }
                 .avatar-group-container:hover .avatar-popover {
                   opacity: 1;
                   visibility: visible;
                   transform: translateY(0);
                 }
                 .avatar-popover-item {
                   display: flex;
                   flex-direction: column;
                   align-items: center;
                   gap: 8px;
                   width: 52px;
                 }
                 .avatar-popover-item img {
                   width: 48px;
                   height: 48px;
                   border-radius: 50%;
                   border: 1px solid var(--border-light);
                   background: var(--bg-main);
                 }
                 .avatar-popover-item span {
                   font-size: 11px;
                   font-weight: 600;
                   color: var(--text-main);
                   text-align: center;
                   white-space: nowrap;
                   overflow: hidden;
                   text-overflow: ellipsis;
                   width: 100%;
                 }
                 .avatar-popover-header {
                   width: 100%;
                   font-size: 13px;
                   font-weight: 600;
                   color: var(--text-main);
                   border-bottom: 1px solid var(--border-light);
                   padding-bottom: 12px;
                   margin-bottom: 4px;
                   display: flex;
                   justify-content: space-between;
                   align-items: center;
                 }
               `}</style>

               {loading && <div style={{ fontSize: '13px', color: 'var(--text-muted)', paddingTop: '16px' }}>Loading events...</div>}
               
               {!loading && calendarEvents.length === 0 && (
                 <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '40px 0', color: 'var(--text-muted)' }}>
                   <div style={{ fontSize: '14px', fontWeight: 500 }}>No events today</div>
                   <div style={{ fontSize: '13px' }}>Enjoy your free time!</div>
                 </div>
               )}

               {!loading && calendarEvents.map((evt, i) => {
                 const start = new Date(evt.startTime);
                 const end = evt.endTime ? new Date(evt.endTime) : new Date(start.getTime() + 60 * 60 * 1000);
                 const timeStr = `${format(start, 'h:mm a')} - ${format(end, 'h:mm a')}`;
                 const attendees = Array.isArray(evt.participants) ? evt.participants : (evt.candidateName ? [{name: evt.candidateName}] : []);
                 const pStr = (evt.platform || evt.meetingUrl || '').toLowerCase();
                 let iconUrl = "https://knowledge.workspace.google.com/static/images/icons/product/meet.svg";
                 let platformName = "Google Meet";
                 if (pStr.includes('zoom')) {
                   iconUrl = "https://www.vectorlogo.zone/logos/zoomus/zoomus-icon.svg";
                   platformName = "Zoom";
                 } else if (pStr.includes('teams')) {
                   iconUrl = "https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/Teams-Icon-FY26?resMode=sharp2&op_usm=1.5,0.65,15,0&wid=58&hei=58&qlt=100&fit=constrain";
                   platformName = "Teams";
                 }

                 return (
                  <div 
                    key={evt.id || i}
                    className="calendar-event-card" 
                    style={{ display: 'flex', flexDirection: 'column', gap: '12px', cursor: 'pointer' }}
                    onClick={() => onOpenMeetings(evt.kind === 'upcoming' ? 'upcoming' : 'past', evt.id)}
                  >
                     <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                       <div>
                         <h4 style={{ fontSize: '15px', fontWeight: 600, margin: '0 0 4px 0', color: 'var(--text-main)' }}>{evt.title || evt.jobRole || 'Meeting'}</h4>
                         <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>{timeStr}</p>
                       </div>
                       <ChevronRight size={18} color="var(--text-muted)" />
                     </div>
                     <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                       <div className="avatar-group-container">
                          {attendees.slice(0, 3).map((p, idx) => (
                            <img key={idx} src={`https://api.dicebear.com/7.x/notionists/svg?seed=${typeof p === 'string' ? p : p.name}&backgroundColor=transparent`} style={{width:'28px', height:'28px', borderRadius:'50%', border:'2px solid var(--bg-main)', boxShadow: '0 0 0 1px var(--border-light)', marginLeft: idx > 0 ? '-10px' : 0, zIndex: 10 - idx}} alt="Avatar" />
                          ))}
                          {attendees.length > 3 && (
                            <div style={{width:'28px', height:'28px', borderRadius:'50%', background:'var(--border-light)', border:'2px solid var(--bg-main)', boxShadow: '0 0 0 1px var(--border-light)', marginLeft:'-10px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'11px', color:'var(--text-main)', fontWeight:600, zIndex: 1}}>+{attendees.length - 3}</div>
                          )}
                          
                          {/* Expanded View Popover */}
                          {attendees.length > 0 && (
                            <div className="avatar-popover">
                              <div className="avatar-popover-header">
                                Attendees <span style={{fontSize:'12px', color:'var(--text-muted)'}}>{attendees.length}</span>
                              </div>
                              {attendees.map((p, idx) => (
                                <div key={idx} className="avatar-popover-item">
                                  <img src={`https://api.dicebear.com/7.x/notionists/svg?seed=${typeof p === 'string' ? p : p.name}&backgroundColor=transparent`} alt="Avatar" />
                                  <span>{typeof p === 'string' ? p : p.name}</span>
                                </div>
                              ))}
                            </div>
                          )}
                       </div>
                       <div className="event-platform-pill" onClick={(e) => {
                          if (evt.meetingUrl) {
                            e.stopPropagation();
                            window.open(evt.meetingUrl, '_blank');
                          }
                       }}>
                         {evt.meetingUrl && (
                           <div className="join-overlay">
                             <span className="join-text">Join</span>
                           </div>
                         )}
                         <img src={iconUrl} width="16" height="16" alt={platformName} />
                         <span style={{ fontSize: '13px', color: 'var(--text-main)', fontWeight: 600 }}>{platformName}</span>
                       </div>
                     </div>
                   </div>
                 );
               })}
             </div>
          </div>
        </div>
        
        </div>
      </div>

    </div>
  );
}
