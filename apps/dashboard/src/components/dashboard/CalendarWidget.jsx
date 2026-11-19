import React, { useState, useEffect } from 'react';
import { Calendar as BigCalendar, dateFnsLocalizer } from 'react-big-calendar';
import format from 'date-fns/format';
import parse from 'date-fns/parse';
import startOfWeek from 'date-fns/startOfWeek';
import getDay from 'date-fns/getDay';
import enUS from 'date-fns/locale/en-US';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { Video, Calendar as CalIcon, AlertCircle } from 'lucide-react';

const locales = {
  'en-US': enUS,
};

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales,
});

export function CalendarWidget() {
  const [events, setEvents] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchCalendarEvents() {
      const token = localStorage.getItem('google_oauth_token');
      if (!token) {
        setIsLoading(false);
        setError("Not connected to Google Calendar.");
        return;
      }

      try {
        const timeMin = new Date();
        timeMin.setDate(timeMin.getDate() - 30);
        const timeMax = new Date();
        timeMax.setDate(timeMax.getDate() + 30);

        const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin.toISOString()}&timeMax=${timeMax.toISOString()}&singleEvents=true&orderBy=startTime`, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });

        if (!res.ok) {
          throw new Error("Failed to fetch events from Google. Token may be expired.");
        }

        const data = await res.json();
        
        const formattedEvents = data.items.map(item => {
          let start = item.start.dateTime || item.start.date;
          let end = item.end.dateTime || item.end.date;
          
          return {
            id: item.id,
            title: item.summary || 'Untitled Event',
            start: new Date(start),
            end: new Date(end),
            hangoutLink: item.hangoutLink || null,
          };
        });

        setEvents(formattedEvents);
      } catch (err) {
        console.error(err);
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    }

    fetchCalendarEvents();
  }, []);

  const EventComponent = ({ event }) => (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '4px', padding: '2px' }}>
      <div style={{ fontWeight: 600, fontSize: '11px', lineHeight: 1.2 }}>{event.title}</div>
      {event.hangoutLink && (
        <a 
          href={event.hangoutLink} 
          target="_blank" 
          rel="noopener noreferrer"
          style={{ 
            background: '#fff', color: 'var(--primary)', padding: '2px 6px', 
            borderRadius: '4px', fontSize: '10px', textDecoration: 'none', 
            display: 'inline-flex', alignItems: 'center', gap: '4px', alignSelf: 'flex-start',
            marginTop: 'auto', fontWeight: 600, boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <Video size={10} /> Join
        </a>
      )}
    </div>
  );

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '650px' }}>
      <div className="card-header" style={{ marginBottom: '16px' }}>
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <CalIcon size={18} strokeWidth={2} color="var(--primary)" /> 
          <span style={{ fontWeight: 600 }}>Google Calendar</span>
        </div>
      </div>
      
      <div style={{ flex: 1, padding: '4px', minHeight: 0 }}>
        {error ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
            <AlertCircle size={32} style={{ marginBottom: '12px', opacity: 0.5 }} />
            <p style={{ fontWeight: 600 }}>{error}</p>
            <p style={{ fontSize: '13px', marginTop: '4px' }}>Please log out and log in again to sync your calendar.</p>
          </div>
        ) : isLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
            <p style={{ fontWeight: 500, fontSize: '14px' }}>Syncing with Google Calendar...</p>
          </div>
        ) : (
          <BigCalendar
            localizer={localizer}
            events={events}
            startAccessor="start"
            endAccessor="end"
            defaultView="week"
            views={['month', 'week', 'day']}
            style={{ height: '100%', fontFamily: 'inherit' }}
            components={{
              event: EventComponent
            }}
            eventPropGetter={(event) => {
              return {
                style: {
                  backgroundColor: 'var(--primary)',
                  borderRadius: 'var(--radius-sm)',
                  opacity: 0.95,
                  color: 'white',
                  border: 'none',
                }
              };
            }}
          />
        )}
      </div>
    </div>
  );
}
