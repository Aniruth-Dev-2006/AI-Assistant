import React, { useEffect, useState } from 'react';
import { MapPin, Briefcase, Video } from 'lucide-react';

export default function NotificationToast() {
  const [data, setData] = useState(null);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    // Aggressively override all global CSS that breaks the notification window
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    document.body.style.minWidth = '0';
    document.body.style.minHeight = '0';
    document.body.style.overflow = 'hidden';
    
    const root = document.getElementById('root');
    if (root) {
      root.style.minWidth = '0';
      root.style.minHeight = '0';
      root.style.background = 'transparent';
    }
    
    const appContainer = document.querySelector('.app-container');
    if (appContainer) {
      appContainer.style.background = 'transparent';
    }

    // Parse data from URL query string
    const hash = window.location.hash;
    const searchParams = new URLSearchParams(hash.split('?')[1] || '');
    const dataParam = searchParams.get('data');
    if (dataParam) {
      try {
        setData(JSON.parse(decodeURIComponent(dataParam)));
      } catch (err) {
        console.error('Failed to parse notification data', err);
      }
    }
    
    // Fallback data if testing directly
    if (!dataParam) {
      setData({
        title: 'Product Roadmap Sync',
        timeContext: 'Meeting in 2 minutes',
        mainParticipant: 'Roy Lee',
        otherParticipants: 'Alex Chen  Neel Shanmugam',
        location: 'San Francisco',
        role: 'CEO',
        description: '21-year-old CEO of Cluely, an AI startup known for its undetectable cheating tool',
        joinUrl: 'https://meet.google.com/test'
      });
    }

    // Auto-dismiss after 15 seconds
    const timer = setTimeout(() => {
      handleCloseAnim();
    }, 15000);
    return () => clearTimeout(timer);
  }, []);

  const handleCloseAnim = () => {
    setIsClosing(true);
    setTimeout(() => {
      if (window.electronAPI && window.electronAPI.closeCustomNotification) {
        window.electronAPI.closeCustomNotification();
      } else {
        window.close();
      }
    }, 300); // Wait for transition
  };

  const handleJoin = () => {
    if (data?.joinUrl && window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(data.joinUrl);
    } else if (data?.joinUrl) {
      window.open(data.joinUrl, '_blank'); // Fallback for pure web
    }
    handleCloseAnim();
  };

  if (!data) return null;

  return (
    <div style={{
      width: '100%',
      height: '100vh',
      background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(9, 14, 23, 0.98) 100%)',
      borderRadius: '16px',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      display: 'flex',
      flexDirection: 'column',
      padding: '24px 28px',
      boxSizing: 'border-box',
      fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      position: 'relative',
      overflow: 'hidden',
      color: '#ffffff',
      WebkitAppRegion: 'no-drag',
      userSelect: 'none',
      boxShadow: '0 20px 40px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
      opacity: isClosing ? 0 : 1,
      transform: isClosing ? 'translateY(10px) scale(0.95)' : 'translateY(0) scale(1)',
      transition: 'opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1), transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
    }}>
      {/* Massive, ultra-soft ambient blue glow */}
      <div style={{
        position: 'absolute',
        top: '-150px',
        right: '-100px',
        width: '500px',
        height: '500px',
        background: 'radial-gradient(circle, rgba(37, 99, 235, 0.15) 0%, rgba(37, 99, 235, 0) 70%)',
        zIndex: 0,
        pointerEvents: 'none'
      }} />

      <div style={{ zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%', WebkitAppRegion: 'no-drag', position: 'relative' }}>
        
        {/* Top Right Logo - Sleek integration */}
        <img 
          src="/favicon.svg" 
          alt="Logo" 
          style={{
            position: 'absolute',
            top: '-8px',
            right: '-8px',
            width: '44px',
            height: '44px',
            objectFit: 'contain',
            opacity: 0.9
          }}
        />

        {/* Header / Time */}
        <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '8px', fontWeight: 400, letterSpacing: '0.2px', flexShrink: 0 }}>
          {data.timeContext || 'Meeting starting soon'}
        </div>
        
        {/* Big Title - Refined typography */}
        <div style={{ fontSize: '20px', fontWeight: 600, color: '#f8fafc', marginBottom: '16px', letterSpacing: '-0.3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 0, paddingRight: '50px' }}>
          {data.title || 'Upcoming Meeting'}
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '12px', marginTop: 'auto', justifyContent: 'flex-end' }}>
          <button 
            className="notif-btn-dismiss"
            onClick={handleCloseAnim}
          >
            Dismiss
          </button>
          <button 
            className="notif-btn-join"
            onClick={handleJoin}
          >
            <Video size={15} strokeWidth={2.5} />
            Join Meeting
          </button>
        </div>
      </div>

      <style>
        {`
          .notif-btn-dismiss {
            width: 120px;
            background: transparent;
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 9999px;
            color: #cbd5e1;
            padding: 8px 0;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s ease;
          }
          .notif-btn-dismiss:hover {
            background: rgba(255, 255, 255, 0.05);
            color: #ffffff;
            border-color: rgba(255, 255, 255, 0.25);
          }
          .notif-btn-dismiss:active {
            transform: scale(0.97);
          }
          
          .notif-btn-join {
            width: 150px;
            background: #2563eb;
            border: 1px solid #2563eb;
            border-radius: 9999px;
            color: #ffffff;
            padding: 8px 0;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            transition: all 0.2s ease;
            box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
          }
          .notif-btn-join:hover {
            background: #1d4ed8;
            border-color: #1d4ed8;
            box-shadow: 0 6px 16px rgba(37, 99, 235, 0.4);
          }
          .notif-btn-join:active {
            transform: scale(0.97);
          }
        `}
      </style>
    </div>
  );
}
