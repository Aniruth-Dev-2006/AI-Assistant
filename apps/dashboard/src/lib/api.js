const BASE = (() => {
  const env = import.meta.env.VITE_API_URL;
  if (env && !String(env).startsWith('/')) return String(env).replace(/\/$/, '');
  if (typeof window !== 'undefined') {
    const { protocol, hostname, port } = window.location;
  // Vite / Electron local UI → talk to local API (any 517x port)
    if (/^517\d$/.test(String(port || ''))) return 'http://localhost:8080';
    if (port === '5173' || port === '5174' || port === '5178') return 'http://localhost:8080';
    // Served from same host as API (Docker / Railway)
    if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') {
      return `${protocol}//${hostname}${port ? `:${port}` : ''}`.replace(/\/$/, '');
    }
    if (port === '8080') return `${protocol}//${hostname}:8080`;
  }
  return 'http://localhost:8080';
})();

function authToken() {
  const t = localStorage.getItem('auth_token') || '';
  if (!t || t === 'dummy_token' || t === 'undefined' || t === 'null') return '';
  return t;
}

async function request(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  const token = authToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${BASE}${path}`, { ...options, headers });
  } catch (e) {
    const err = new Error(e?.message || 'Network error');
    err.code = 'NETWORK_ERROR';
    err.offline = true;
    throw err;
  }

  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(data.error || data.message || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = res.status >= 500 ? 'SERVER_ERROR' : 'HTTP_ERROR';
    throw err;
  }
  return data;
}

export async function checkApiHealth() {
  try {
    const res = await fetch(`${BASE}/health`, { method: 'GET', cache: 'no-store' });
    return res.ok;
  } catch {
    return true; // Non-blocking in template mode
  }
}

export function getApiBase() {
  return BASE;
}

export const api = {
  getUpcomingMeetings: () => request('/meetings/upcoming'),
  getPastMeetings: () => request('/meetings/past'),
  getReports: (params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v != null && v !== '') q.set(k, v);
    });
    const qs = q.toString();
    return request(`/reports${qs ? `?${qs}` : ''}`);
  },
  getReport: (sessionId) => request(`/reports/${sessionId}`),
  regenerateReport: (sessionId) => request(`/reports/${sessionId}/regenerate`, { method: 'POST' }),
  saveReportNotes: (sessionId, notes) => request(`/reports/${sessionId}/notes`, {
    method: 'PATCH',
    body: JSON.stringify({ notes })
  }),
  askReport: (sessionId, question, history = []) => request(`/reports/${sessionId}/ask`, {
    method: 'POST',
    body: JSON.stringify({ question, history })
  }),
  getCalendarConnections: () => request('/calendars/connections'),
  disconnectCalendar: (id) => request(`/calendars/connections/${id}`, { method: 'DELETE' }),
  getCalendarEvents: (params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v != null && v !== '') q.set(k, v);
    });
    const qs = q.toString();
    return request(`/calendars/events${qs ? `?${qs}` : ''}`);
  },
  syncCalendar: () => request('/calendars/sync', { method: 'POST' }),
  exchangeGoogleToken: (accessToken) => request('/auth/google-token', {
    method: 'POST',
    body: JSON.stringify({ access_token: accessToken })
  }),
  getPreferences: () => request(`/auth/preferences?_t=${Date.now()}`),
  savePreferences: (prefs) => request('/auth/preferences', {
    method: 'PATCH',
    body: JSON.stringify(prefs)
  }),
  register: (body) => request('/auth/register', {
    method: 'POST',
    body: JSON.stringify(body)
  }),
  login: (body) => request('/auth/login', {
    method: 'POST',
    body: JSON.stringify(body)
  }),
  getOrganization: () => request('/organizations/me'),
  createOrganization: (body) => request('/organizations', {
    method: 'POST',
    body: JSON.stringify(body)
  }),
  updateOrganization: (body) => request('/organizations/me', {
    method: 'PATCH',
    body: JSON.stringify(body)
  }),
  getOrganizationMembers: () => request('/organizations/me/members'),
  updateOrganizationMember: (userId, body) => request(`/organizations/me/members/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify(body)
  }),
  removeOrganizationMember: (userId) => request(`/organizations/me/members/${userId}`, {
    method: 'DELETE'
  }),
  getOrganizationInvites: () => request('/organizations/me/invites'),
  createOrganizationInvite: (body) => request('/organizations/me/invites', {
    method: 'POST',
    body: JSON.stringify(body)
  }),
  revokeOrganizationInvite: (id) => request(`/organizations/me/invites/${id}`, {
    method: 'DELETE'
  }),
  acceptOrganizationInvite: (token) => request('/organizations/invites/accept', {
    method: 'POST',
    body: JSON.stringify({ token })
  }),
  setOrganizationFeatureFlag: (flag, enabled) => request('/organizations/me/feature-flags', {
    method: 'POST',
    body: JSON.stringify({ flag, enabled })
  }),
  getKnowledgeDocs: () => request('/knowledge'),
  getHubspotStatus: () => request('/hubspot/status'),
  disconnectHubspot: () => request('/hubspot/disconnect', { method: 'DELETE' }),
  getMeetingBrief: (meetingId, { refresh = false } = {}) => {
    const q = refresh ? '?refresh=1' : '';
    return request(`/meetings/${meetingId}/brief${q}`);
  },
  uploadKnowledgeDoc: async (file, text, title, description) => {
    const token = authToken();
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    
    const formData = new FormData();
    if (title) formData.append('title', title);
    if (description) formData.append('description', description);
    if (file) {
      formData.append('file', file);
    } else if (text) {
      formData.append('text', text);
    }
    
    const res = await fetch(`${BASE}/knowledge`, {
      method: 'POST',
      headers,
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    return data;
  },
  deleteKnowledgeDoc: (id) => request(`/knowledge/${id}`, { method: 'DELETE' })
};
