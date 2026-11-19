import React from 'react';
import { RefreshCw, ServerCrash } from 'lucide-react';

export function ServerUnavailable({ onRetry, checking }) {
  return (
    <div style={{
      display: 'flex',
      flex: 1,
      height: '100%',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#f8fafc',
      padding: '40px 24px',
      fontFamily: 'Inter, system-ui, sans-serif'
    }}>
      <div style={{
        maxWidth: 420,
        width: '100%',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 20,
        background: '#ffffff',
        padding: '48px 32px',
        borderRadius: '16px',
        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.05)',
        border: '1px solid #e2e8f0'
      }}>
        <div style={{
          width: 56,
          height: 56,
          background: '#fee2e2',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#ef4444',
          marginBottom: 4
        }}>
          <ServerCrash size={28} />
        </div>

        <div>
          <h1 style={{
            margin: '0 0 12px',
            fontSize: '22px',
            fontWeight: 600,
            color: '#0f172a',
            lineHeight: 1.2,
            letterSpacing: '-0.02em'
          }}>
            500: Server Unavailable
          </h1>
          <p style={{
            margin: 0,
            fontSize: 15,
            lineHeight: 1.5,
            color: '#64748b'
          }}>
            We're having trouble connecting to the server right now. Please try again in a few moments.
          </p>
        </div>

        <button
          type="button"
          onClick={onRetry}
          disabled={checking}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '12px 24px',
            borderRadius: '8px',
            border: 'none',
            background: '#0f172a',
            color: '#fff',
            fontSize: 14,
            fontWeight: 500,
            cursor: checking ? 'wait' : 'pointer',
            opacity: checking ? 0.7 : 1,
            marginTop: 8,
            width: '100%'
          }}
        >
          <RefreshCw size={16} className={checking ? 'spin' : undefined} />
          {checking ? 'Reconnecting...' : 'Retry Connection'}
        </button>
      </div>
    </div>
  );
}

export default ServerUnavailable;
