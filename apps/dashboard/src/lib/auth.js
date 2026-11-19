const AUTH_TOKEN_KEY = 'auth_token';
const GOOGLE_TOKEN_KEY = 'google_oauth_token';
const USER_NAME_KEY = 'user_name';
const USER_EMAIL_KEY = 'user_email';
const USER_AVATAR_KEY = 'user_avatar';

function isDummyToken(token) {
  const t = String(token || '').trim();
  return !t || t === 'dummy_token' || t === 'undefined' || t === 'null';
}

export function getAuthToken() {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  return isDummyToken(token) ? '' : token;
}

export function isAuthenticated() {
  return !!getAuthToken();
}

export function clearAuth() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(GOOGLE_TOKEN_KEY);
  localStorage.removeItem(USER_NAME_KEY);
  localStorage.removeItem(USER_EMAIL_KEY);
  localStorage.removeItem(USER_AVATAR_KEY);
  window.dispatchEvent(new Event('xobin:auth'));
}

export function purgeInvalidAuth() {
  const google = localStorage.getItem(GOOGLE_TOKEN_KEY);
  const auth = localStorage.getItem(AUTH_TOKEN_KEY);
  if (isDummyToken(google)) localStorage.removeItem(GOOGLE_TOKEN_KEY);
  if (isDummyToken(auth)) localStorage.removeItem(AUTH_TOKEN_KEY);
  if (google && isDummyToken(google) && !getAuthToken()) {
    localStorage.removeItem(USER_NAME_KEY);
    localStorage.removeItem(USER_EMAIL_KEY);
    localStorage.removeItem(USER_AVATAR_KEY);
  }
}

export function setSession({ authToken, googleToken, userName, userEmail, userAvatar } = {}) {
  if (authToken && !isDummyToken(authToken)) {
    localStorage.setItem(AUTH_TOKEN_KEY, authToken);
  }
  if (googleToken && !isDummyToken(googleToken)) {
    localStorage.setItem(GOOGLE_TOKEN_KEY, googleToken);
  }
  if (userName != null && String(userName).trim()) {
    localStorage.setItem(USER_NAME_KEY, String(userName).trim());
  }
  if (userEmail != null && String(userEmail).trim()) {
    localStorage.setItem(USER_EMAIL_KEY, String(userEmail).trim());
  }
  if (userAvatar != null) {
    if (String(userAvatar).trim()) localStorage.setItem(USER_AVATAR_KEY, String(userAvatar).trim());
    else localStorage.removeItem(USER_AVATAR_KEY);
  }
  window.dispatchEvent(new Event('xobin:auth'));
}

export function syncProfileLocal({ displayName, email, avatarUrl } = {}) {
  if (displayName != null && String(displayName).trim()) {
    localStorage.setItem(USER_NAME_KEY, String(displayName).trim());
  }
  if (email != null && String(email).trim()) {
    localStorage.setItem(USER_EMAIL_KEY, String(email).trim());
  }
  if (avatarUrl != null) {
    if (String(avatarUrl).trim()) localStorage.setItem(USER_AVATAR_KEY, String(avatarUrl).trim());
    else localStorage.removeItem(USER_AVATAR_KEY);
  }
  window.dispatchEvent(new Event('xobin:profile'));
}

export function getProfileLocal() {
  return {
    displayName: localStorage.getItem(USER_NAME_KEY) || '',
    email: localStorage.getItem(USER_EMAIL_KEY) || '',
    avatarUrl: localStorage.getItem(USER_AVATAR_KEY) || ''
  };
}

export { AUTH_TOKEN_KEY, GOOGLE_TOKEN_KEY, USER_NAME_KEY, USER_EMAIL_KEY, USER_AVATAR_KEY };
