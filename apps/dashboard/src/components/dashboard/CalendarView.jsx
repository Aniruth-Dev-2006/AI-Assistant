import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Plus, Calendar as CalendarIcon, Check, Search as SearchIcon, MoreVertical } from 'lucide-react';
import { Calendar as MiniCalendar } from "@/components/ui/calendar";
import { CustomCalendar } from './CustomCalendar';
import { format, startOfWeek, endOfWeek } from 'date-fns';

// Custom Toolbar (we can pass down view/date handlers)
const CustomToolbar = ({ label, onNavigate, onView, view }) => {
  return (
    <div className="flex items-center justify-between mb-4 mt-2">
      <div className="flex items-center gap-4">
        <h2 className="text-xl font-semibold text-foreground w-48">{label}</h2>
        <div className="flex items-center gap-1 border border-border rounded-lg p-1 bg-card">
          <button onClick={() => onNavigate(-1)} className="p-1.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors">
            <ChevronLeft size={16} />
          </button>
          <button onClick={() => onNavigate(0)} className="px-3 py-1.5 text-sm font-medium hover:bg-muted rounded text-foreground transition-colors">
            Today
          </button>
          <button onClick={() => onNavigate(1)} className="p-1.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      
      <div className="flex items-center gap-3">
        <div className="flex border border-border rounded-lg p-1 bg-card">
          {['month', 'week', 'day'].map((v) => (
            <button
              key={v}
              onClick={() => onView(v)}
              className={`px-3 py-1.5 text-sm font-medium rounded capitalize transition-colors ${
                view === v ? 'bg-muted text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
        <button className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors shadow-sm">
          <Plus size={16} /> Add event
        </button>
      </div>
    </div>
  );
};

class CalendarErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    this.setState({ error, info });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 text-red-500 bg-red-50 border border-red-200 rounded-xl m-4">
          <h2 className="text-lg font-bold mb-2">Calendar Crashed!</h2>
          <pre className="text-xs whitespace-pre-wrap">{this.state.error?.toString()}</pre>
          <pre className="text-xs whitespace-pre-wrap mt-4">{this.state.info?.componentStack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

export function CalendarView() {
  return (
    <CalendarErrorBoundary>
      <CalendarViewInner />
    </CalendarErrorBoundary>
  );
}

function CalendarViewInner() {
  const [events, setEvents] = useState([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(true);
  const [calendarError, setCalendarError] = useState('');
  const [calendarConnected, setCalendarConnected] = useState(null);

  useEffect(() => {
    async function fetchCalendarEvents() {
      setIsLoadingEvents(true);
      setCalendarError('');
      const merged = [];

      try {
        const { api } = await import('../../lib/api');
        const upcoming = await api.getUpcomingMeetings().catch(() => ({ meetings: [] }));
        for (const m of (upcoming.meetings || [])) {
          const start = m.startTime ? new Date(m.startTime) : null;
          if (!start || Number.isNaN(start.getTime())) continue;
          const end = m.endTime ? new Date(m.endTime) : new Date(start.getTime() + 60 * 60 * 1000);
          merged.push({
            id: `meet-${m.id || m.sessionId || start.getTime()}`,
            title: m.title || m.jobRole || m.candidateName || 'Interview',
            start,
            end,
            type: 'interview',
            themeColor: 'blue',
            hangoutLink: m.meetingUrl || null
          });
        }

        const timeMin = new Date();
        timeMin.setMonth(timeMin.getMonth() - 1);
        const timeMax = new Date();
        timeMax.setMonth(timeMax.getMonth() + 3);

        if (window.electronAPI?.getCalendarEvents) {
          try {
            const cal = await window.electronAPI.getCalendarEvents({
              timeMin: timeMin.toISOString(),
              timeMax: timeMax.toISOString()
            });
            if (cal && cal.connected) {
              setCalendarConnected(true);
              for (const item of (cal.events || [])) {
                const start = item.startTime ? new Date(item.startTime) : (item.start ? new Date(item.start) : null);
                const end = item.endTime ? new Date(item.endTime) : (item.end ? new Date(item.end) : start);
                if (!start || Number.isNaN(start.getTime())) continue;
                merged.push({
                  id: `gcal-${item.id}`,
                  title: item.title || 'Meeting',
                  start,
                  end: end && !Number.isNaN(end.getTime()) ? end : start,
                  type: item.meetingUrl ? 'interview' : 'personal',
                  themeColor: item.meetingUrl ? 'blue' : 'green',
                  hangoutLink: item.meetingUrl || null
                });
              }
            } else if (cal && cal.connected === false) {
              setCalendarConnected(false);
            }
          } catch (e) {
            console.warn('[CalendarView] desktop gcal fetch error:', e);
          }
        }

        try {
          const cal = await api.getCalendarEvents({
            timeMin: timeMin.toISOString(),
            timeMax: timeMax.toISOString()
          });
          if (cal.connected != null) setCalendarConnected(!!cal.connected);
          if (cal.error) setCalendarError(cal.error);

          for (const item of (cal.events || [])) {
            const start = item.start ? new Date(item.start) : null;
            const end = item.end ? new Date(item.end) : start;
            if (!start || Number.isNaN(start.getTime())) continue;
            const title = item.title || 'Untitled Event';
            let type = 'personal';
            let themeColor = 'green';
            if (/interview/i.test(title) || item.hangoutLink) {
              type = 'interview';
              themeColor = 'blue';
            } else if (/sync|standup|team/i.test(title)) {
              type = 'internal';
              themeColor = 'purple';
            }

            // Deduplicate: If we already have a meeting with this Google Meet link, don't show it twice.
            if (item.hangoutLink && merged.some(m => m.hangoutLink === item.hangoutLink)) {
              continue;
            }

            merged.push({
              id: `gcal-${item.id}`,
              title,
              start,
              end: end && !Number.isNaN(end.getTime()) ? end : start,
              type,
              themeColor,
              hangoutLink: item.hangoutLink || null
            });
          }
        } catch (err) {
          const msg = err?.message || 'Failed to load Google Calendar';
          if (!merged.length) {
            if (/404|Cannot GET|not found/i.test(msg)) {
              setCalendarError('Calendar API not found on the backend. Connect Google Calendar directly to sync events.');
            } else {
              setCalendarError(msg);
            }
          }
          if (/expired|reconnect|invalid_grant|401/i.test(msg)) setCalendarConnected(false);
        }
      } catch (e) {
        console.error(e);
      }

      const seen = new Set();
      const deduped = [];
      for (const ev of merged) {
        const key = `${ev.title}|${ev.start?.toISOString?.() || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(ev);
      }
      setEvents(deduped);
      setIsLoadingEvents(false);
    }

    fetchCalendarEvents();
  }, []);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [view, setView] = useState('week');
  const [activeTab, setActiveTab] = useState('all');
  
  const filteredEvents = events;
  const handleNavigate = (direction) => {
    if (direction === 0) {
      setSelectedDate(new Date());
      return;
    }
    
    const newDate = new Date(selectedDate);
    if (view === 'month') {
      newDate.setMonth(newDate.getMonth() + direction);
    } else if (view === 'week') {
      newDate.setDate(newDate.getDate() + (direction * 7));
    } else {
      newDate.setDate(newDate.getDate() + direction);
    }
    setSelectedDate(newDate);
  };

  const getLabel = () => {
    if (view === 'month') {
      return format(selectedDate, 'MMMM yyyy');
    } else if (view === 'week') {
      const start = startOfWeek(selectedDate, { weekStartsOn: 1 });
      const end = endOfWeek(selectedDate, { weekStartsOn: 1 });
      const startMonth = format(start, 'MMM');
      const endMonth = format(end, 'MMM');
      if (startMonth === endMonth) {
        return `${startMonth} ${format(start, 'd')} - ${format(end, 'd')}, ${format(start, 'yyyy')}`;
      } else {
        return `${startMonth} ${format(start, 'd')} - ${endMonth} ${format(end, 'd')}, ${format(start, 'yyyy')}`;
      }
    } else if (view === 'day') {
      return format(selectedDate, 'EEEE, MMMM d, yyyy');
    }
    return '';
  };

  return (
    <div className="flex flex-col w-full h-full p-6 pt-4 bg-background">
      <div className="flex justify-between items-end mb-0">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight text-foreground leading-none">Calendar</h1>
          <p className="text-sm text-muted-foreground mt-1">Scheduled events plus your connected Google Calendar.</p>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 pb-2">
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <CustomToolbar 
            label={getLabel()} 
            onNavigate={handleNavigate} 
            onView={setView} 
            view={view} 
          />
          <div className="flex-1 min-h-0 flex flex-col">
            {isLoadingEvents ? (
              <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Loading calendar…</div>
            ) : events.length === 0 ? (
              <div className="flex-1 flex items-center justify-center border border-border rounded-xl bg-card p-8 m-1">
                <div className="text-center max-w-md">
                  <h3 className="text-base font-semibold text-foreground mb-2">No events scheduled</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    {calendarConnected === false
                      ? 'Connect Google Calendar to sync upcoming meetings and automatically enable meeting assist.'
                      : (calendarError || 'No events found in this date range. Connect Google Calendar to sync meetings.')}
                  </p>
                  {calendarConnected === false && (
                    <button
                      onClick={async () => {
                        if (window.electronAPI?.loginWithGoogle) {
                          const res = await window.electronAPI.loginWithGoogle();
                          if (res?.error) alert(res.error);
                          else window.location.reload();
                        }
                      }}
                      style={{
                        padding: '9px 20px',
                        background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '100px',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                        boxShadow: '0 4px 12px rgba(37, 99, 235, 0.35)'
                      }}
                    >
                      <CalendarIcon size={15} /> Connect Google Calendar
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <CustomCalendar 
                date={selectedDate} 
                view={view} 
                events={filteredEvents}
                onDateChange={setSelectedDate}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
