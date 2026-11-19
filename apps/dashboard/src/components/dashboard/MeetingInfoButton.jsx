import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

const POPOVER_WIDTH = 300;
const GAP = 8;
const EDGE = 8;

function computePos(trigger) {
  const r = trigger.getBoundingClientRect();
  const width = Math.min(POPOVER_WIDTH, window.innerWidth - EDGE * 2);
  let left = r.left;
  if (left + width > window.innerWidth - EDGE) {
    left = Math.max(EDGE, r.right - width);
  }
  left = Math.max(EDGE, Math.min(left, window.innerWidth - width - EDGE));

  let top = r.bottom + GAP;
  const approxHeight = 220;
  if (top + approxHeight > window.innerHeight - EDGE) {
    top = Math.max(EDGE, r.top - approxHeight - GAP);
  }
  return { top, left, width };
}

export function MeetingInfoButton({ platform, logo, url, time, organizer, guests, details }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: POPOVER_WIDTH });
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const closeTimer = useRef(null);

  const place = () => {
    if (!triggerRef.current) return;
    setPos(computePos(triggerRef.current));
  };

  const show = () => {
    clearTimeout(closeTimer.current);
    if (triggerRef.current) setPos(computePos(triggerRef.current));
    setOpen(true);
  };

  const hideSoon = () => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };

  const hideNow = () => {
    clearTimeout(closeTimer.current);
    setOpen(false);
  };

  useLayoutEffect(() => {
    if (!open) return undefined;
    place();
    const panel = panelRef.current;
    if (panel && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      const height = panel.offsetHeight;
      let top = r.bottom + GAP;
      if (top + height > window.innerHeight - EDGE) {
        top = Math.max(EDGE, r.top - height - GAP);
      }
      setPos((prev) => ({ ...prev, top }));
    }
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onScrollOrResize = () => place();
    const onKey = (e) => { if (e.key === 'Escape') hideNow(); };
    const onPointer = (e) => {
      const t = e.target;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      hideNow();
    };
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer, true);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer, true);
    };
  }, [open]);

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const rows = [
    url != null && {
      label: 'URL',
      node: url ? (
        <a href={url} target="_blank" rel="noreferrer" style={{ color: 'var(--text-main)', textDecoration: 'none', fontWeight: 500, wordBreak: 'break-all' }}>
          {url}
        </a>
      ) : (
        <span style={{ color: 'var(--text-main)', fontWeight: 500 }}>No meeting URL</span>
      )
    },
    time && {
      label: 'Time',
      node: <span style={{ color: 'var(--text-main)', fontWeight: 500 }}>{time}</span>
    },
    organizer && {
      label: 'Organizer',
      node: <span style={{ color: 'var(--text-main)', fontWeight: 500 }}>{organizer}</span>
    },
    guests?.length > 0 && {
      label: 'Guests',
      node: <span style={{ color: 'var(--text-main)', fontWeight: 500, lineHeight: 1.4 }}>{guests.join(', ')}</span>
    },
    details && {
      label: 'Details',
      node: <span style={{ color: 'var(--text-main)', fontWeight: 500, lineHeight: 1.4, opacity: 0.9 }}>{details}</span>
    }
  ].filter(Boolean);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Meeting info"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          if (open) hideNow();
          else show();
        }}
        onMouseEnter={show}
        onMouseLeave={hideSoon}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          margin: 0,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          flexShrink: 0,
          lineHeight: 0,
          position: 'relative',
          zIndex: 1
        }}
      >
        <Info size={20} color="var(--text-muted)" style={{ opacity: open ? 1 : 0.7 }} />
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          onMouseEnter={show}
          onMouseLeave={hideSoon}
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            width: pos.width,
            maxHeight: 'min(360px, calc(100vh - 24px))',
            overflowY: 'auto',
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-light)',
            borderRadius: '8px',
            padding: '16px',
            boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
            zIndex: 2147483000,
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            pointerEvents: 'auto'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingBottom: '12px', borderBottom: '1px solid var(--border-light)' }}>
            {logo}
            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-main)' }}>
              {platform || 'Meeting'}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {rows.map((row) => (
              <div key={row.label} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '13px' }}>
                <span style={{ color: 'var(--text-muted)', width: '64px', flexShrink: 0 }}>{row.label}</span>
                <div style={{ minWidth: 0, flex: 1 }}>{row.node}</div>
              </div>
            ))}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
