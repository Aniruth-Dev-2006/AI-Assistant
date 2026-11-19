import React, { useEffect, useState, useRef } from 'react';
import {
  Settings2, Shield, Workflow, Upload, CheckCircle2, Circle, User, Info, Sparkles, ChevronDown, Check, Camera, Building2
} from 'lucide-react';
import { api } from '../../lib/api';
import { syncProfileLocal, getProfileLocal } from '../../lib/auth';
import OrganizationPanel from './OrganizationPanel';

const API_BASE = (() => {
  const env = import.meta.env.VITE_API_URL;
  if (env && !String(env).startsWith('/')) return String(env).replace(/\/$/, '');
  if (typeof window !== 'undefined') {
    const { protocol, hostname, port } = window.location;
    if (/^517\d$/.test(String(port || ''))) return 'http://localhost:8080';
    if (port === '5173' || port === '5174' || port === '5178') return 'http://localhost:8080';
    return `${protocol}//${hostname}${port ? `:${port}` : ''}`.replace(/\/$/, '');
  }
  return 'http://localhost:8080';
})();

const NAV = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'organization', label: 'Organization', icon: Building2 },
  { id: 'privacy', label: 'Privacy & Security', icon: Shield },
  { id: 'integrations', label: 'Integrations', icon: Workflow },
  { id: 'export', label: 'Data Export', icon: Upload }
];

