import React, { useState, useEffect } from 'react';
import {
  Sparkles, Search, Clock, Users, Play, Pause,
  ChevronRight, ExternalLink, Check, Tag, Video,
  FileText, CheckCircle2, ArrowUpRight, Volume2, ArrowLeft
} from 'lucide-react';

import { api } from '../../lib/api';
import { mapMeeting } from '../../lib/format';
import { MeetingInfoButton } from './MeetingInfoButton';

const PlatformLogo = ({ platform }) => {
  if (platform === 'Zoom') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" style={{ height: '24px', width: '24px', flexShrink: 0 }}>
        <defs>
          <clipPath id="A"><path d="M-200-175H800v562H-200z" style={{ fill: 'none' }} /></clipPath>
          <clipPath id="B"><path d="M370 89a24 24 0 1 1-34 0 24 24 0 0 1 34 0zm-17-23a40 40 0 1 1-.05 0zm101 23a24 24 0 1 1-34 0 24 24 0 0 1 34 0zm11.3-11.3A40 40 0 1 1 437 66a40 40 0 0 1 28.28 11.72zM253 145.8l4 .2h60l-.2-4c-.54-6.6-5.2-11.4-11.8-11.8l-4-.2h-36l48-48-.2-4A12.1 12.1 0 0 0 301 66.2l-4-.2h-60l.2 4A12.41 12.41 0 0 0 249 81.8l4 .2h36l-48 48 .2 4a12.23 12.23 0 0 0 11.8 11.8zM526.84 90a17.29 17.29 0 0 1 2 8l.2 4v28l.2 4A12.29 12.29 0 0 0 541 145.8l4 .2v-44l.2-4a17.44 17.44 0 0 1 2-8.05 16 16 0 0 1 27.69.05 17.54 17.54 0 0 1 1.94 8l.2 4v28l.2 4A12.24 12.24 0 0 0 589 145.8l4 .2V98a32 32 0 0 0-56-21.17 32 32 0 0 0-41.92-5.35C492 68 485 66 481 66v80l4-.2c6.68-.44 11.54-5.16 11.8-11.8l.2-4v-28l.2-4a17.45 17.45 0 0 1 2-8 16 16 0 0 1 27.68 0z" style={{ fill: 'none', clipRule: 'evenodd' }} /></clipPath>
          <clipPath id="C"><circle cx="107" cy="106" r="102" style={{ fill: 'none' }} /></clipPath>
          <clipPath id="D"><circle cx="107" cy="106" r="100" style={{ fill: 'none' }} /></clipPath>
          <clipPath id="E"><circle cx="107" cy="106" r="92" style={{ fill: 'none' }} /></clipPath>
          <clipPath id="F"><path d="M135 94.06l26-19c2.27-1.85 4-1.42 4 2V135c0 3.84-2.16 3.4-4 2l-26-19zM47 77.2v43.2A17.69 17.69 0 0 0 64.77 138h63a3.22 3.22 0 0 0 3.23-3.2V91.6A17.69 17.69 0 0 0 113.23 74h-63A3.22 3.22 0 0 0 47 77.2z" style={{ fill: 'none', clipRule: 'evenodd' }} /></clipPath>
          <clipPath id="G"><path d="M390.36 50.67l-.36 1.6q.44 0 .86.1a5.64 5.64 0 0 0 .83.06 4.18 4.18 0 0 0 3.89-2.15L407 30.42h-2.12l-7.42 13.65h-.06l-2.3-13.65H393l3 16.08-1.46 2.5a5.21 5.21 0 0 1-1 1.18 2.2 2.2 0 0 1-1.53.56 15 15 0 0 1-1.65-.07zm-10.13-5.36a4.52 4.52 0 0 1-1.95-.39 4 4 0 0 1-1.37-1 4.29 4.29 0 0 1-.81-1.54 6.68 6.68 0 0 1-.26-1.92 11.09 11.09 0 0 1 .42-2.91 10.47 10.47 0 0 1 1.25-2.85 7.64 7.64 0 0 1 2.06-2.18 4.8 4.8 0 0 1 2.85-.87 4.23 4.23 0 0 1 3.51 1.35 5.64 5.64 0 0 1 1.07 3.59 11.19 11.19 0 0 1-.44 3 9.58 9.58 0 0 1-1.29 2.82 7.32 7.32 0 0 1-2.12 2.07 5.33 5.33 0 0 1-2.92.83zm-3-21.06L372.5 46.5h1.74l.78-3.68h.06a4.77 4.77 0 0 0 1.92 3.06 5.85 5.85 0 0 0 3.52 1.06 7.15 7.15 0 0 0 3.65-.92 8.62 8.62 0 0 0 2.66-2.38 10.91 10.91 0 0 0 1.64-3.3 12.54 12.54 0 0 0 .56-3.68 9.12 9.12 0 0 0-.37-2.66 5.78 5.78 0 0 0-1.14-2.12 5.4 5.4 0 0 0-1.9-1.4 6.5 6.5 0 0 0-2.7-.51 6 6 0 0 0-3.29.9 6.68 6.68 0 0 0-2.26 2.4h-.06l1.9-9zM351 45.3a3.87 3.87 0 0 1-3.27-1.37 5.44 5.44 0 0 1-1.06-3.43 11.36 11.36 0 0 1 .44-3 10.2 10.2 0 0 1 1.29-2.88 7.31 7.31 0 0 1 2.15-2.15 5.33 5.33 0 0 1 3-.84 4.33 4.33 0 0 1 3.32 1.25 4.77 4.77 0 0 1 1.17 3.4 11.07 11.07 0 0 1-.47 3.1 10.49 10.49 0 0 1-1.36 2.93 7.71 7.71 0 0 1-2.2 2.18 5.34 5.34 0 0 1-3.01.81zm7 1.2l4.77-22.25h-2l-1.93 9.2h-.06a4.22 4.22 0 0 0-1.93-2.7 6.59 6.59 0 0 0-3.3-.79 7.16 7.16 0 0 0-3.65.93 9.4 9.4 0 0 0-2.77 2.43 11.06 11.06 0 0 0-1.76 3.36 11.94 11.94 0 0 0-.61 3.71 7.12 7.12 0 0 0 1.51 4.75 5.68 5.68 0 0 0 4.6 1.79 6.31 6.31 0 0 0 3.47-.87 8.08 8.08 0 0 0 2.38-2.46h.06l-.72 2.9zM329.67 39h12.6q.1-.72.12-1.4.03-.68 0-1.37a7.66 7.66 0 0 0-.41-2.55 5.39 5.39 0 0 0-1.2-2 5.45 5.45 0 0 0-1.92-1.28 6.88 6.88 0 0 0-2.55-.4 7.63 7.63 0 0 0-3.68.87 8.65 8.65 0 0 0-2.74 2.31 10.24 10.24 0 0 0-1.7 3.26 12.38 12.38 0 0 0-.58 3.75 7.07 7.07 0 0 0 1.67 5 6.31 6.31 0 0 0 4.88 1.81 7.35 7.35 0 0 0 4.7-1.43 8.05 8.05 0 0 0 2.62-4.17h-2a5.88 5.88 0 0 1-1.93 2.88 5.62 5.62 0 0 1-5.41.72 4 4 0 0 1-1.46-1.06 4.33 4.33 0 0 1-.86-1.6 7 7 0 0 1-.28-2 7.62 7.62 0 0 1 .14-1.34zm10.75-1.65h-10.5a8.88 8.88 0 0 1 .78-2.15 7.26 7.26 0 0 1 1.3-1.83 6.49 6.49 0 0 1 1.81-1.28 5.11 5.11 0 0 1 2.23-.48 4.26 4.26 0 0 1 3.22 1.22 4.52 4.52 0 0 1 1.17 3.27q0 .3 0 .6 0 .3-.01.63zm-20.35-6.92l-3.43 16.07h1.93l1.8-8.4a11 11 0 0 1 .73-2.18 7.29 7.29 0 0 1 1.23-1.91 5.82 5.82 0 0 1 1.76-1.32 5.49 5.49 0 0 1 2.32-.53h1.12l.44-2a1 1 0 0 0-.25 0h-.8a5.48 5.48 0 0 0-3.52 1.09 9 9 0 0 0-2.31 2.84h-.1l.8-3.7zM302.3 39h12.6q.1-.72.12-1.4.03-.68 0-1.37a7.67 7.67 0 0 0-.4-2.55 5.39 5.39 0 0 0-1.2-2 5.44 5.44 0 0 0-1.92-1.28 6.88 6.88 0 0 0-2.59-.45 7.63 7.63 0 0 0-3.68.87 8.65 8.65 0 0 0-2.74 2.31 10.24 10.24 0 0 0-1.7 3.26 12.38 12.38 0 0 0-.58 3.75 7.07 7.07 0 0 0 1.67 5 6.31 6.31 0 0 0 4.88 1.81 7.34 7.34 0 0 0 4.7-1.43 8 8 0 0 0 2.62-4.17h-2a5.88 5.88 0 0 1-1.93 2.88 5.62 5.62 0 0 1-5.41.72 4 4 0 0 1-1.46-1.06 4.33 4.33 0 0 1-.86-1.6 7 7 0 0 1-.28-2 7.62 7.62 0 0 1 .17-1.29zm10.7-1.66h-10.5a8.88 8.88 0 0 1 .78-2.15 7.26 7.26 0 0 1 1.32-1.82 6.48 6.48 0 0 1 1.81-1.28 5.11 5.11 0 0 1 2.23-.48 4.26 4.26 0 0 1 3.22 1.22 4.52 4.52 0 0 1 1.17 3.27q0 .3 0 .6 0 .3-.03.63zm-36.37-6.92l1.87 16.08h2.15L287.3 33h.06l1.15 13.5h2.12l8.44-16.08H297L290.17 44h-.06L289 30.42h-2.3l-6.64 13.7H280l-1.28-13.7zm-9.77-.42a8.11 8.11 0 0 0-3.82.87 8.83 8.83 0 0 0-2.82 2.31 10.06 10.06 0 0 0-1.74 3.3 12.62 12.62 0 0 0-.59 3.83 6.93 6.93 0 0 0 1.65 4.86 6.13 6.13 0 0 0 4.77 1.81 8.08 8.08 0 0 0 3.91-.9 8.36 8.36 0 0 0 2.77-2.4 10.74 10.74 0 0 0 1.67-3.43 14.12 14.12 0 0 0 .56-4 7.13 7.13 0 0 0-.47-2.66 5.45 5.45 0 0 0-3.32-3.21 7.54 7.54 0 0 0-2.57-.38zm-2.18 15.36a4.43 4.43 0 0 1-3.68-1.49 5.79 5.79 0 0 1-1.18-3.79 10.49 10.49 0 0 1 .44-2.91 9.48 9.48 0 0 1 1.28-2.74 7.18 7.18 0 0 1 2.09-2 5.22 5.22 0 0 1 2.87-.79 4.39 4.39 0 0 1 3.55 1.4 5.46 5.46 0 0 1 1.18 3.65 11 11 0 0 1-.42 2.93 10 10 0 0 1-1.25 2.8 7.22 7.22 0 0 1-2.06 2.1 5 5 0 0 1-2.82.79zm-22.88-21.1L237 46.5h2.12l2.06-9.5H249a9.42 9.42 0 0 0 3.08-.48 6.87 6.87 0 0 0 2.41-1.4 6.41 6.41 0 0 0 1.59-2.27 7.78 7.78 0 0 0 .58-3.07 5.67 5.67 0 0 0-.45-2.31A4.9 4.9 0 0 0 255 25.7a5.54 5.54 0 0 0-1.87-1.07 7.12 7.12 0 0 0-2.35-.37zm-.22 10.9l2-9.1h6.5a7.8 7.8 0 0 1 1.85.2 3.66 3.66 0 0 1 1.42.67 3.08 3.08 0 0 1 .92 1.23 4.79 4.79 0 0 1 .33 1.88 5.3 5.3 0 0 1-.42 2.17 4.55 4.55 0 0 1-1.17 1.6 5.17 5.17 0 0 1-1.74 1 6.57 6.57 0 0 1-2.15.34z" style={{ fill: 'none', clipRule: 'evenodd' }} /></clipPath>
        </defs>
        <g clipPath="url(#B)" transform="translate(0 -178)" style={{ clipPath: 'url(#A)' }}><path d="M232 61h366v90H232z" fill="#4a8cff" /></g>
        <g transform="matrix(.156863 0 0 .156863 -.784314 -.627496)" style={{ clipPath: 'url(#A)' }}>
          <g clipPath="url(#C)"><path d="M0-1h214v214H0z" fill="#e5e5e4" /></g>
          <g clipPath="url(#D)"><path d="M2 1h210v210H2z" fill="#fff" /></g>
          <g clipPath="url(#E)"><path d="M10 9h194v194H10z" fill="#4a8cff" /></g>
          <g clipPath="url(#F)"><path d="M42 69h128v74H42z" fill="#fff" /></g>
        </g>
        <g clipPath="url(#G)" transform="translate(0 -178)" style={{ clipPath: 'url(#A)' }}><path d="M232 19.25h180v38.17H232z" fill="#90908f" /></g>
      </svg>
    );
  }
  if (platform === 'Microsoft Teams') {
    return (
      <img src="https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/Teams-Icon-FY26?resMode=sharp2&op_usm=1.5,0.65,15,0&wid=58&hei=58&qlt=100&fit=constrain" alt="Microsoft Teams" style={{ height: '24px', width: '24px', objectFit: 'contain' }} />
    );
  }
  // Default: Google Meet
  return (
    <img src="https://knowledge.workspace.google.com/static/images/icons/product/meet.svg" alt="Google Meet" style={{ height: '24px', width: '24px', objectFit: 'contain' }} />
  );
};

