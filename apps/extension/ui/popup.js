document.addEventListener('DOMContentLoaded', () => {
    const authWrapper = document.getElementById('auth-wrapper');
    const loggedInState = document.getElementById('logged-in-state');
    const btnEmailLogin = document.getElementById('btn-email-login');
    const btnLogout = document.getElementById('btn-logout');
    const emailInput = document.getElementById('email-input');
    const passwordInput = document.getElementById('password-input');
    const authError = document.getElementById('auth-error');
    const btnConnectGoogle = document.getElementById('btn-connect-google');
    const btnConnectHubspot = document.getElementById('btn-connect-hubspot');

    const API_BASE = 'http://localhost:8080';

    const updateUI = () => {
        chrome.storage.local.get(['auth_token'], (result) => {
            if (result.auth_token && result.auth_token !== 'dummy-token-123') {
                authWrapper.style.display = 'none';
                loggedInState.style.display = 'flex';

                chrome.storage.local.get(['google_connected', 'hubspot_connected'], (gResult) => {
                    if (gResult.google_connected) {
                        btnConnectGoogle.textContent = 'Disconnect';
                        btnConnectGoogle.classList.add('connected');
                    } else {
                        btnConnectGoogle.textContent = 'Connect';
                        btnConnectGoogle.classList.remove('connected');
                    }

                    if (gResult.hubspot_connected) {
                        if (btnConnectHubspot) {
                            btnConnectHubspot.textContent = 'Disconnect';
                            btnConnectHubspot.classList.add('connected');
                        }
                    } else {
                        if (btnConnectHubspot) {
                            btnConnectHubspot.textContent = 'Connect';
                            btnConnectHubspot.classList.remove('connected');
                        }
                    }
                });
            } else {
                authWrapper.style.display = 'flex';
                loggedInState.style.display = 'none';
                authError.style.display = 'none';
                passwordInput.value = '';
            }
        });
    };

    chrome.storage.local.set({ api_base: API_BASE });

    chrome.storage.local.get(['auth_token'], (result) => {
        if (result.auth_token === 'dummy-token-123') {
            chrome.storage.local.remove(['auth_token', 'google_connected', 'hubspot_connected'], () => updateUI());
        } else if (result.auth_token) {
            // Fetch latest Hubspot status on load
            fetch(`${API_BASE}/hubspot/status`, {
                headers: { 'Authorization': `Bearer ${result.auth_token}` }
            })
            .then(res => res.json())
            .then(data => {
                chrome.storage.local.set({ hubspot_connected: !!data.connected }, () => updateUI());
            })
            .catch(() => updateUI());
        } else {
            updateUI();
        }
    });

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && (changes.auth_token || changes.google_connected || changes.hubspot_connected)) {
            updateUI();
        }
    });

    const showAuthError = (msg) => {
        authError.textContent = msg || 'Invalid credentials';
        authError.style.display = 'block';
    };

    btnEmailLogin.addEventListener('click', async () => {
        const email = emailInput.value.trim().toLowerCase();
        const password = passwordInput.value;
        if (!email || !password) {
            showAuthError('Email and password are required');
            return;
        }

        authError.style.display = 'none';
        btnEmailLogin.disabled = true;
        btnEmailLogin.textContent = 'Signing in…';

        try {
            const res = await fetch(`${API_BASE}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.error || data.message || `Login failed (${res.status})`);
            }
            if (!data.token) throw new Error('No token returned from server');

            const salesOn = !!(data.user && data.user.salesModeActive);
            const orgFlags = (data.user && data.user.orgFeatureFlags) || [];
            chrome.storage.local.set({
                auth_token: data.token,
                google_connected: true,
                sales_mode_active: String(salesOn && orgFlags.includes('salesMode')),
                user_email: (data.user && data.user.email) || email,
                api_base: API_BASE
            }, () => updateUI());
        } catch (e) {
            showAuthError(e.message || 'Login failed');
        } finally {
            btnEmailLogin.disabled = false;
            btnEmailLogin.textContent = 'Sign in';
        }
    });

    passwordInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') btnEmailLogin.click();
    });

    btnLogout.addEventListener('click', () => {
        chrome.storage.local.remove(['auth_token', 'google_connected', 'sales_mode_active', 'user_email'], () => {
            updateUI();
        });
    });

    if (btnConnectGoogle) {
        btnConnectGoogle.addEventListener('click', () => {
            chrome.storage.local.get(['auth_token', 'google_connected'], (res) => {
                if (!res.auth_token) return;
                if (res.google_connected) {
                    chrome.storage.local.set({ google_connected: false }, () => updateUI());
                    return;
                }
                chrome.tabs.create({ url: `${API_BASE}/auth/google?token=${res.auth_token}` });
            });
        });
    }

    if (btnConnectHubspot) {
        btnConnectHubspot.addEventListener('click', () => {
            chrome.storage.local.get(['auth_token', 'hubspot_connected'], (res) => {
                if (!res.auth_token) return;
                if (res.hubspot_connected) {
                    fetch(`${API_BASE}/hubspot/disconnect`, {
                        method: 'DELETE',
                        headers: { 'Authorization': `Bearer ${res.auth_token}` }
                    }).then(() => {
                        chrome.storage.local.set({ hubspot_connected: false }, () => updateUI());
                    });
                    return;
                }
                chrome.tabs.create({ url: `${API_BASE}/hubspot/auth?token=${res.auth_token}` });
            });
        });
    }
});
