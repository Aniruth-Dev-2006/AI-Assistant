import React, { useMemo } from 'react';
import { 
  format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, 
  eachDayOfInterval, isSameMonth, isSameDay, getHours, getMinutes,
  differenceInMinutes, isToday
} from 'date-fns';

export function CustomCalendar({ date, view, events, onDateChange }) {
  const [now, setNow] = React.useState(new Date());
  const scrollRef = React.useRef(null);

  React.useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  // Calendar configurations
  const START_HOUR = 0;
  const END_HOUR = 23;
  const HOURS_COUNT = END_HOUR - START_HOUR + 1;
  const HOUR_HEIGHT = 60; // px

  // Auto-scroll to current time when mounting or switching views
  React.useEffect(() => {
    if ((view === 'week' || view === 'day') && scrollRef.current) {
      // Calculate top position for current time
      const nowMinutes = (getHours(new Date()) - START_HOUR) * 60 + getMinutes(new Date());
      const nowTop = (nowMinutes / 60) * HOUR_HEIGHT;
      
      // Scroll to current time minus a ~2 hour offset so it's nicely visible in the middle
      scrollRef.current.scrollTop = Math.max(0, nowTop - 120);
    }
  }, [view, date]);

  const hours = Array.from({ length: HOURS_COUNT }, (_, i) => START_HOUR + i);

  // Month View Math
  const monthDays = useMemo(() => {
    if (view !== 'month') return [];
    const start = startOfWeek(startOfMonth(date));
    const end = endOfWeek(endOfMonth(date));
    return eachDayOfInterval({ start, end });
  }, [date, view]);

  // Week View Math
  const weekDays = useMemo(() => {
    if (view !== 'week') return [];
    const start = startOfWeek(date);
    const end = endOfWeek(date);
    return eachDayOfInterval({ start, end });
  }, [date, view]);

  const [selectedPopDay, setSelectedPopDay] = React.useState(null);

  // Helper to position events in Week/Day view
  const getThemeClasses = (themeColor) => {
    switch (themeColor) {
      case 'purple': return { bg: 'bg-white dark:bg-[#1e1e1e]', border: 'border-border hover:border-purple-500/50', dot: 'bg-purple-500' };
      case 'green': return { bg: 'bg-white dark:bg-[#1e1e1e]', border: 'border-border hover:border-emerald-500/50', dot: 'bg-emerald-500' };
      case 'blue': 
      default: 
        return { bg: 'bg-white dark:bg-[#1e1e1e]', border: 'border-border hover:border-blue-500/50', dot: 'bg-blue-500' };
    }
  };

  const lastScrollTime = React.useRef(0);

  const handleWheel = (e) => {
    const now = Date.now();
    if (now - lastScrollTime.current > 400) {
      lastScrollTime.current = now;
      const newDate = new Date(date);
      if (e.deltaY > 0) {
        newDate.setMonth(newDate.getMonth() + 1);
      } else {
        newDate.setMonth(newDate.getMonth() - 1);
      }
      if (onDateChange) onDateChange(newDate);
    }
  };

  const renderMonthView = () => {
    const weekDaysHeader = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    
    return (
      <div 
        className="flex flex-col h-full bg-card rounded-xl border border-border shadow-sm overflow-hidden p-6 relative"
        onWheel={handleWheel}
      >
        {/* Header */}
        <div className="grid grid-cols-7 border-b border-border pb-4 mb-4">
          {weekDaysHeader.map((d, i) => (
            <div key={i} className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-widest">
              {d}
            </div>
          ))}
        </div>
        
        {/* Grid */}
        <div 
          className="flex-1 grid grid-cols-7 gap-2"
          style={{ gridTemplateRows: `repeat(${monthDays.length / 7}, minmax(0, 1fr))` }}
        >
          {monthDays.map((day, i) => {
            const dayEvents = events.filter(e => isSameDay(e.start, day));
            const isCurrentMonth = isSameMonth(day, date);
            const isCurrentDay = isToday(day);
            const hasEvents = dayEvents.length > 0;
            const isSelected = selectedPopDay && isSameDay(selectedPopDay, day);

            return (
              <div 
                key={i} 
                onClick={() => {
                  if (onDateChange) onDateChange(day);
                  if (hasEvents) setSelectedPopDay(isSelected ? null : day);
                }}
                className={`relative p-1.5 flex flex-col rounded-xl border transition-all duration-200 ease-in-out min-h-[100px] ${
                  !isCurrentMonth ? 'opacity-40 bg-transparent border-transparent' : 'bg-card border-border'
                } ${hasEvents ? 'cursor-pointer hover:border-border' : ''} ${isSelected ? 'ring-2 ring-primary z-40' : 'z-10 hover:z-20'}`}
              >
                <div className="flex justify-between items-start mb-1">
                  <span className={`text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full ${isCurrentDay ? 'bg-primary text-primary-foreground shadow-sm' : 'text-foreground'}`}>
                    {format(day, 'd')}
                  </span>
                </div>
                
                {/* Inline Event Chips */}
                <div className="flex flex-col gap-0.5 flex-1 overflow-hidden">
                  {dayEvents.slice(0, 2).map(event => {
                    const theme = getThemeClasses(event.themeColor);
                    return (
                      <div key={event.id} className={`text-[9px] px-1.5 py-0.5 rounded truncate font-medium bg-muted/30 border border-border/50 text-foreground flex items-center gap-1.5`}>
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${theme.dot}`}></span>
                        <span className="truncate">{event.title}</span>
                      </div>
                    )
                  })}
                  {dayEvents.length > 2 && (
                    <span className="text-[10px] text-muted-foreground font-medium pl-1 mt-0.5">
                      +{dayEvents.length - 2} more
                    </span>
                  )}
                </div>

                {/* Popover */}
                {isSelected && (
                  <div 
                    className="absolute top-0 left-[calc(100%+12px)] bg-card border border-border shadow-lg rounded-xl p-4 w-[280px] z-[100] flex flex-col gap-3 animate-in fade-in zoom-in-95 duration-150"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-start gap-3 pb-3 border-b border-border/50">
                      <div className="flex flex-col items-center justify-center min-w-[36px]">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{format(day, 'EEE')}</span>
                        <span className="text-xl font-semibold text-foreground leading-none mt-1">{format(day, 'd')}</span>
                      </div>
                      <div className="flex flex-col justify-center pt-1">
                        <span className="text-sm font-semibold text-foreground leading-tight">{dayEvents.length} {dayEvents.length === 1 ? 'Event' : 'Events'}</span>
                      </div>
                    </div>
                    
                    <div className="flex flex-col gap-2 max-h-[250px] overflow-y-auto pr-1">
                      {dayEvents.map(ev => {
                        const theme = getThemeClasses(ev.themeColor);
                        return (
                          <div key={ev.id} className={`flex flex-col p-2 rounded-lg border bg-muted/10 ${theme.border}`}>
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className={`w-1.5 h-1.5 rounded-full ${theme.dot}`}></span>
                              <span className="text-[10px] font-medium text-muted-foreground">{format(ev.start, 'h:mm a')} - {format(ev.end, 'h:mm a')}</span>
                            </div>
                            <span className="text-xs font-semibold text-foreground">{ev.title}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderTimeGrid = (days) => {
    return (
      <div className="flex flex-col h-full bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        {/* Days Header */}
        <div className="flex border-b border-border bg-muted/10 z-20">
          <div className="w-[72px] flex-shrink-0 border-r border-border"></div>
          {days.map((day, i) => {
            const isCurrentDay = isToday(day);
            return (
              <div key={i} className={`flex-1 flex flex-col items-center justify-center py-3 border-r border-border ${isCurrentDay ? 'bg-primary/5' : ''}`}>
                <span className={`text-[11px] font-bold uppercase tracking-wider mb-1 ${isCurrentDay ? 'text-primary' : 'text-muted-foreground'}`}>{format(day, 'EEE')}</span>
                <span className={`text-xl font-medium w-9 h-9 flex items-center justify-center rounded-full ${isCurrentDay ? 'bg-primary text-primary-foreground shadow-md' : 'text-foreground'}`}>
                  {format(day, 'd')}
                </span>
              </div>
            );
          })}
        </div>

        {/* Scrollable Grid Area */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto flex bg-background scroll-smooth">
          {/* Time Axis */}
          <div className="w-[72px] flex-shrink-0 border-r border-border bg-muted/5 flex flex-col pt-3 pb-6 relative z-10">
            {hours.map(hour => (
              <div key={hour} className="text-[11px] font-semibold text-muted-foreground text-right pr-3 relative flex-shrink-0" style={{ height: `${HOUR_HEIGHT}px` }}>
                <span className="absolute -top-[7px] right-3 bg-muted/5 pl-1">{hour === 0 ? '12 AM' : hour === 12 ? '12 PM' : hour > 12 ? `${hour - 12} PM` : `${hour} AM`}</span>
              </div>
            ))}
          </div>

          {/* Time Slots */}
          <div className="flex-1 flex relative pt-3 pb-6" style={{ minHeight: `${HOURS_COUNT * HOUR_HEIGHT}px` }}>
            {/* Horizontal Grid Lines */}
            <div className="absolute inset-0 pointer-events-none flex flex-col pt-3 pb-6">
              {hours.map(hour => (
                <div key={hour} className="w-full border-t border-border flex-shrink-0" style={{ height: `${HOUR_HEIGHT}px` }} />
              ))}
            </div>

            {/* Day Columns */}
            {days.map((day, i) => {
              const dayEvents = events.filter(e => isSameDay(e.start, day));
              const isCurrentDay = isToday(day);
              const showRedLine = isCurrentDay || view === 'day';

              return (
                <div key={i} className={`flex-1 relative border-r border-border ${isCurrentDay ? 'bg-primary/[0.02]' : ''}`}>
                  {/* Current Time Indicator Line */}
                  {showRedLine && (() => {
                    const nowMinutes = (getHours(now) - START_HOUR) * 60 + getMinutes(now);
                    if (nowMinutes >= 0 && nowMinutes <= HOURS_COUNT * 60) {
                      const nowTop = (nowMinutes / 60) * HOUR_HEIGHT;
                      return (
                        <div className="absolute left-0 right-0 border-t-2 border-red-500 z-30 pointer-events-none" style={{ top: `${nowTop}px` }}>
                          <div className="absolute -left-1.5 -top-1.5 w-3 h-3 rounded-full bg-red-500 shadow-sm"></div>
                        </div>
                      );
                    }
                    return null;
                  })()}
                  
                  {dayEvents.map(event => {
                    const startMinutes = (getHours(event.start) - START_HOUR) * 60 + getMinutes(event.start);
                    const durationMinutes = differenceInMinutes(event.end, event.start);
                    const top = Math.max(0, (startMinutes / 60) * HOUR_HEIGHT);
                    const height = (durationMinutes / 60) * HOUR_HEIGHT;
                    const theme = getThemeClasses(event.themeColor);
                    
                    return (
                      <div 
                        key={event.id}
                        className={`absolute inset-x-1 px-2 py-1 overflow-hidden shadow-sm hover:shadow-md transition-all cursor-pointer flex flex-col z-20 hover:z-30 rounded-lg border ${theme.bg} ${theme.border}`}
                        style={{ top: `${top}px`, height: `${Math.max(height, 28)}px` }}
                      >
                        <div className="flex items-center gap-1.5 mb-0.5 min-h-[14px]">
                          <span className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${theme.dot}`}></span>
                          <span className="text-[10px] font-medium text-muted-foreground opacity-90 whitespace-nowrap overflow-hidden text-ellipsis leading-none">
                            {format(event.start, 'h:mm')} - {format(event.end, 'h:mm a')}
                          </span>
                        </div>
                        <span className="text-[11px] font-medium leading-tight text-foreground truncate pl-3">{event.title}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  if (view === 'month') return renderMonthView();
  if (view === 'week') return renderTimeGrid(weekDays);
  if (view === 'day') return renderTimeGrid([date]);

  return null;
}
