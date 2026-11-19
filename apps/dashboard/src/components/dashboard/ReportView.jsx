import React, { useState, useRef, useEffect } from 'react';
import {
  Check, Sparkles, X, Play, Video, ChevronRight, ArrowUpRight, Share, Download, FileText, Mail, ArrowLeft, MessageSquare, Clock, Loader2, Link2
} from 'lucide-react';
import { api } from '../../lib/api';
import { MeetingInfoButton } from './MeetingInfoButton';

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function inlineMarkdown(s) {
  return escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function AssistantMarkdown({ text }) {
  const lines = String(text || '').split('\n');
  const nodes = [];
  let listItems = [];

  const flushList = () => {
    if (!listItems.length) return;
    nodes.push(
      <ul key={`ul-${nodes.length}`} style={{ margin: '6px 0 10px', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {listItems.map((item, i) => (
          <li key={i} style={{ margin: 0 }} dangerouslySetInnerHTML={{ __html: inlineMarkdown(item) }} />
        ))}
      </ul>
    );
    listItems = [];
  };

  lines.forEach((raw, idx) => {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*•]\s+(.+)$/);
    if (bullet) {
      listItems.push(bullet[1]);
      return;
    }
    flushList();
    if (!line.trim()) {
      nodes.push(<div key={`sp-${idx}`} style={{ height: 8 }} />);
      return;
    }
    const isHeading = /^\*\*.+\*\*$/.test(line.trim()) || (idx === 0 && line.trim().length < 80);
    nodes.push(
      <p
        key={`p-${idx}`}
        style={{
          margin: isHeading ? '0 0 8px' : '0 0 6px',
          fontWeight: isHeading && /^\*\*.+\*\*$/.test(line.trim()) ? 600 : 400,
          fontSize: isHeading && /^\*\*.+\*\*$/.test(line.trim()) ? 14 : 14,
          lineHeight: 1.55
        }}
        dangerouslySetInnerHTML={{ __html: inlineMarkdown(line.trim()) }}
      />
    );
  });
  flushList();
  return <div style={{ display: 'flex', flexDirection: 'column' }}>{nodes}</div>;
}

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
    return <img src="https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/Teams-Icon-FY26?resMode=sharp2&op_usm=1.5,0.65,15,0&wid=58&hei=58&qlt=100&fit=constrain" alt="Teams" style={{ height: '24px', width: '24px', objectFit: 'contain' }} />;
  }
  return <img src="https://knowledge.workspace.google.com/static/images/icons/product/meet.svg" alt="Meet" style={{ height: '24px', width: '24px', objectFit: 'contain' }} />;
};

