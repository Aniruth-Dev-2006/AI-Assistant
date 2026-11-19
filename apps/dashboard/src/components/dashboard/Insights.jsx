import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, Info } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { api } from '../../lib/api';
import { format, subDays, subMonths, startOfYear, eachDayOfInterval, eachMonthOfInterval, isWithinInterval } from 'date-fns';

export function Insights() {
  const [timeFilter, setTimeFilter] = useState('Last 6 Months');
  const [data, setData] = useState({
    totalInterviews: 0,
    insightsGenerated: 0,
    conversionRate: 0,
    upcomingInterviews: 0,
    chartData: [],
    trend: 0,
    thisPeriodCount: 0
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [pastRes, reportsRes, upcomingRes] = await Promise.all([
          api.getPastMeetings().catch(() => ({ meetings: [] })),
          api.getReports().catch(() => ({ reports: [] })),
          api.getUpcomingMeetings().catch(() => ({ meetings: [] }))
        ]);
        if (cancelled) return;
        
        const past = pastRes.meetings || [];
        const reports = reportsRes.reports || [];
        const upcoming = upcomingRes.meetings || [];

        const totalInterviews = past.length;
        const insightsGenerated = reports.length;
        const hiredCount = reports.filter(r => r.recommendation === 'hire').length;
        const conversionRate = reports.length > 0 ? Math.round((hiredCount / reports.length) * 100) : 0;
        const upcomingInterviews = upcoming.length;

        // Determine date range and grouping based on filter
        const now = new Date();
        let startDate;
        let intervals = [];
        let formatStr = '';

        if (timeFilter === 'Last 7 Days') {
          startDate = subDays(now, 6);
          intervals = eachDayOfInterval({ start: startDate, end: now });
          formatStr = 'MMM d';
        } else if (timeFilter === 'Last 30 Days') {
          startDate = subDays(now, 29);
          intervals = eachDayOfInterval({ start: startDate, end: now });
          formatStr = 'MMM d';
        } else if (timeFilter === 'This Year') {
          startDate = startOfYear(now);
          intervals = eachMonthOfInterval({ start: startDate, end: now });
          formatStr = 'MMM';
        } else {
          // Default: Last 6 Months
          startDate = subMonths(now, 5);
          intervals = eachMonthOfInterval({ start: startDate, end: now });
          formatStr = 'MMM';
        }

        // Initialize grouped data
        const grouped = {};
        intervals.forEach(d => {
          grouped[format(d, formatStr)] = { count: 0, rawDate: d };
        });

        past.forEach(m => {
          if (!m.startTime) return;
          const d = new Date(m.startTime);
          if (isWithinInterval(d, { start: startDate, end: now })) {
            const key = format(d, formatStr);
            if (grouped[key]) grouped[key].count++;
          }
        });

        const chartData = Object.keys(grouped).map(key => ({
          name: key, 
          interviews: grouped[key].count,
          rawDate: grouped[key].rawDate
        })).sort((a,b) => a.rawDate - b.rawDate);

        const thisPeriodCount = chartData.reduce((sum, item) => sum + item.interviews, 0);
        
        // Simple trend calculation (comparing last half vs first half of chart)
        const half = Math.floor(chartData.length / 2);
        const firstHalf = chartData.slice(0, half).reduce((sum, item) => sum + item.interviews, 0);
        const secondHalf = chartData.slice(half).reduce((sum, item) => sum + item.interviews, 0);
        
        let trend = 0;
        if (firstHalf === 0) {
          trend = secondHalf > 0 ? 100 : 0;
        } else {
          trend = Math.round(((secondHalf - firstHalf) / firstHalf) * 100);
        }

        setData({
          totalInterviews,
          insightsGenerated,
          conversionRate,
          upcomingInterviews,
          chartData,
          trend,
          thisPeriodCount
        });

      } catch (e) {
        console.error(e);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [timeFilter]);

  return (
    <div style={{ padding: '32px 40px', width: '100%', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', paddingBottom: '16px', borderBottom: '1px solid var(--border-light)' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 600, margin: 0, color: 'var(--text-main)' }}>Insights</h1>
          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Recruiter Analytics & Overview</span>
        </div>
      </div>

      {/* Main Content Area */}
      <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
        
        {/* Left: Large Chart */}
        <div style={{ flex: '1 1 400px', minWidth: 0, background: 'var(--bg-panel)', border: '1px solid var(--border-light)', borderRadius: '12px', padding: '24px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <h3 style={{ fontSize: '15px', color: 'var(--text-muted)', fontWeight: 500, margin: '0 0 12px 0' }}>Interview Volume ({timeFilter})</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '32px', fontWeight: 600, color: 'var(--text-main)' }}>{data.thisPeriodCount}</span>
                <span style={{ 
                  background: data.trend >= 0 ? '#dcfce7' : '#fee2e2', 
                  color: data.trend >= 0 ? '#166534' : '#991b1b', 
                  padding: '4px 10px', borderRadius: '100px', fontSize: '13px', fontWeight: 600 
                }}>
                  {data.trend >= 0 ? '↑' : '↓'} {Math.abs(data.trend)}%
                </span>
              </div>
            </div>
            
            <div style={{ display: 'flex', gap: '12px' }}>
              <FilterDropdown 
                options={['Last 7 Days', 'Last 30 Days', 'Last 6 Months', 'This Year']}
                value={timeFilter}
                onChange={setTimeFilter}
              />
            </div>
          </div>

          <div style={{ height: '350px', width: '100%', minHeight: '350px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.chartData} margin={{ top: 20, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="var(--border-light)" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} minTickGap={20} tick={{ fontSize: 13, fill: 'var(--text-muted)', dy: 10 }} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 13, fill: 'var(--text-muted)' }} />
                <Tooltip cursor={{ fill: 'var(--bg-muted)' }} contentStyle={{ background: 'var(--bg-panel)', border: '1px solid var(--border-light)', borderRadius: '8px', color: 'var(--text-main)' }} />
                <Line type="linear" dataKey="interviews" name="Interviews" stroke="var(--text-main)" strokeWidth={2} dot={{ fill: 'var(--text-main)', strokeWidth: 0, r: 4 }} activeDot={{ r: 6, fill: 'var(--accent-blue)' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right: Vertical Sidebar Metrics Only */}
        <div style={{ width: '300px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <SidebarCard title="Total Interviews" value={data.totalInterviews} />
          <SidebarCard title="AI Insights Generated" value={data.insightsGenerated} />
          <SidebarCard title="Conversion Rate (Hire)" value={`${data.conversionRate}%`} />
          <SidebarCard title="Upcoming Interviews" value={data.upcomingInterviews} />
        </div>
      </div>

    </div>
  );
}

function SidebarCard({ title, value }) {
  return (
    <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-light)', borderRadius: '12px', padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 500 }}>
        {title}
      </div>
      <div style={{ fontSize: '32px', fontWeight: 600, color: 'var(--text-main)' }}>
        {value}
      </div>
    </div>
  );
}

function FilterDropdown({ options, value, onChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setIsOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div 
        onClick={() => setIsOpen(!isOpen)}
        style={{ display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid var(--border-light)', borderRadius: '8px', padding: '8px 14px', fontSize: '14px', fontWeight: 500, color: 'var(--text-main)', cursor: 'pointer', background: 'var(--bg-panel)' }}
      >
        {value} <ChevronDown size={16} color="var(--text-muted)" />
      </div>
      
      {isOpen && (
        <div style={{ 
          position: 'absolute', top: '100%', right: 0, marginTop: '8px', zIndex: 50,
          background: 'var(--bg-panel)', border: '1px solid var(--border-light)', 
          borderRadius: '8px', boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
          minWidth: '160px', overflow: 'hidden'
        }}>
          {options.map(opt => (
            <div 
              key={opt}
              onClick={() => { onChange(opt); setIsOpen(false); }}
              onMouseOver={(e) => e.currentTarget.style.background = 'var(--bg-muted)'}
              onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
              style={{
                padding: '10px 16px', fontSize: '13px', fontWeight: 500, color: 'var(--text-main)',
                cursor: 'pointer', transition: 'background 0.2s',
                background: opt === value ? 'var(--bg-muted)' : 'transparent'
              }}
            >
              {opt}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
