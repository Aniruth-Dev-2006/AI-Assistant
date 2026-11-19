function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function providerLabel(provider) {
  const p = String(provider || '').toLowerCase();
  if (p === 'google') return 'Google Calendar';
  if (p === 'microsoft') return 'Microsoft Calendar';
  if (p === 'zoom') return 'Zoom';
  if (p === 'hubspot') return 'HubSpot';
  return 'your account';
}

function buildAuthSuccessPage({ token, provider, flow }) {
  const isIntegration = flow === 'integration' || flow === 'extension';
  const title = isIntegration ? 'Connected successfully' : 'Signed in successfully';
  const subtitle = isIntegration
    ? `${providerLabel(provider)} is linked. You can close this tab.`
    : 'Signed in successfully. You can close this tab and return to the app.';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Cache-Control" content="no-store" />
  <title>${escapeHtml(title)} · Xobin </title>
  <style>
    :root { --ink:#0a0a0b; --muted:#71717a; --line:#e4e4e7; --ok:#16a34a; --ok-soft:#dcfce7; }
    * { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; }
    body {
      font-family: "Segoe UI", ui-sans-serif, system-ui, -apple-system, sans-serif;
      color: var(--ink);
      background: radial-gradient(1200px 600px at 10% -10%, #f4f4f5 0%, transparent 55%), #fafafa;
      display: grid;
      place-items: center;
      padding: 24px;
    }
    .card {
      width: min(420px, 100%);
      background: #fff;
      border: 1px solid var(--line);
      border-radius: 20px;
      padding: 40px 36px 32px;
      text-align: center;
      box-shadow: 0 24px 60px rgba(0,0,0,0.08);
    }
    .brand {
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 28px;
    }
    .check {
      width: 64px; height: 64px; margin: 0 auto 22px; border-radius: 50%;
      background: var(--ok-soft); color: var(--ok);
      display: grid; place-items: center;
    }
    .check svg { width: 30px; height: 30px; }
    h1 { margin: 0 0 10px; font-size: 26px; font-weight: 700; letter-spacing: -0.02em; }
    p { margin: 0 auto; max-width: 32ch; color: var(--muted); font-size: 15px; line-height: 1.5; }
  </style>
</head>
<body>
  <main class="card">
    <div class="brand">Xobin</div>
    <div class="check" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    </div>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(subtitle)}</p>
  </main>
  <script>
    (function () {
      var token = ${JSON.stringify(token || '')};
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage({
            type: 'AUTH_SUCCESS',
            token: token,
            flow: ${JSON.stringify(flow || 'login')},
            provider: ${JSON.stringify(provider || '')}
          }, '*');
        }
      } catch (e) {}
    })();
  </script>
</body>
</html>`;
}

module.exports = { buildAuthSuccessPage };