export function ReportView({ meeting, onBack }) {
  const meetingData = meeting || {};
  const participants = meetingData.participants || [];
  const salesMode = !!meetingData.salesMode;
  const candidate = participants[0] || meetingData.candidateName || (salesMode ? 'Prospect' : 'Candidate');

  const [activeTab, setActiveTab] = useState('summary');
  const [actionItems, setActionItems] = useState(meetingData.actionItems || []);
  const [verifiedSkills, setVerifiedSkills] = useState(meetingData.verifiedSkills || []);
  const [isAddingSkill, setIsAddingSkill] = useState(false);
  const [newSkillText, setNewSkillText] = useState('');
  const [notes, setNotes] = useState(meetingData.notes || '');
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [saveState, setSaveState] = useState('saved');
  const initialLoadRef = useRef(true);
  const saveTimeoutRef = useRef(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef(null);

  const [showShareMenu, setShowShareMenu] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const shareMenuRef = useRef(null);
  const [shareConfig, setShareConfig] = useState({
    summary: true,
    transcript: true,
    actionHub: true,
    notes: false
  });

  useEffect(() => {
    function handleClickOutside(event) {
      if (shareMenuRef.current && !shareMenuRef.current.contains(event.target)) {
        setShowShareMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    setActionItems(meetingData.actionItems || []);
    setVerifiedSkills(meetingData.verifiedSkills || []);
    setNotes(meetingData.notes || '');
    setActiveTab('summary');
    setChatMessages([]);
    setChatOpen(false);
    setChatInput('');
    setChatLoading(false);
  }, [meetingData.sessionId, meetingData.id]);

  useEffect(() => {
    if (initialLoadRef.current) {
      initialLoadRef.current = false;
      return;
    }
    const sessionId = meetingData.sessionId || meetingData.id;
    if (!sessionId) return;
    setSaveState('saving');
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      api.saveReportNotes(sessionId, notes)
        .then(() => setSaveState('saved'))
        .catch(() => setSaveState('error'));
    }, 700);
    return () => clearTimeout(saveTimeoutRef.current);
  }, [notes]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatOpen, chatLoading]);

  const toggleAction = (id) => {
    setActionItems(prev => prev.map(a => a.id === id ? { ...a, done: !a.done } : a));
  };

  const nowTime = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const handleSendChat = async (preset) => {
    const text = String(preset || chatInput).trim();
    if (!text || chatLoading) return;
    const sessionId = meetingData.sessionId || meetingData.id;
    if (!sessionId) return;

    const history = chatMessages.map((m) => ({
      role: m.role === 'ai' ? 'assistant' : 'user',
      text: m.text
    }));

    setChatOpen(true);
    setChatMessages((prev) => [...prev, { role: 'user', text }]);
    setChatInput('');
    setChatLoading(true);

    try {
      const { answer } = await api.askReport(sessionId, text, history);
      setChatMessages((prev) => [...prev, {
        role: 'ai',
        text: answer || 'No answer returned.',
        time: nowTime()
      }]);
    } catch (err) {
      setChatMessages((prev) => [...prev, {
        role: 'ai',
        text: err?.message || 'Could not answer that question. Please try again.',
        time: nowTime()
      }]);
    } finally {
      setChatLoading(false);
    }
  };

  const SUGGESTIONS = [
    'Summarize the strongest evidence for hire',
    'What concerns should we probe in a follow-up?',
    'List verified skills with transcript support'
  ];

  return (
    <div style={{
      height: '100%', width: '100%',
      display: 'flex',
      background: 'var(--bg-main)',
      position: 'relative'
    }}>
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
      `}</style>

      {/* ════════ LEFT: Main Report Content ════════ */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        minWidth: 0
      }}>

        {/* Fixed Header (Spans only the left report area) */}
        <div style={{ width: '100%', background: 'var(--bg-main)', flexShrink: 0 }}>
          <div style={{
            padding: '24px 64px 0 64px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: '24px'
          }}>
            {/* Back Button */}
            <button onClick={onBack} style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              background: 'none', border: 'none', color: 'var(--text-muted)',
              fontSize: '14px', fontWeight: 500, cursor: 'pointer', padding: 0
            }}>
              <ArrowLeft size={16} /> Back
            </button>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button 
                onClick={() => {
                  const subject = encodeURIComponent(`Meeting Report: ${meetingData.title || 'Untitled'}`);
                  const body = encodeURIComponent(`Check out the AI report for our recent meeting:\n\n${window.location.href}`);
                  window.location.href = `mailto:?subject=${subject}&body=${body}`;
                }}
                style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                background: 'var(--bg-panel)', border: '1px solid var(--border-light)',
                padding: '6px 12px', borderRadius: '6px', fontSize: '13px', fontWeight: 500,
                color: 'var(--text-main)', cursor: 'pointer'
              }}>
                <Mail size={14} color="var(--text-muted)" /> Email
              </button>
              <div style={{ position: 'relative' }}>
                <button 
                  onClick={() => setShowShareMenu(!showShareMenu)}
                  style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  background: showShareMenu ? 'var(--bg-muted)' : 'var(--bg-panel)', border: '1px solid var(--border-light)',
                  padding: '6px 12px', borderRadius: '6px', fontSize: '13px', fontWeight: 500,
                  color: 'var(--text-main)', cursor: 'pointer', transition: 'background 0.2s ease'
                }}>
                  <Share size={14} color="var(--text-muted)" /> Share
                </button>

                {showShareMenu && (
                  <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    backdropFilter: 'blur(4px)'
                  }}>
                    <div ref={shareMenuRef} style={{
                      width: '420px', background: 'var(--bg-panel)', border: '1px solid var(--border-light)',
                      borderRadius: '16px', padding: '24px', boxShadow: 'var(--shadow-lg)',
                      display: 'flex', flexDirection: 'column', gap: '20px'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-main)' }}>Share Report</div>
                        <button onClick={() => setShowShareMenu(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                          <X size={20} />
                        </button>
                      </div>
                      <div style={{ fontSize: '14px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                        Select the sections you want to include in the shared link. Anyone with the link will be able to view these sections.
                      </div>
                      
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', background: 'var(--bg-main)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
                        {[
                          { id: 'summary', label: 'Summary & Scores' },
                          { id: 'transcript', label: 'Transcript & Video' },
                          { id: 'actionHub', label: 'Action Items & Topics' },
                          { id: 'notes', label: 'Team Notes' }
                        ].map(section => (
                          <label key={section.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', fontSize: '14px', color: 'var(--text-main)', fontWeight: 500 }}>
                            <input 
                              type="checkbox" 
                              checked={shareConfig[section.id]}
                              onChange={(e) => setShareConfig(prev => ({ ...prev, [section.id]: e.target.checked }))}
                              style={{ 
                                accentColor: 'var(--text-main)',
                                width: '18px', height: '18px', cursor: 'pointer'
                              }}
                            />
                            {section.label}
                          </label>
                        ))}
                      </div>

                      <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
                        <button 
                          onClick={() => {
                            if (isCopied) return;
                            const activeSections = Object.keys(shareConfig).filter(k => shareConfig[k]).join(',');
                            let baseUrl = window.location.href;
                            if (baseUrl.includes('sections=')) {
                              baseUrl = baseUrl.replace(/sections=[^&]*/, `sections=${activeSections}`);
                            } else {
                              baseUrl += (baseUrl.includes('?') ? '&' : '?') + `sections=${activeSections}`;
                            }
                            navigator.clipboard.writeText(baseUrl)
                              .then(() => {
                                setIsCopied(true);
                                setTimeout(() => {
                                  setIsCopied(false);
                                  setShowShareMenu(false);
                                }, 1500);
                              })
                              .catch(() => alert('Failed to copy link.'));
                          }}
                          style={{
                            flex: 1, 
                            background: isCopied ? '#10b981' : 'var(--text-main)', 
                            color: isCopied ? '#ffffff' : 'var(--bg-panel)',
                            border: 'none', padding: '12px', borderRadius: '100px', fontSize: '14px',
                            fontWeight: 600, cursor: isCopied ? 'default' : 'pointer', display: 'flex', alignItems: 'center', 
                            justifyContent: 'center', gap: '8px', transition: 'all 0.2s ease'
                          }}
                          onMouseOver={(e) => !isCopied && (e.currentTarget.style.opacity = '0.9')}
                          onMouseOut={(e) => !isCopied && (e.currentTarget.style.opacity = '1')}
                        >
                          {isCopied ? (
                            <>
                              <Check size={16} /> Copied!
                            </>
                          ) : (
                            <>
                              <Link2 size={16} /> Copy Link
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>

        {/* Scrollable Content Container */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          width: '100%'
        }}>
          <div style={{ padding: '16px 64px 140px 64px' }}>

            {/* Metadata (Non-Sticky) */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              color: 'var(--text-muted)', fontSize: '13px',
              marginBottom: '12px'
            }}>
              <span>
                {meetingData.date}
                {meetingData.time 
                  ? `, ${meetingData.time}` 
                  : (meetingData.startTime && meetingData.endTime 
                    ? `, ${meetingData.startTime} - ${meetingData.endTime}` 
                    : (meetingData.startTime ? `, ${meetingData.startTime}` : ''))}
                {meetingData.duration ? ` (${meetingData.duration})` : ''}
              </span>
              <span>•</span>
              
              <div className="avatar-group-container">
                {(participants || []).slice(0, 3).map((p, i) => (
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
                {(participants || []).length > 3 && (
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
                    +{(participants || []).length - 3}
                  </div>
                )}
                
                <div className="avatar-popover">
                  <div className="avatar-popover-header">
                    Attendees <span style={{fontSize:'12px', color:'var(--text-muted)'}}>{(participants || []).length}</span>
                  </div>
                  {(participants || []).map((p, i) => (
                    <div key={i} className="avatar-popover-item">
                      <img src={`https://api.dicebear.com/7.x/notionists/svg?seed=${p}&backgroundColor=transparent`} alt={p} />
                      <span>{p}</span>
                    </div>
                  ))}
                </div>
              </div>
              <span style={{ color: 'var(--text-main)', fontWeight: 500 }}>{(participants || []).length} attendees</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
              <h1 style={{ fontSize: '32px', fontWeight: 600, color: 'var(--text-main)', letterSpacing: '-0.5px', margin: 0 }}>
                {meetingData.title}
              </h1>

              <MeetingInfoButton
                platform={meetingData.platform}
                logo={<PlatformLogo platform={meetingData.platform} />}
                url={meetingData.url || null}
                time={
                  meetingData.startTime && meetingData.endTime
                    ? `${meetingData.startTime} - ${meetingData.endTime}`
                    : meetingData.startTime || meetingData.duration || null
                }
                organizer={meetingData.organizer || null}
                guests={meetingData.participants || []}
                details={meetingData.description || null}
              />
            </div>

            {/* Underline Tabs */}
            <div style={{ display: 'flex', gap: '32px', marginBottom: '40px', borderBottom: '1px solid var(--border-light)' }}>
              {['Summary', 'Transcript', 'Action Hub', 'Notes'].map(tab => {
                const isActive = activeTab === tab.toLowerCase();
                return (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab.toLowerCase())}
                    style={{
                      background: 'transparent',
                      color: isActive ? 'var(--text-main)' : 'var(--text-muted)',
                      border: 'none',
                      borderBottom: isActive ? '2px solid var(--text-main)' : '2px solid transparent',
                      padding: '0 0 12px 0',
                      fontSize: '14px',
                      fontWeight: isActive ? 600 : 500,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      marginBottom: '-1px'
                    }}
                  >
                    {tab}
                  </button>
                );
              })}
            </div>

            {/* ════ SUMMARY TAB ════ */}
            {activeTab === 'summary' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '36px' }}>

                {/* Video Recording Placeholder */}
                <div style={{
                  background: 'var(--bg-panel)',
                  border: '1px solid var(--border-light)',
                  borderRadius: '16px',
                  padding: '24px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '16px',
                  minHeight: '280px',
                  position: 'relative',
                  overflow: 'hidden',
                  boxShadow: 'var(--shadow-sm)'
                }}>
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    pointerEvents: 'none',
                    opacity: 0.3,
                    background: 'radial-gradient(circle at center, var(--accent-light) 0%, transparent 70%)'
                  }} />
                  <div style={{
                    width: '64px',
                    height: '64px',
                    borderRadius: '50%',
                    background: 'var(--bg-main)',
                    border: '1px solid var(--border-light)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--accent-main)',
                    boxShadow: 'var(--shadow-md)',
                    zIndex: 1,
                    cursor: 'pointer'
                  }}>
                    <Play size={24} style={{ marginLeft: '4px' }} />
                  </div>
                  <div style={{ textAlign: 'center', zIndex: 1 }}>
                    <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-main)', marginBottom: '4px' }}>Meeting Recording</div>
                    <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>The headless bot video recording will be available here soon.</div>
                  </div>
                </div>

                {/* Top Section: Decision & Score */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', alignItems: 'stretch', width: '100%' }}>

                  {/* Recommendation Card */}
                  {meetingData.recommendation && (() => {
                    const status = meetingData.recommendation.status || (salesMode ? 'Nurture' : 'Maybe');
                    const key = meetingData.recommendation.key;
                    const isPositive = key === 'hire';
                    const isReject = key === 'pass';
                    const colorHex = isPositive ? '#10b981' : isReject ? '#ef4444' : '#3b82f6';

                    return (
                      <div style={{
                        position: 'relative',
                        flex: '1 1 250px',
                        minWidth: '250px',
                        background: 'var(--bg-panel)',
                        border: '1px solid var(--border-light)',
                        borderRadius: '16px',
                        padding: '24px',
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                        boxShadow: 'var(--shadow-sm)'
                      }}>
                        <div style={{
                          position: 'absolute',
                          inset: 0,
                          pointerEvents: 'none',
                          opacity: 0.6,
                          backgroundImage: `url("data:image/svg+xml,%3Csvg width='24' height='24' viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23${colorHex.replace('#', '')}' fill-opacity='0.15' fill-rule='evenodd'%3E%3Ccircle cx='4' cy='4' r='1.5'/%3E%3C/g%3E%3C/svg%3E")`,
                          backgroundSize: '24px 24px',
                          maskImage: 'linear-gradient(to bottom right, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 80%)',
                          WebkitMaskImage: 'linear-gradient(to bottom right, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 80%)'
                        }} />

                        <div style={{ position: 'relative', zIndex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                              {salesMode ? 'Deal Outcome' : 'Final Decision'}
                            </span>
                          </div>
                          <h2 style={{ fontSize: '26px', fontWeight: 700, color: colorHex, margin: '4px 0 0 0' }}>
                            {status}
                          </h2>
                          <p style={{ fontSize: '15px', lineHeight: 1.5, color: 'var(--text-main)', opacity: 0.9, margin: '8px 0 0 0' }}>
                            {meetingData.recommendation.text}
                          </p>
                        </div>
                      </div>
                    );
                  })()}

                  {meetingData.overallScore != null && meetingData.overallScore !== '' && (() => {
                    const score = meetingData.overallScore;
                    const isGood = score >= 8;
                    const isWarning = score >= 6 && score < 8;
                    const scoreColorHex = isGood ? '#10b981' : isWarning ? '#f59e0b' : '#ef4444';

                    return (
                      <div style={{
                        position: 'relative',
                        flex: '1 1 200px',
                        minWidth: '200px',
                        maxWidth: '220px',
                        background: 'var(--bg-panel)',
                        border: '1px solid var(--border-light)',
                        borderRadius: '16px',
                        padding: '24px',
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        flexShrink: 0,
                        boxShadow: 'var(--shadow-sm)'
                      }}>
                        <div style={{
                          position: 'absolute',
                          inset: 0,
                          pointerEvents: 'none',
                          opacity: 0.6,
                          backgroundImage: `url("data:image/svg+xml,%3Csvg width='24' height='24' viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23${scoreColorHex.replace('#', '')}' fill-opacity='0.15' fill-rule='evenodd'%3E%3Ccircle cx='4' cy='4' r='1.5'/%3E%3C/g%3E%3C/svg%3E")`,
                          backgroundSize: '24px 24px',
                          maskImage: 'radial-gradient(circle at center, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 70%)',
                          WebkitMaskImage: 'radial-gradient(circle at center, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 70%)'
                        }} />

                        <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            {salesMode ? 'Deal Health' : 'Overall Score'}
                          </span>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px', marginTop: '4px' }}>
                            <span style={{ fontSize: '42px', fontWeight: 700, color: scoreColorHex, lineHeight: 1 }}>
                              {score}
                            </span>
                            <span style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-muted)' }}>/10</span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Executive Summary */}
                <div>
                  <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-main)', marginBottom: '12px' }}>Executive Summary</h3>
                  <p style={{ fontSize: '15px', lineHeight: 1.6, color: 'var(--text-main)', opacity: 0.9, margin: 0, maxWidth: '900px' }}>
                    {meetingData.summary}
                  </p>
                </div>

                {(verifiedSkills.length > 0 || salesMode) && (
                  <div>
                    <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-main)', marginBottom: '12px' }}>
                      {salesMode ? 'Topics & Pain Points' : 'Verified Skills'}
                    </h3>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', maxWidth: '900px' }}>
                      {verifiedSkills.map((skill, i) => (
                        <div key={i} style={{
                          padding: '6px 12px',
                          borderRadius: '100px',
                          background: 'var(--bg-muted)',
                          border: '1px solid var(--border-light)',
                          color: 'var(--text-main)',
                          fontSize: '13px',
                          fontWeight: 500,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}>
                          <Check size={12} color="var(--text-muted)" />
                          {skill}
                        </div>
                      ))}
                      
                      {isAddingSkill ? (
                        <input
                          type="text"
                          autoFocus
                          value={newSkillText}
                          onChange={(e) => setNewSkillText(e.target.value)}
                          onBlur={() => {
                            if (newSkillText.trim()) setVerifiedSkills([...verifiedSkills, newSkillText]);
                            setIsAddingSkill(false);
                            setNewSkillText('');
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              if (newSkillText.trim()) setVerifiedSkills([...verifiedSkills, newSkillText]);
                              setIsAddingSkill(false);
                              setNewSkillText('');
                            } else if (e.key === 'Escape') {
                              setIsAddingSkill(false);
                              setNewSkillText('');
                            }
                          }}
                          style={{
                            padding: '6px 12px',
                            borderRadius: '100px',
                            background: 'transparent',
                            border: '1px solid var(--primary)',
                            color: 'var(--text-main)',
                            fontSize: '13px',
                            fontWeight: 500,
                            outline: 'none',
                            width: '130px'
                          }}
                          placeholder={salesMode ? 'Type topic...' : 'Type skill...'}
                        />
                      ) : (
                        <button 
                          onClick={() => setIsAddingSkill(true)}
                          style={{
                            padding: '6px 14px',
                            borderRadius: '100px',
                            background: 'transparent',
                            border: '1px dashed var(--border-light)',
                            color: 'var(--text-muted)',
                            fontSize: '13px',
                            fontWeight: 500,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            transition: 'all 0.15s ease'
                          }}
                          onMouseOver={(e) => { e.currentTarget.style.color = 'var(--text-main)'; e.currentTarget.style.borderColor = 'var(--text-main)'; }}
                          onMouseOut={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border-light)'; }}
                        >
                          {salesMode ? '+ Add Topic' : '+ Add Skill'}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {meetingData.strengths && (
                  <div>
                    <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-main)', marginBottom: '10px' }}>
                      {salesMode ? 'What Went Well' : 'Key Strengths'}
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '900px' }}>
                      {meetingData.strengths.map((s, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                          <span style={{ color: '#10b981', fontSize: '14px', lineHeight: '22px', flexShrink: 0 }}>+</span>
                          <span style={{ fontSize: '15px', lineHeight: 1.5, color: 'var(--text-main)', opacity: 0.9 }}>{s}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {meetingData.concerns && (
                  <div>
                    <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-main)', marginBottom: '10px' }}>
                      {salesMode ? 'Risks & Next Steps' : 'Risks & Open Items'}
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '900px' }}>
                      {meetingData.concerns.map((s, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                          <span style={{ color: '#ef4444', fontSize: '14px', lineHeight: '22px', flexShrink: 0 }}>−</span>
                          <span style={{ fontSize: '15px', lineHeight: 1.5, color: 'var(--text-main)', opacity: 0.9 }}>{s}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              </div>
            )}

            {/* ════ TRANSCRIPT TAB ════ */}
            {activeTab === 'transcript' && (
              <div style={{
                display: 'flex',
                flexDirection: chatOpen ? 'column' : 'row',
                gap: chatOpen ? '32px' : '48px',
                alignItems: 'flex-start',
                maxWidth: chatOpen ? '1000px' : '100%'
              }}>
                {/* Video Area */}
                <div style={{
                  width: chatOpen ? '100%' : '560px',
                  flexShrink: 0
                }}>
                  <div style={{
                    width: '100%', aspectRatio: '16/9', maxHeight: chatOpen ? '360px' : 'none',
                    background: '#000', borderRadius: '12px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    overflow: 'hidden', position: 'relative'
                  }}>
                    <Video size={48} color="rgba(255,255,255,0.2)" />
                    <div style={{ position: 'absolute', bottom: '16px', left: '16px', color: '#fff', fontSize: '13px', fontWeight: 500, background: 'rgba(0,0,0,0.5)', padding: '4px 8px', borderRadius: '6px' }}>
                      00:00 / 45:00
                    </div>
                  </div>
                </div>

                {/* Transcript Text */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', flex: 1 }}>
                  {(meetingData.transcript || []).length === 0 && (
                    <p style={{ margin: 0, fontSize: '15px', color: 'var(--text-muted)' }}>
                      {salesMode ? 'No transcript turns for this call.' : 'No transcript turns for this interview.'}
                    </p>
                  )}
                  {(meetingData.transcript || []).map((turn, idx) => (
                    <div key={idx}>
                      <div style={{ marginBottom: '4px', display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                        <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-main)' }}>{turn.speaker}</span>
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{turn.time}</span>
                      </div>
                      <p style={{ margin: 0, fontSize: '15px', lineHeight: 1.6, color: 'var(--text-main)', opacity: 0.9 }}>
                        {turn.text}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ════ ACTION HUB TAB ════ */}
            {activeTab === 'action hub' && (
              <div className="flex flex-col gap-[48px] max-w-[1000px]">

                {/* Action Items */}
                <div>
                  <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-main)', marginBottom: '16px' }}>Meeting Action Items</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '900px' }}>
                    {actionItems.length === 0 && (
                      <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-muted)' }}>
                        {salesMode
                          ? 'No commitments were explicitly agreed on this call.'
                          : 'No commitments were explicitly agreed in this interview.'}
                      </p>
                    )}
                    {actionItems.map(item => (
                      <div
                        key={item.id}
                        onClick={() => toggleAction(item.id)}
                        style={{
                          display: 'flex', alignItems: 'flex-start', gap: '12px', cursor: 'pointer'
                        }}
                      >
                        <div style={{
                          width: '18px', height: '18px', marginTop: '2px', borderRadius: '4px',
                          border: item.done ? 'none' : '1px solid var(--text-muted)',
                          background: item.done ? 'var(--text-main)' : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: 'var(--bg-app)', flexShrink: 0
                        }}>
                          {item.done && <Check size={12} strokeWidth={3} />}
                        </div>
                        <input
                          value={item.text}
                          onChange={(e) => {
                            const newText = e.target.value;
                            setActionItems(prev => prev.map(a => a.id === item.id ? { ...a, text: newText } : a));
                          }}
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            flex: 1,
                            fontSize: '15px', lineHeight: 1.5,
                            color: item.done ? 'var(--text-muted)' : 'var(--text-main)',
                            textDecoration: item.done ? 'line-through' : 'none',
                            opacity: item.done ? 0.7 : 1,
                            background: 'transparent',
                            border: 'none',
                            outline: 'none',
                            fontFamily: 'inherit',
                            cursor: 'text'
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Meeting Topics */}
                {meetingData.topics && meetingData.topics.length > 0 && (
                  <div>
                    <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-main)', marginBottom: '16px' }}>Topics Covered</h3>
                    <div className="flex flex-wrap gap-2">
                      {meetingData.topics.map((topic, i) => (
                        <div key={i} className="px-3 py-1.5 bg-[var(--bg-muted)] border border-[var(--border-light)] rounded-full text-[13px] text-[var(--text-main)] font-medium">
                          {topic}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              </div>
            )}

            {/* ════ NOTES TAB ════ */}
            {activeTab === 'notes' && (
              <div className="flex flex-col max-w-[900px] h-full">
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-4">
                    <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-main)', margin: 0 }}>Team Notes</h3>
                    <div className="flex items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
                      {saveState === 'saving' ? (
                        <>
                          <Loader2 size={12} className="animate-spin" />
                          Saving...
                        </>
                      ) : saveState === 'error' ? (
                        <>Couldn’t save</>
                      ) : (
                        <>
                          <Check size={12} />
                          Saved
                        </>
                      )}
                    </div>
                  </div>
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder={salesMode
                      ? 'Rep notes from the live overlay appear here. Edits save to this report.'
                      : 'Interview notes from the live overlay appear here. Edits save to this report.'}
                    style={{
                      width: '100%', minHeight: '600px', padding: '0',
                      background: 'transparent', border: 'none',
                      color: 'var(--text-main)', fontSize: '15px', lineHeight: 1.7,
                      resize: 'none', outline: 'none', fontFamily: 'inherit'
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Persistent Floating Ask AI Search Bar */}
          <div style={{
            position: 'absolute', bottom: '32px', left: '50%', transform: 'translateX(-50%)',
            zIndex: 100, display: 'flex', alignItems: 'center', gap: '12px', width: '100%', maxWidth: '600px'
          }}>
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: '12px', width: '100%',
                background: 'var(--bg-panel)', border: '1px solid var(--border-light)',
                borderRadius: '100px', padding: '8px 8px 8px 24px',
                boxShadow: '0 8px 32px rgba(0,0,0,0.12)'
              }}
            >
              <input
                type="text"
                placeholder="Ask about this report..."
                value={chatInput}
                disabled={chatLoading}
                onChange={e => setChatInput(e.target.value)}
                onFocus={() => {
                  if (!chatOpen) setChatOpen(true);
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSendChat();
                  }
                }}
                style={{
                  flex: 1, border: 'none', outline: 'none', background: 'transparent',
                  fontSize: '15px', color: 'var(--text-main)'
                }}
              />
              <button
                onClick={() => handleSendChat()}
                disabled={chatLoading || !chatInput.trim()}
                style={{
                  width: '36px', height: '36px', borderRadius: '50%',
                  background: chatLoading || !chatInput.trim() ? 'var(--bg-muted)' : '#0B5CFF',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: 'none', cursor: chatLoading || !chatInput.trim() ? 'default' : 'pointer',
                  opacity: chatLoading || !chatInput.trim() ? 0.6 : 1
                }}
              >
                {chatLoading
                  ? <Loader2 size={18} color="#fff" className="animate-spin" style={{ animation: 'spin 1s linear infinite' }} />
                  : <ArrowUpRight size={18} color={chatInput.trim() ? '#fff' : 'var(--text-main)'} strokeWidth={2} />}
              </button>
            </div>
          </div>
        </div>

      </div>

      {chatOpen && (
        <>
          <div style={{ width: '1px', background: 'var(--border-light)', flexShrink: 0 }} />
          <div style={{
            width: '420px', flexShrink: 0,
            display: 'flex', flexDirection: 'column',
            background: 'var(--bg-panel)',
            height: '100%'
          }}>
            <div style={{
              padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              borderBottom: '1px solid var(--border-light)'
            }}>
              <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-main)', letterSpacing: '-0.01em' }}>imagine</span>
              <button onClick={() => setChatOpen(false)} style={{
                background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)'
              }}>
                <X size={16} />
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {chatMessages.length === 0 && !chatLoading && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    Ask for hire rationale, skill evidence, follow-up questions, or a concise recap for stakeholders.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => handleSendChat(s)}
                        style={{
                          textAlign: 'left',
                          padding: '10px 14px',
                          borderRadius: 10,
                          border: '1px solid var(--border-light)',
                          background: 'var(--bg-main)',
                          color: 'var(--text-main)',
                          fontSize: 13,
                          cursor: 'pointer',
                          lineHeight: 1.4
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {chatMessages.map((msg, i) => {
                const isUser = msg.role === 'user';
                return (
                  <div key={i} style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: isUser ? 'flex-end' : 'flex-start',
                    gap: '4px'
                  }}>
                    {!isUser && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', color: 'var(--text-muted)' }}>
                        <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: 'var(--bg-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Sparkles size={12} color="var(--text-main)" />
                        </div>
                        {msg.time && <span style={{ fontSize: '12px', fontWeight: 500 }}>{msg.time}</span>}
                      </div>
                    )}

                    <div style={{
                      background: isUser ? '#0B5CFF' : 'transparent',
                      color: isUser ? '#fff' : 'var(--text-main)',
                      padding: isUser ? '12px 18px' : '0',
                      borderRadius: '18px',
                      fontSize: '14px',
                      lineHeight: 1.55,
                      maxWidth: isUser ? '90%' : '100%',
                      whiteSpace: isUser ? 'pre-wrap' : 'normal'
                    }}>
                      {isUser ? msg.text : <AssistantMarkdown text={msg.text} />}
                    </div>
                  </div>
                );
              })}

              {chatLoading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 13 }}>
                  <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                  Analyzing report…
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default ReportView;