const DEEPGRAM_LANGUAGES = [
  { value: 'multi', label: 'Auto-Detect (Multi)' },
  { value: 'en', label: 'English' },
  { value: 'zh', label: 'Chinese (Mandarin)' },
  { value: 'zh-TW', label: 'Chinese (Traditional)' },
  { value: 'nl', label: 'Dutch' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'hi', label: 'Hindi' },
  { value: 'id', label: 'Indonesian' },
  { value: 'it', label: 'Italian' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ru', label: 'Russian' },
  { value: 'es', label: 'Spanish' },
  { value: 'sv', label: 'Swedish' },
  { value: 'ta', label: 'Tamil' },
  { value: 'tr', label: 'Turkish' },
  { value: 'uk', label: 'Ukrainian' }
];

const inputStyle = {
  width: '100%',
  padding: '11px 14px',
  borderRadius: 8,
  border: '1px solid var(--border-light)',
  background: 'var(--bg-main)',
  color: 'var(--text-main)',
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box'
};

const labelStyle = {
  display: 'block',
  fontSize: 13,
  fontWeight: 600,
  marginBottom: 8,
  color: 'var(--text-main)'
};

const sectionHeader = (title, subtitle, extra) => (
  <div style={{ padding: '32px 40px', borderBottom: '1px solid var(--border-light)' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <h3 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: 'var(--text-main)' }}>{title}</h3>
      {extra}
    </div>
    {subtitle ? (
      <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>{subtitle}</p>
    ) : null}
  </div>
);

function StatusBadge({ connected }) {
  return connected ? (
    <span style={{ fontSize: 12, fontWeight: 600, color: '#059669', display: 'flex', alignItems: 'center', gap: 4 }}>
      <CheckCircle2 size={14} /> Connected
    </span>
  ) : (
    <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
      <Circle size={14} /> Not connected
    </span>
  );
}

function persistLanguage(value) {
  localStorage.setItem('default_language', value);
  localStorage.setItem('sttLanguage', value);
}

function fallbackAvatar(name) {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'User')}&background=0D8ABC&color=fff&size=128`;
}

function resizeImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error('Please choose an image file'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read image'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image'));
      img.onload = () => {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const min = Math.min(img.width, img.height);
        const sx = (img.width - min) / 2;
        const sy = (img.height - min) / 2;
        ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function LanguageSelect({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selected = DEEPGRAM_LANGUAGES.find((o) => o.value === value) || DEEPGRAM_LANGUAGES[0];

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          ...inputStyle,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          cursor: 'pointer',
          textAlign: 'left',
          background: 'var(--bg-main)',
          boxShadow: open ? '0 0 0 3px rgba(11, 92, 255, 0.12)' : 'none',
          borderColor: open ? 'rgba(11, 92, 255, 0.45)' : 'var(--border-light)'
        }}
      >
        <span style={{ fontSize: 14, color: 'var(--text-main)', fontWeight: 500 }}>{selected.label}</span>
        <ChevronDown
          size={16}
          color="var(--text-muted)"
          style={{ flexShrink: 0, transition: 'transform 0.15s ease', transform: open ? 'rotate(180deg)' : 'none' }}
        />
      </button>

      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            zIndex: 40,
            maxHeight: 280,
            overflowY: 'auto',
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-light)',
            borderRadius: 10,
            boxShadow: '0 12px 32px rgba(15, 23, 42, 0.12), 0 2px 6px rgba(15, 23, 42, 0.06)',
            padding: 6
          }}
        >
          {DEEPGRAM_LANGUAGES.map((opt) => {
            const active = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  padding: '9px 12px',
                  border: 'none',
                  borderRadius: 7,
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: 13.5,
                  fontWeight: active ? 600 : 500,
                  color: 'var(--text-main)',
                  background: active ? 'var(--bg-muted)' : 'transparent'
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.background = 'var(--bg-muted)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = active ? 'var(--bg-muted)' : 'transparent';
                }}
              >
                <span>{opt.label}</span>
                {active ? <Check size={15} color="#0B5CFF" strokeWidth={2.5} /> : <span style={{ width: 15 }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function KnowledgeBaseManager() {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const loadDocs = async () => {
    try {
      const data = await api.getKnowledgeDocs();
      setDocs(data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDocs();
  }, []);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await api.uploadKnowledgeDoc(file, null, file.name, 'Uploaded from settings');
      await loadDocs();
    } catch (e) {
      alert(e.message || 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this document?')) return;
    try {
      await api.deleteKnowledgeDoc(id);
      await loadDocs();
    } catch (e) {
      alert(e.message || 'Delete failed');
    }
  };

  return (
    <div style={{ marginTop: 24, borderTop: '1px solid var(--border-light)', paddingTop: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text-main)' }}>Knowledge Base</h4>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
            Upload PDFs, Markdown, or Text documents to power the Sales Mode AI.
          </p>
        </div>
        <div>
          <input type="file" ref={fileRef} onChange={handleUpload} style={{ display: 'none' }} accept=".md,.txt,.pdf" />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            style={{
              padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border-light)',
              background: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 500,
              display: 'flex', alignItems: 'center', gap: 6
            }}
          >
            <Upload size={14} />
            {uploading ? 'Uploading...' : 'Upload Document'}
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading...</div>
      ) : docs.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', background: 'var(--bg-muted)', borderRadius: 8, fontSize: 13, color: 'var(--text-muted)' }}>
          No documents uploaded yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {docs.map(d => (
            <div key={d._id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 16px', border: '1px solid var(--border-light)', borderRadius: 8, background: '#fff'
            }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-main)' }}>{d.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {d.totalChunks} chunks • {d.status} • {new Date(d.createdAt).toLocaleDateString()}
                </div>
              </div>
              <button
                onClick={() => handleDelete(d._id)}
                style={{
                  background: 'none', border: 'none', color: '#ef4444', fontSize: 13, cursor: 'pointer', padding: '4px 8px'
                }}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GeneralPanel() {
  const local = getProfileLocal();
  const [displayName, setDisplayName] = useState(local.displayName || '');
  const [email, setEmail] = useState(local.email || '');
  const [avatarUrl, setAvatarUrl] = useState(local.avatarUrl || '');
  const [provider, setProvider] = useState('');
  const [botName, setBotName] = useState(localStorage.getItem('bot_display_name') || 'Assistant');
  const [language, setLanguage] = useState(
    localStorage.getItem('sttLanguage') || localStorage.getItem('default_language') || 'multi'
  );
  const [saveHint, setSaveHint] = useState('');
  const [avatarBusy, setAvatarBusy] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const prefs = await api.getPreferences();
        if (cancelled || !prefs) return;
        if (prefs.preferredLanguage) {
          setLanguage(prefs.preferredLanguage);
          persistLanguage(prefs.preferredLanguage);
        }
        if (prefs.botDisplayName) {
          setBotName(prefs.botDisplayName);
          localStorage.setItem('bot_display_name', prefs.botDisplayName);
        }
        if (prefs.displayName) setDisplayName(prefs.displayName);
        if (prefs.email) setEmail(prefs.email);
        if (prefs.avatarUrl != null) setAvatarUrl(prefs.avatarUrl || '');
        if (prefs.provider) setProvider(prefs.provider);
        syncProfileLocal({
          displayName: prefs.displayName || '',
          email: prefs.email || '',
          avatarUrl: prefs.avatarUrl || ''
        });
      } catch {
        /* local defaults */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const savePrefs = async (next, okMsg = 'Saved') => {
    setSaveHint('Saving…');
    try {
      const saved = await api.savePreferences(next);
      if (saved.displayName != null || saved.email != null || saved.avatarUrl != null) {
        syncProfileLocal({
          displayName: saved.displayName ?? displayName,
          email: saved.email ?? email,
          avatarUrl: saved.avatarUrl ?? avatarUrl
        });
      }
      setSaveHint(okMsg);
      setTimeout(() => setSaveHint(''), 2500);
      return saved;
    } catch {
      if (next.displayName || next.avatarUrl != null) {
        syncProfileLocal({
          displayName: next.displayName ?? displayName,
          email,
          avatarUrl: next.avatarUrl !== undefined ? next.avatarUrl : avatarUrl
        });
      }
      setSaveHint('Saved locally (sign in to sync across devices)');
      setTimeout(() => setSaveHint(''), 3000);
      return null;
    }
  };

  const onPickAvatar = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setAvatarBusy(true);
    try {
      const dataUrl = await resizeImageFile(file);
      setAvatarUrl(dataUrl);
      await savePrefs({ avatarUrl: dataUrl }, 'Profile photo updated');
    } catch (err) {
      setSaveHint(err.message || 'Could not update photo');
      setTimeout(() => setSaveHint(''), 3000);
    } finally {
      setAvatarBusy(false);
    }
  };

  const previewSrc = avatarUrl || fallbackAvatar(displayName || email || 'User');
  const providerLabel = provider === 'microsoft' ? 'Microsoft' : provider === 'google' ? 'Google' : provider || 'Signed in';

  return (
    <>
      {sectionHeader('General', 'Your account profile and workspace defaults for the meeting bot.')}
      <div style={{ padding: '32px 40px', display: 'flex', flexDirection: 'column', gap: 32, maxWidth: 600 }}>

        <div style={{
          border: '1px solid var(--border-light)',
          borderRadius: 14,
          padding: 20,
          background: 'var(--bg-main)'
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 18 }}>
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <img
                src={previewSrc}
                alt="Profile"
                style={{
                  width: 72, height: 72, borderRadius: '50%', objectFit: 'cover',
                  border: '1px solid var(--border-light)', background: 'var(--bg-muted)'
                }}
              />
              <button
                type="button"
                disabled={avatarBusy}
                onClick={() => fileRef.current && fileRef.current.click()}
                title="Change photo"
                style={{
                  position: 'absolute', right: -2, bottom: -2,
                  width: 28, height: 28, borderRadius: '50%',
                  border: '1px solid var(--border-light)',
                  background: 'var(--bg-panel)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: avatarBusy ? 'wait' : 'pointer',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.08)'
                }}
              >
                <Camera size={13} color="var(--text-main)" />
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                style={{ display: 'none' }}
                onChange={onPickAvatar}
              />
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-main)', marginBottom: 2 }}>
                {displayName || 'Your name'}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10 }}>
                {email || 'No email on file'}
                {provider ? ` · ${providerLabel}` : ''}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => fileRef.current && fileRef.current.click()}
                  disabled={avatarBusy}
                  style={{
                    padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                    border: '1px solid var(--border-light)', background: 'var(--bg-panel)',
                    color: 'var(--text-main)', cursor: 'pointer'
                  }}
                >
                  {avatarBusy ? 'Uploading…' : 'Upload photo'}
                </button>
                {avatarUrl ? (
                  <button
                    type="button"
                    onClick={async () => {
                      setAvatarUrl('');
                      await savePrefs({ avatarUrl: '' }, 'Photo removed');
                    }}
                    style={{
                      padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                      border: '1px solid var(--border-light)', background: 'transparent',
                      color: 'var(--text-muted)', cursor: 'pointer'
                    }}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={labelStyle}>Full name</label>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                onBlur={() => {
                  if (displayName.trim()) savePrefs({ displayName: displayName.trim() }, 'Name updated');
                }}
                placeholder="Your name"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Email</label>
              <div style={{
                ...inputStyle,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                background: 'var(--bg-muted)',
                color: 'var(--text-muted)',
                cursor: 'default'
              }}>
                <User size={15} color="var(--text-muted)" />
                <span style={{ fontSize: 14 }}>{email || 'Signed-in account email'}</span>
              </div>
              <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                Managed by your sign-in provider and cannot be changed here.
              </p>
            </div>
          </div>
        </div>

        <div>
          <label style={labelStyle}>Bot display name</label>
          <input
            value={botName}
            onChange={(e) => {
              const v = e.target.value;
              setBotName(v);
              localStorage.setItem('bot_display_name', v);
            }}
            onBlur={() => {
              if (botName.trim()) savePrefs({ botDisplayName: botName.trim() }, 'Bot name saved — applies to the next join');
            }}
            style={inputStyle}
          />
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
            Name shown when the bot joins Meet, Zoom, or Teams.
          </p>
        </div>
        <div>
          <label style={labelStyle}>Transcript language (Deepgram)</label>
          <LanguageSelect
            value={language}
            onChange={(v) => {
              setLanguage(v);
              persistLanguage(v);
              savePrefs({ preferredLanguage: v }, 'Language saved — applies to the next bot session');
            }}
          />
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
            Used for STT on the next bot session (calendar auto-join and manual join).
          </p>
        </div>



        {saveHint ? (
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>{saveHint}</p>
        ) : null}
      </div>
    </>
  );
}

function PrivacyPanel() {
  return (
    <>
      {sectionHeader('Privacy & Security', 'How interview data is stored and who can access it.')}
      <div style={{ padding: '32px 40px', maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div>
          <h4 style={{ margin: '0 0 6px', fontSize: 14, fontWeight: 600, color: 'var(--text-main)' }}>Data retention</h4>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>
            Transcripts, notes, and generated reports are retained for your organization workspace until deleted by an admin.
          </p>
        </div>
        <div>
          <h4 style={{ margin: '0 0 6px', fontSize: 14, fontWeight: 600, color: 'var(--text-main)' }}>Access control</h4>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>
            Reports are scoped to the signed-in account and organization. Share links are not enabled in this build.
          </p>
        </div>
      </div>
    </>
  );
}

function ExportPanel() {
  return (
    <>
      {sectionHeader('Data Export', 'Download interview records for compliance or offline review.')}
      <div style={{ padding: '32px 40px', maxWidth: 560 }}>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>
          Bulk transcript and report export will be available in a later release. Individual reports can be reviewed from Meetings.
        </p>
        <button
          type="button"
          disabled
          style={{
            padding: '10px 16px',
            borderRadius: 8,
            border: '1px solid var(--border-light)',
            background: 'var(--bg-muted)',
            color: 'var(--text-muted)',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'not-allowed'
          }}
        >
          Export workspace data — coming soon
        </button>
      </div>
    </>
  );
}

function openAuthInBrowser(url) {
  if (!url) return;
  if (window.electronAPI && typeof window.electronAPI.openExternal === 'function') {
    window.electronAPI.openExternal(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

function IntegrationRow({ name, description, connected, actionLabel, href, error, icon, onDisconnect, onConnect }) {
  const handleConnect = (e) => {
    e.preventDefault();
    if (typeof onConnect === 'function') onConnect(href);
    else openAuthInBrowser(href);
  };

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <div style={{
        width: 44, height: 44, borderRadius: 10, border: '1px solid var(--border-light)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-main)', flexShrink: 0
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-main)' }}>{name}</span>
            <StatusBadge connected={connected} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {connected && error ? (
              <button
                type="button"
                onClick={handleConnect}
                style={{
                  padding: '6px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 8,
                  border: '1px solid var(--border-light)',
                  background: 'var(--text-main)',
                  color: 'var(--bg-main)',
                  cursor: 'pointer'
                }}
              >
                Reconnect
              </button>
            ) : null}
            {onDisconnect ? (
              <button
                type="button"
                onClick={onDisconnect}
                style={{
                  padding: '6px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 8,
                  border: '1px solid var(--border-light)',
                  background: 'transparent',
                  color: 'var(--text-main)',
                  cursor: 'pointer'
                }}
              >
                Disconnect
              </button>
            ) : (
              <button
                type="button"
                onClick={handleConnect}
                style={{
                  padding: '6px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 8,
                  border: '1px solid var(--border-light)',
                  background: connected && !error ? 'transparent' : 'var(--text-main)',
                  color: connected && !error ? 'var(--text-main)' : 'var(--bg-main)',
                  cursor: 'pointer'
                }}
              >
                {actionLabel}
              </button>
            )}
          </div>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>{description}</p>
        {error ? (
          <div style={{
            marginTop: 10, padding: '10px 12px', borderRadius: 8,
            border: '1px solid #fecaca', background: '#fef2f2'
          }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: '#b91c1c' }}>Sync issue</p>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#991b1b', lineHeight: 1.5 }}>{error}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function IntegrationsTutorial() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Integrations tutorial"
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-muted)', padding: 4, borderRadius: '50%'
        }}
      >
        <Info size={16} strokeWidth={2} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 28, left: 0, zIndex: 100,
          background: '#18181b', color: '#ffffff', borderRadius: 16,
          padding: 24, width: 320, boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
          border: '1px solid #27272a'
        }}>
          <div style={{
            position: 'absolute', top: -6, left: 10, width: 12, height: 12,
            background: '#18181b', transform: 'rotate(45deg)', borderTop: '1px solid #27272a', borderLeft: '1px solid #27272a'
          }} />
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 16px 0' }}>Integrations tutorial</h3>
          <div style={{
            background: '#a78bfa', borderRadius: 12, padding: 20,
            marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 12
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-end' }}>
              <div style={{ width: 120, height: 24, background: 'rgba(255,255,255,0.3)', borderRadius: 100, alignSelf: 'flex-start', marginRight: 'auto' }}>
                <div style={{ width: 12, height: 12, background: '#fff', borderRadius: '50%', margin: 6 }} />
              </div>
              <div style={{ width: 20, height: 20, background: 'rgba(255,255,255,0.2)', borderRadius: 10 }} />
              <div style={{ width: 20, height: 20, background: 'rgba(255,255,255,0.2)', borderRadius: 10 }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-end' }}>
              <div style={{
                width: 160, height: 28, background: '#18181b', borderRadius: 100, alignSelf: 'flex-start',
                marginRight: 'auto', display: 'flex', alignItems: 'center', padding: '0 12px'
              }}>
                <Sparkles size={14} color="#fff" />
              </div>
              <div style={{ width: 20, height: 20, background: 'rgba(255,255,255,0.2)', borderRadius: 10 }} />
              <div style={{ width: 20, height: 20, background: 'rgba(255,255,255,0.2)', borderRadius: 10 }} />
              <div style={{ width: 20, height: 20, background: 'rgba(255,255,255,0.2)', borderRadius: 10 }} />
            </div>
          </div>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'rgba(255,255,255,0.75)' }}>
            Connect Google Calendar so upcoming interviews appear in Meetings and the bot can auto-join on time.
          </p>
        </div>
      )}
    </div>
  );
}

function IntegrationsPanel({ connections, loading, onReload }) {
  const hasGoogle = connections.some((c) => String(c.provider || '').toLowerCase() === 'google' && c.enabled !== false);
  const googleConn = connections.find((c) => String(c.provider || '').toLowerCase() === 'google');
  const googleSyncError = googleConn && googleConn.lastSyncError ? String(googleConn.lastSyncError) : '';
  const authTok = localStorage.getItem('auth_token') || '';
  const tokenQ = authTok
    ? `?token=${encodeURIComponent(authTok)}&desktop=1`
    : '?desktop=1';
  const googleAuthUrl = `${API_BASE}/auth/google${tokenQ}`;

  const googleErrorMsg = googleSyncError
    ? (/invalid_grant/i.test(googleSyncError)
      ? 'Google access has expired. Reconnect and approve calendar access again.'
      : googleSyncError)
    : '';

  return (
    <>
      {sectionHeader(
        'Integrations',
        loading ? 'Checking connection status…' : 'Connect Google Calendar so meetings sync and the bot can auto-join.',
        <IntegrationsTutorial />
      )}

      <div style={{ padding: '32px 40px', display: 'flex', flexDirection: 'column', gap: 28, maxWidth: 720 }}>
        <IntegrationRow
          name="Google Calendar"
          connected={hasGoogle}
          actionLabel={hasGoogle ? 'Connected' : 'Connect'}
          onConnect={async () => {
            if (window.electronAPI?.loginWithGoogle) {
              const res = await window.electronAPI.loginWithGoogle();
              if (res?.error) {
                alert(res.error);
              } else {
                onReload();
              }
            } else {
              openAuthInBrowser(googleAuthUrl);
            }
          }}
          onDisconnect={hasGoogle ? async () => {
            if (!confirm('Are you sure you want to disconnect Google Calendar?')) return;
            try {
              if (window.electronAPI?.disconnectCalendar) {
                await window.electronAPI.disconnectCalendar();
              }
              if (googleConn?._id && googleConn._id !== 'google-oauth-desktop') {
                await api.disconnectCalendar(googleConn._id);
              }
              onReload();
            } catch (e) {
              alert(e.message || 'Failed to disconnect');
            }
          } : undefined}
          href={googleAuthUrl}
          error={googleErrorMsg}
          description={
            `Sync Google Calendar and auto-join Google Meet. Opens Google sign-in in your browser.` +
            (googleConn && googleConn.providerEmail ? ` Connected as ${googleConn.providerEmail}.` : '')
          }
          icon={
            <svg width="22" height="22" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
              <path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z" />
              <path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z" />
              <path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z" />
              <path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z" />
            </svg>
          }
        />
      </div>
    </>
  );
}

function SalesPanel() {
  const [salesMode, setSalesMode] = useState(localStorage.getItem('sales_mode_active') === 'true');
  const [saveHint, setSaveHint] = useState('');
  const [saving, setSaving] = useState(false);
  const dirtyRef = useRef(false);
  const saveSeq = useRef(0);
  const [hubspotConnected, setHubspotConnected] = useState(false);
  const [hubspotMode, setHubspotMode] = useState('');
  const [hubspotLoading, setHubspotLoading] = useState(true);
  const [hubspotHint, setHubspotHint] = useState('');

  const loadHubspot = async () => {
    try {
      setHubspotLoading(true);
      const status = await api.getHubspotStatus();
      setHubspotConnected(!!status.connected);
      setHubspotMode(status.mode || '');
      return status;
    } catch {
      setHubspotConnected(false);
      setHubspotMode('');
      return null;
    } finally {
      setHubspotLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    api.getPreferences().then(prefs => {
      if (cancelled || !prefs || dirtyRef.current) return;
      if (typeof prefs.salesModeActive === 'boolean') {
        setSalesMode(prefs.salesModeActive);
        localStorage.setItem('sales_mode_active', String(prefs.salesModeActive));
      }
    }).catch(() => {});
    loadHubspot();
    return () => { cancelled = true; };
  }, []);

  const toggleSalesMode = async () => {
    const nextState = !salesMode;
    const seq = ++saveSeq.current;
    dirtyRef.current = true;
    setSalesMode(nextState);
    localStorage.setItem('sales_mode_active', String(nextState));
    setSaving(true);
    setSaveHint('Saving…');
    try {
      const prefs = await api.savePreferences({ salesModeActive: nextState });
      if (seq !== saveSeq.current) return;
      const confirmed = typeof prefs?.salesModeActive === 'boolean' ? prefs.salesModeActive : nextState;
      setSalesMode(confirmed);
      localStorage.setItem('sales_mode_active', String(confirmed));
      setSaveHint(`Sales Mode ${confirmed ? 'enabled' : 'disabled'}`);
      setTimeout(() => setSaveHint(''), 2500);
    } catch {
      if (seq !== saveSeq.current) return;
      setSalesMode(!nextState);
      localStorage.setItem('sales_mode_active', String(!nextState));
      setSaveHint('Failed to save');
      setTimeout(() => setSaveHint(''), 2500);
    } finally {
      if (seq === saveSeq.current) {
        dirtyRef.current = false;
        setSaving(false);
      }
    }
  };

  const connectHubspot = async () => {
    const status = await loadHubspot();
    if (status?.connected) {
      setHubspotHint(status.mode === 'api_key'
        ? 'Connected via HUBSPOT_API_KEY in server .env — no OAuth needed'
        : 'HubSpot is already connected');
      return;
    }
    const authTok = localStorage.getItem('auth_token') || '';
    if (!authTok) {
      setHubspotHint('Sign in before connecting HubSpot');
      return;
    }
    const url = `${API_BASE}/hubspot/auth?token=${encodeURIComponent(authTok)}&desktop=1`;
    openAuthInBrowser(url);
    setHubspotHint('Finish HubSpot auth in the browser, then click Refresh');
  };

  const disconnectHubspot = async () => {
    if (hubspotMode === 'api_key') {
      setHubspotHint('Connected via HUBSPOT_API_KEY — remove it from .env and restart the server to disconnect');
      return;
    }
    try {
      await api.disconnectHubspot();
      setHubspotConnected(false);
      setHubspotMode('');
      setHubspotHint('HubSpot disconnected');
      setTimeout(() => setHubspotHint(''), 2500);
    } catch (e) {
      setHubspotHint(e.message || 'Failed to disconnect');
    }
  };

  return (
    <>
      {sectionHeader('Sales Mode', 'Ground AI responses in your product knowledge and HubSpot prospect context.')}
      <div style={{ padding: '32px 40px', maxWidth: 720 }}>
        <div style={{
          padding: '16px 20px',
          borderRadius: 12,
          border: '1px solid var(--border-light)',
          background: 'var(--bg-muted)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 2, color: 'var(--text-main)' }}>Enable Sales Mode</label>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', maxWidth: 400 }}>
              Use your uploaded product documents to generate specific, grounded follow-ups for the sales rep.
            </p>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={toggleSalesMode}
            style={{
              width: 44, height: 24, borderRadius: 12, border: 'none', cursor: saving ? 'wait' : 'pointer',
              background: salesMode ? '#0B5CFF' : 'var(--border-light)',
              position: 'relative', transition: 'background 0.2s', flexShrink: 0,
              opacity: saving ? 0.7 : 1
            }}
          >
            <div style={{
              width: 18, height: 18, borderRadius: '50%', background: '#fff',
              position: 'absolute', top: 3, left: salesMode ? 23 : 3,
              transition: 'left 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
            }} />
          </button>
        </div>
        
        {saveHint ? (
          <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>{saveHint}</p>
        ) : null}

        <div style={{ marginTop: 28 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600, color: 'var(--text-main)' }}>HubSpot</h3>
          <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Connect CRM so Meetings can show contact, company, and deal context before the call. Free HubSpot CRM is enough.
          </p>
          <div style={{
            padding: '16px 18px',
            borderRadius: 12,
            border: '1px solid var(--border-light)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16
          }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-main)' }}>
                {hubspotLoading ? 'Checking…' : hubspotConnected ? 'Connected' : 'Not connected'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                {hubspotMode === 'api_key'
                  ? 'Using private app token from server .env'
                  : 'Contacts, companies, and deals (read-only)'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button
                type="button"
                onClick={loadHubspot}
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--border-light)',
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Refresh
              </button>
              {hubspotConnected ? (
                <button
                  type="button"
                  onClick={disconnectHubspot}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid var(--border-light)',
                    background: 'transparent',
                    color: 'var(--text-main)',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Disconnect
                </button>
              ) : (
                <button
                  type="button"
                  onClick={connectHubspot}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 8,
                    border: 'none',
                    background: '#FF7A59',
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Connect
                </button>
              )}
            </div>
          </div>
          {hubspotHint ? (
            <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>{hubspotHint}</p>
          ) : null}
        </div>

        <KnowledgeBaseManager />
      </div>
    </>
  );
}

export function Integrations({ initialSection = 'integrations' }) {
  const [section, setSection] = useState(initialSection);
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isSalesOrg, setIsSalesOrg] = useState(false);

  useEffect(() => {
    setSection(initialSection || 'integrations');
  }, [initialSection]);

  const loadConnections = async () => {
    try {
      setLoading(true);
      let list = [];
      if (window.electronAPI?.getCalendarStatus) {
        try {
          const calStatus = await window.electronAPI.getCalendarStatus();
          if (calStatus && calStatus.connected) {
            list.push({
              _id: 'google-oauth-desktop',
              provider: 'google',
              providerEmail: calStatus.user?.email || 'Connected Google Account',
              enabled: true
            });
          }
        } catch (e) {}
      }
      try {
        const serverList = await api.getCalendarConnections();
        const serverConns = Array.isArray(serverList) ? serverList : (serverList.connections || []);
        if (!list.some(c => c.provider === 'google')) {
          list = [...list, ...serverConns];
        }
      } catch (e) {}
      setConnections(list);
    } catch (e) {
      console.error(e);
      setConnections([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConnections();
    api.getPreferences().then(prefs => {
      if (prefs?.orgFeatureFlags?.includes('salesMode')) {
        setIsSalesOrg(true);
      }
    }).catch(() => {});
  }, []);

  const currentNav = isSalesOrg ? [...NAV, { id: 'sales', label: 'Sales Mode', icon: Sparkles }] : NAV;

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', minHeight: 0 }}>
      <aside style={{ width: 240, flexShrink: 0, padding: '32px 24px', background: 'transparent' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Settings2 size={18} strokeWidth={2} color="var(--text-main)" />
          <h2 style={{ fontSize: 17, fontWeight: 600, margin: 0, color: 'var(--text-main)' }}>Settings</h2>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 28px', lineHeight: 1.5 }}>
          Manage workspace preferences and connected services.
        </p>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {currentNav.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  padding: '9px 12px',
                  border: 'none',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: active ? 600 : 500,
                  textAlign: 'left',
                  color: active ? 'var(--text-main)' : 'var(--text-muted)',
                  background: active ? 'var(--bg-panel)' : 'transparent',
                  boxShadow: active ? '0 1px 2px rgba(0,0,0,0.04)' : 'none'
                }}
              >
                <Icon size={15} strokeWidth={2} />
                {item.label}
              </button>
            );
          })}
        </nav>
      </aside>

      <div style={{
        flex: 1,
        minWidth: 0,
        background: 'var(--bg-panel)',
        borderLeft: '1px solid var(--border-light)',
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto'
      }}>
        {section === 'general' && <GeneralPanel />}
        {section === 'organization' && <OrganizationPanel />}
        {section === 'privacy' && <PrivacyPanel />}
        {section === 'integrations' && <IntegrationsPanel connections={connections} loading={loading} onReload={loadConnections} />}
        {section === 'export' && <ExportPanel />}
        {section === 'sales' && <SalesPanel />}
      </div>
    </div>
  );
}

export function SettingsView({ initialSection = 'general' }) {
  return <Integrations initialSection={initialSection} />;
}