export function MeetingsView({ onOpenReport, initialFilter = 'all', initialMeetingId = null }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState(initialFilter);
  const [selectedMeeting, setSelectedMeeting] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [meetings, setMeetings] = useState([]);
  const [loadingMeetings, setLoadingMeetings] = useState(true);

  const [isAddingSkill, setIsAddingSkill] = useState(false);
  const [newSkillText, setNewSkillText] = useState('');
  const [brief, setBrief] = useState(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefError, setBriefError] = useState('');
  const [hubspotConnected, setHubspotConnected] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [upcomingRes, pastRes] = await Promise.all([
          api.getUpcomingMeetings().catch(() => ({ meetings: [] })),
          api.getPastMeetings().catch(() => ({ meetings: [] }))
        ]);
        if (cancelled) return;
        const upcoming = (upcomingRes.meetings || []).map((m) => mapMeeting({ ...m, kind: 'upcoming' }));
        const past = (pastRes.meetings || []).map((m) => mapMeeting({ ...m, kind: 'past' }));
        setMeetings([...upcoming, ...past]);
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setLoadingMeetings(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (loadingMeetings) return;
    const visible = meetings.filter((m) => {
      if (activeFilter === 'upcoming') return m.kind === 'upcoming';
      if (activeFilter === 'today') return m.date === 'Today';
      if (activeFilter === 'past') return m.kind === 'past';
      return true;
    });
    if (!visible.length) {
      setSelectedMeeting(null);
      return;
    }
    setSelectedMeeting((prev) => {
      if (initialMeetingId && !prev) {
         const found = meetings.find(m => m.id === initialMeetingId);
         if (found) return found;
      }
      if (prev && visible.some((m) => m.id === prev.id)) return prev;
      return visible[0];
    });
  }, [meetings, activeFilter, loadingMeetings, initialMeetingId]);

  useEffect(() => {
    let cancelled = false;
    async function loadBrief() {
      if (!selectedMeeting || selectedMeeting.kind !== 'upcoming' || !selectedMeeting.id) {
        setBrief(null);
        setBriefError('');
        setBriefLoading(false);
        return;
      }
      setBriefLoading(true);
      setBriefError('');
      try {
        const data = await api.getMeetingBrief(selectedMeeting.id);
        if (cancelled) return;
        setHubspotConnected(!!data.connected);
        setBrief(data.brief || null);
      } catch (e) {
        if (cancelled) return;
        setBrief(null);
        setBriefError(e.message || 'Failed to load prospect research');
      } finally {
        if (!cancelled) setBriefLoading(false);
      }
    }
    loadBrief();
    return () => { cancelled = true; };
  }, [selectedMeeting && selectedMeeting.id, selectedMeeting && selectedMeeting.kind]);

  const filteredMeetings = meetings.filter(m => {
    const q = searchQuery.toLowerCase();
    const matchesSearch = (m.title || '').toLowerCase().includes(q) ||
      (m.summary || '').toLowerCase().includes(q) ||
      (m.candidateName || '').toLowerCase().includes(q) ||
      (m.tags || []).some(t => t.toLowerCase().includes(q));
    if (activeFilter === 'upcoming') return matchesSearch && m.kind === 'upcoming';
    if (activeFilter === 'today') return matchesSearch && m.date === 'Today';
    if (activeFilter === 'past') return matchesSearch && m.kind === 'past';
    return matchesSearch;
  });

  const toggleActionItem = (meetingId, itemId) => {
    setMeetings(prev => prev.map(m => {
      if (m.id === meetingId) {
        const updated = m.actionItems.map(a => a.id === itemId ? { ...a, done: !a.done } : a);
        return { ...m, actionItems: updated };
      }
      return m;
    }));

    if (selectedMeeting && selectedMeeting.id === meetingId) {
      setSelectedMeeting(prev => ({
        ...prev,
        actionItems: prev.actionItems.map(a => a.id === itemId ? { ...a, done: !a.done } : a)
      }));
    }
  };

  const addSkill = (meetingId, skillName) => {
    if (!skillName.trim()) return;
    
    setMeetings(prev => prev.map(m => {
      if (m.id === meetingId) {
        return { ...m, verifiedSkills: [...(m.verifiedSkills || []), skillName] };
      }
      return m;
    }));

    if (selectedMeeting && selectedMeeting.id === meetingId) {
      setSelectedMeeting(prev => ({
        ...prev,
        verifiedSkills: [...(prev.verifiedSkills || []), skillName]
      }));
    }
  };

  const editActionItem = (meetingId, itemId, newText) => {
    setMeetings(prev => prev.map(m => {
      if (m.id === meetingId) {
        const updated = m.actionItems.map(a => a.id === itemId ? { ...a, text: newText } : a);
        return { ...m, actionItems: updated };
      }
      return m;
    }));

    if (selectedMeeting && selectedMeeting.id === meetingId) {
      setSelectedMeeting(prev => ({
        ...prev,
        actionItems: prev.actionItems.map(a => a.id === itemId ? { ...a, text: newText } : a)
      }));
    }
  };

  const cyclePlatform = (e, meetingId) => {
    e.stopPropagation();
    const platforms = ['Google Meet', 'Zoom', 'Microsoft Teams'];
    setMeetings(prev => prev.map(m => {
      if (m.id === meetingId) {
        const nextIdx = (platforms.indexOf(m.platform) + 1) % platforms.length;
        return { ...m, platform: platforms[nextIdx] };
      }
      return m;
    }));

    if (selectedMeeting && selectedMeeting.id === meetingId) {
      setSelectedMeeting(prev => {
        const nextIdx = (platforms.indexOf(prev.platform) + 1) % platforms.length;
        return { ...prev, platform: platforms[nextIdx] };
      });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', padding: '24px', gap: '20px' }}>
      <style>{`
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
      `}</style>      {/* Top Universal Search Bar (Clean & Static - Matching Dashboard Theme) */}
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
          placeholder="Search or ask anything about your meetings..."
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

        <div style={{
          fontSize: '10px',
          color: 'var(--text-muted)',
          background: 'var(--bg-muted)',
          padding: '2px 4px',
          borderRadius: '4px',
          fontWeight: 500,
          border: '1px solid var(--border-light)'
        }}>
          ⌘K
        </div>
      </div>

      {/* Main Split Layout: Left List + Right Detail Inspector */}
      <div className="flex flex-col lg:flex-row flex-1 overflow-hidden">

        {/* Left Column: "Your meetings" List */}
        <div className={`flex-none lg:w-[380px] lg:min-w-[320px] bg-[var(--bg-main)] border-b lg:border-b-0 lg:border-r border-[var(--border-light)] flex-col overflow-hidden h-full ${selectedMeeting ? 'hidden lg:flex' : 'flex w-full'}`}>

          {/* Section Header */}
          <div style={{ padding: '20px 20px 14px 20px', borderBottom: '1px solid var(--border-light)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h2 style={{ fontSize: '20px', fontWeight: 700, margin: 0, color: 'var(--text-main)', letterSpacing: '-0.4px' }}>
                Your meetings
              </h2>
              <span style={{
                fontSize: '12px',
                fontWeight: 600,
                color: 'var(--text-muted)',
                background: 'var(--bg-muted)',
                padding: '2px 8px',
                borderRadius: '100px'
              }}>
                {filteredMeetings.length} total
              </span>
            </div>

            {/* Filter Pills */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', overflowX: 'auto' }}>
              {[
                { key: 'all', label: 'All' },
                { key: 'upcoming', label: 'Upcoming' },
                { key: 'today', label: 'Today' },
                { key: 'past', label: 'Past' }
              ].map((f) => (
              <button
                key={f.key}
                onClick={() => setActiveFilter(f.key)}
                style={{
                  padding: '6px 14px',
                  borderRadius: '100px',
                  fontSize: '12px',
                  fontWeight: 500,
                  border: '1px solid',
                  borderColor: activeFilter === f.key ? 'var(--text-main)' : 'var(--border-light)',
                  cursor: 'pointer',
                  background: 'transparent',
                  color: activeFilter === f.key ? 'var(--text-main)' : 'var(--text-muted)',
                  transition: 'all 0.15s ease'
                }}
              >
                {f.label}
              </button>
              ))}
            </div>
          </div>

          {/* List of Meetings */}
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            {loadingMeetings && (
              <div style={{ padding: '24px', fontSize: '13px', color: 'var(--text-muted)' }}>Loading meetings…</div>
            )}
            {!loadingMeetings && filteredMeetings.length === 0 && (
              <div style={{ padding: '24px', fontSize: '13px', color: 'var(--text-muted)' }}>
                No meetings in this view yet.
              </div>
            )}
            {filteredMeetings.map((meeting, i) => {
              const isSelected = selectedMeeting?.id === meeting.id;

              return (
                <div
                  key={meeting.id}
                  onClick={() => setSelectedMeeting(meeting)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '16px 20px',
                    borderBottom: i !== filteredMeetings.length - 1 ? '1px solid var(--border-light)' : 'none',
                    background: isSelected ? 'var(--bg-muted)' : 'transparent',
                    borderLeft: isSelected ? '3px solid var(--text-main)' : '3px solid transparent',
                    cursor: 'pointer',
                    gap: '14px',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseOver={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--bg-muted)'; }}
                  onMouseOut={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                >
                  {/* Waveform Audio Badge Icon */}
                  <div style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '50%',
                    background: 'var(--bg-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--text-main)',
                    flexShrink: 0
                  }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                      <path d="M4 10v4" />
                      <path d="M8 6v12" />
                      <path d="M12 3v18" />
                      <path d="M16 7v10" />
                      <path d="M20 11v2" />
                    </svg>
                  </div>

                  {/* Meeting Info */}
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
                        {meeting.title}
                      </h4>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500, flexShrink: 0, marginLeft: '8px' }}>
                        {meeting.time}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
                      <span>{meeting.date}</span>
                      <span>•</span>
                      <span>{meeting.duration}</span>
                      {meeting.actionItems?.length > 0 && (
                        <>
                          <span>•</span>
                          <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>
                            {(meeting.actionItems || []).filter(a => a.done).length}/{(meeting.actionItems || []).length} actions
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <ChevronRight size={16} color="var(--text-muted)" style={{ opacity: isSelected ? 1 : 0.4 }} />
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Desktop Meeting Detail & Quick Inspector */}
        {selectedMeeting ? (
          <div className={`flex-1 min-w-0 bg-[var(--bg-main)] flex-col overflow-hidden h-full ${selectedMeeting ? 'flex w-full' : 'hidden lg:flex'}`}>
            {/* Detail Top Header with Open Full Report Button */}
            <div style={{
              padding: '22px 24px',
              borderBottom: '1px solid var(--border-light)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              flexWrap: 'wrap',
              gap: '16px',
              background: 'linear-gradient(to bottom, var(--bg-muted), transparent)'
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                  <button
                    onClick={() => setSelectedMeeting(null)}
                    className="lg:hidden p-2 -ml-2 rounded-lg bg-[var(--bg-muted)] text-[var(--text-main)] border border-[var(--border-light)] flex items-center justify-center cursor-pointer"
                  >
                    <ArrowLeft size={16} />
                  </button>
                  <h1 style={{ fontSize: '22px', fontWeight: 600, margin: 0, color: 'var(--text-main)', letterSpacing: '-0.3px' }}>
                    {selectedMeeting.title}
                  </h1>
                  <MeetingInfoButton
                    platform={selectedMeeting.platform}
                    logo={<PlatformLogo platform={selectedMeeting.platform} />}
                    url={selectedMeeting.url || ''}
                    time={`${selectedMeeting.time} (${selectedMeeting.duration})`}
                    organizer={selectedMeeting.participants?.[0] || 'Unknown'}
                    guests={selectedMeeting.participants || []}
                    details={selectedMeeting.category ? `${selectedMeeting.category} meeting` : null}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '13px', color: 'var(--text-muted)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Clock size={14} /> {selectedMeeting.date}, {selectedMeeting.time} ({selectedMeeting.duration})
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div className="avatar-group-container">
                      {(selectedMeeting.participants || []).slice(0, 3).map((p, i) => (
                        <img 
                          key={i} 
                          title={p} 
                          src={`https://api.dicebear.com/7.x/notionists/svg?seed=${p}&backgroundColor=transparent`}
                          style={{
                            width: '24px', height: '24px', borderRadius: '50%',
                            background: 'var(--bg-main)',
                            border: '2px solid var(--bg-main)',
                            boxShadow: '0 0 0 1px var(--border-light)',
                            marginLeft: i > 0 ? '-8px' : '0',
                            zIndex: 10 - i,
                            objectFit: 'cover'
                          }} 
                          alt={p.charAt(0)}
                        />
                      ))}
                      {(selectedMeeting.participants || []).length > 3 && (
                        <div style={{
                          width: '24px', height: '24px', borderRadius: '50%',
                          background: 'var(--border-light)', color: 'var(--text-main)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '10px', fontWeight: 600,
                          border: '2px solid var(--bg-main)',
                          boxShadow: '0 0 0 1px var(--border-light)',
                          marginLeft: '-8px',
                          zIndex: 0
                        }}>
                          +{(selectedMeeting.participants || []).length - 3}
                        </div>
                      )}
                      
                      <div className="avatar-popover">
                        <div className="avatar-popover-header">
                          Attendees <span style={{fontSize:'12px', color:'var(--text-muted)'}}>{(selectedMeeting.participants || []).length}</span>
                        </div>
                        {(selectedMeeting.participants || []).map((p, i) => (
                          <div key={i} className="avatar-popover-item">
                            <img src={`https://api.dicebear.com/7.x/notionists/svg?seed=${p}&backgroundColor=transparent`} alt={p} />
                            <span>{p}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-muted)' }}>
                      {(selectedMeeting.participants || []).length} attendees
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Buttons: Play Recording & Open Full Report Button (Arrow in Box) */}
              <div style={{ display: 'flex', gap: '8px' }}>
                {selectedMeeting.kind === 'upcoming' && selectedMeeting.url && (
                  <a
                    href={selectedMeeting.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '8px 16px',
                      borderRadius: '100px',
                      background: 'var(--text-main)',
                      color: 'var(--bg-main)',
                      fontSize: '13px',
                      fontWeight: 600,
                      textDecoration: 'none'
                    }}
                  >
                    Join
                  </a>
                )}
                {selectedMeeting.kind === 'past' && selectedMeeting.sessionId && (
                <button
                  onClick={() => onOpenReport && onOpenReport(selectedMeeting)}
                  title="Open Full Report"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 16px',
                    borderRadius: '100px',
                    background: 'transparent',
                    color: 'var(--text-main)',
                    fontSize: '13px',
                    fontWeight: 600,
                    border: '1px solid var(--text-main)',
                    cursor: 'pointer',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseOver={(e) => { e.currentTarget.style.background = 'var(--bg-muted)'; }}
                  onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <ExternalLink size={14} />
                  {selectedMeeting.reportStatus === 'ready' ? 'Open Full Report' : selectedMeeting.reportStatus ? 'View Report' : 'Open Report'}
                </button>
                )}
                {selectedMeeting.reportStatus === 'generating' || selectedMeeting.reportStatus === 'pending' ? (
                  <span style={{ fontSize: '13px', color: 'var(--text-muted)', alignSelf: 'center' }}>Generating report…</span>
                ) : null}
                {selectedMeeting.reportStatus === 'failed' ? (
                  <span style={{ fontSize: '13px', color: '#ef4444', alignSelf: 'center' }}>Report failed</span>
                ) : null}
              </div>
            </div>

            {/* Scrollable Content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>

              <div>
                <h3 style={{ fontSize: '15px', fontWeight: 500, margin: '0 0 10px 0', color: 'var(--text-main)' }}>
                  Summary
                </h3>
                <p style={{ fontSize: '14px', lineHeight: 1.6, color: 'var(--text-muted)', margin: 0 }}>
                  {selectedMeeting.summary || (selectedMeeting.kind === 'upcoming'
                    ? 'This meeting hasn’t started yet. A call summary will appear here after the meeting.'
                    : 'No summary yet.')}
                </p>
              </div>

              {selectedMeeting.kind === 'upcoming' && (
                <div>
                  <h3 style={{ fontSize: '15px', fontWeight: 500, margin: '0 0 10px 0', color: 'var(--text-main)' }}>
                    Prospect research
                  </h3>

                  {briefLoading ? (
                    <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)' }}>Looking up HubSpot…</p>
                  ) : briefError ? (
                    <p style={{ margin: 0, fontSize: 14, color: '#ef4444' }}>{briefError}</p>
                  ) : hubspotConnected === false || (brief && brief.connected === false) ? (
                    <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)' }}>
                      HubSpot is not connected. Connect it under Settings → Sales Mode to pull contact, company, and deal context.
                    </p>
                  ) : brief && brief.matched ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 720 }}>
                      {brief.contact ? (
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 4 }}>Contact</div>
                          <div style={{ fontSize: 14, color: 'var(--text-main)', lineHeight: 1.5 }}>
                            {[brief.contact.name, brief.contact.title].filter(Boolean).join(' · ')}
                          </div>
                          {(brief.contact.email || brief.contact.phone) ? (
                            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
                              {[brief.contact.email, brief.contact.phone].filter(Boolean).join(' · ')}
                            </div>
                          ) : null}
                          {(brief.contact.lifecycleStage || brief.contact.leadStatus || brief.contact.city) ? (
                            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
                              {[brief.contact.lifecycleStage, brief.contact.leadStatus, [brief.contact.city, brief.contact.state, brief.contact.country].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {brief.company ? (
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 4 }}>Company</div>
                          <div style={{ fontSize: 14, color: 'var(--text-main)', lineHeight: 1.5 }}>
                            {[brief.company.name, brief.company.industry, brief.company.size ? `${brief.company.size} employees` : '']
                              .filter(Boolean).join(' · ')}
                          </div>
                          {(brief.company.domain || brief.company.revenue) ? (
                            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
                              {[brief.company.domain, brief.company.revenue ? `Revenue: ${brief.company.revenue}` : ''].filter(Boolean).join(' · ')}
                            </div>
                          ) : null}
                          {brief.company.description ? (
                            <p style={{ margin: '6px 0 0', fontSize: 13, lineHeight: 1.5, color: 'var(--text-muted)' }}>
                              {brief.company.description}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                      {(brief.deals || []).length > 0 ? (
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 6 }}>Open deals</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {brief.deals.map((d) => (
                              <div key={d.id || d.name} style={{ fontSize: 14, color: 'var(--text-main)', lineHeight: 1.45 }}>
                                {d.name}
                                <span style={{ color: 'var(--text-muted)' }}>
                                  {[d.stage, d.amount != null && d.amount !== '' ? `$${d.amount}` : '', d.closeDate, d.nextStep]
                                    .filter(Boolean).length
                                    ? ` · ${[d.stage, d.amount != null && d.amount !== '' ? `$${d.amount}` : '', d.closeDate ? `Close ${d.closeDate}` : '', d.nextStep ? `Next: ${d.nextStep}` : ''].filter(Boolean).join(' · ')}`
                                    : ''}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {brief.companyScrape && (brief.companyScrape.description || brief.companyScrape.title) ? (
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 4 }}>Website</div>
                          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--text-muted)' }}>
                            {brief.companyScrape.description || brief.companyScrape.title}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)' }}>
                      No HubSpot match yet for this meeting’s guests. Research runs automatically when the meeting is scheduled — add the prospect email as a HubSpot contact if needed.
                    </p>
                  )}
                </div>
              )}

              {/* Verified Skills */}
              {(selectedMeeting.verifiedSkills || []).length > 0 && (
                <div>
                  <h3 style={{ fontSize: '15px', fontWeight: 500, margin: '0 0 10px 0', color: 'var(--text-main)' }}>
                    Verified Skills
                  </h3>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {(selectedMeeting.verifiedSkills || []).map((skill, i) => (
                      <div key={i} style={{
                        padding: '4px 10px',
                        borderRadius: '100px',
                        background: 'transparent',
                        border: '1px solid var(--border-light)',
                        color: 'var(--text-muted)',
                        fontSize: '12px',
                        fontWeight: 400,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}>
                        <Check size={10} color="var(--primary)" strokeWidth={2.5} />
                        {skill}
                      </div>
                    ))}
                    
                    {/* Add Skill Button / Input */}
                    {isAddingSkill ? (
                      <input
                        type="text"
                        autoFocus
                        value={newSkillText}
                        onChange={(e) => setNewSkillText(e.target.value)}
                        onBlur={() => {
                          if (newSkillText.trim()) addSkill(selectedMeeting.id, newSkillText);
                          setIsAddingSkill(false);
                          setNewSkillText('');
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            if (newSkillText.trim()) addSkill(selectedMeeting.id, newSkillText);
                            setIsAddingSkill(false);
                            setNewSkillText('');
                          } else if (e.key === 'Escape') {
                            setIsAddingSkill(false);
                            setNewSkillText('');
                          }
                        }}
                        style={{
                          padding: '4px 10px',
                          borderRadius: '100px',
                          background: 'var(--bg-muted)',
                          border: '1px solid var(--primary)',
                          color: 'var(--text-main)',
                          fontSize: '12px',
                          outline: 'none',
                          width: '120px'
                        }}
                        placeholder="Type skill..."
                      />
                    ) : (
                      <button
                        onClick={() => setIsAddingSkill(true)}
                        style={{
                          padding: '4px 10px',
                          borderRadius: '100px',
                          background: 'transparent',
                          border: '1px dashed var(--text-muted)',
                          color: 'var(--text-muted)',
                          fontSize: '12px',
                          fontWeight: 400,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          transition: 'all 0.15s ease'
                        }}
                        onMouseOver={(e) => { e.currentTarget.style.borderColor = 'var(--text-main)'; e.currentTarget.style.color = 'var(--text-main)'; }}
                        onMouseOut={(e) => { e.currentTarget.style.borderColor = 'var(--text-muted)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
                      >
                        + Add Skill
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Action Items Checklist */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <h3 style={{ fontSize: '15px', fontWeight: 500, margin: 0, color: 'var(--text-main)' }}>
                    Action Items ({(selectedMeeting.actionItems || []).filter(a => a.done).length}/{(selectedMeeting.actionItems || []).length})
                  </h3>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {(selectedMeeting.actionItems || []).map(item => (
                    <div
                      key={item.id}
                      onClick={() => toggleActionItem(selectedMeeting.id, item.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '10px 14px',
                        background: item.done ? 'transparent' : 'var(--bg-muted)',
                        borderRadius: '10px',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <div style={{
                        width: '18px',
                        height: '18px',
                        borderRadius: '5px',
                        border: item.done ? 'none' : '1px solid var(--border-light)',
                        background: item.done ? 'var(--primary)' : 'transparent',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#ffffff',
                        flexShrink: 0
                      }}>
                        {item.done && <Check size={12} strokeWidth={2.5} />}
                      </div>
                      <input
                        value={item.text}
                        onChange={(e) => editActionItem(selectedMeeting.id, item.id, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          flex: 1,
                          fontSize: '13px',
                          color: item.done ? 'var(--text-muted)' : 'var(--text-main)',
                          textDecoration: item.done ? 'line-through' : 'none',
                          lineHeight: 1.4,
                          background: 'transparent',
                          border: 'none',
                          outline: 'none',
                          fontFamily: 'inherit'
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>



            </div>
          </div>
        ) : (
          <div className="hidden lg:flex flex-1 items-center justify-center bg-[var(--bg-panel)] border border-[var(--border-light)] rounded-[20px] text-[var(--text-muted)] text-[14px]">
            Select a meeting to view its summary, actions, and diarized transcript
          </div>
        )}

      </div>

    </div>
  );
}

export default MeetingsView;
