# AI Meet Assistant (Xobin)

Real-time AI interview assistant for **Google Meet**, **Microsoft Teams**, and **Zoom**.

A Playwright bot joins the call, Deepgram transcribes audio, Groq LLMs generate interviewer follow-ups and Insights, and a **Chrome extension** overlays a glass UI on the meeting tab. After the meeting, the **dashboard** shows scorecards, transcripts, and a per-report **imagine** Q&A assistant.

---

## Who this doc is for

- Engineers taking over the repo
- Coding agents working in this codebase

Read **Architecture**, **Extension deep dive**, and **Important file map** before changing behavior. Prefer small, targeted edits. Do not invent parallel systems when an existing path already exists.

---

## Repository layout

```
apps/
  extension/          Chrome MV3 overlay — primary live UX (Meet / Teams / Zoom tab)
  server/             Express API (:8080), WebSocket hub, workers, Mongo models
  bot/                Playwright platform bots (join Meet / Teams / Zoom)
  desktop/            Old standalone overlay (+ shared BotManager & Deepgram STT)
  dashboard/          React + Vite web app (The main dashboard UI / website)
  dashboard-desktop/  Electron wrapper for the dashboard
  website/            SaaS landing page 

Dockerfile / docker-compose.yml / run_docker.bat   Containerized API + built dashboard
run_extension.bat                                 Local Windows: server + ngrok
.env.example                                      Required / optional env vars
```

**Day-to-day loop:** `apps/server` + `apps/extension`.  
Root `package.json` also drives Electron.

---

## Architecture

```
Meeting tab
  content.js + ui/renderer.js  (overlay)
        |  chrome.runtime messages
        v
  background.js
        |  FETCH_PROXY (REST) + WebSocket
        |  api_base from chrome.storage (default http://localhost:8080)
        v
  apps/server  (Express + ws-hub)
        |-- POST /bot/start  --> BotManager (apps/desktop/main/bot-manager.js)
        |                         --> Playwright bot (apps/bot/platforms/*)
        |                         --> Deepgram STT (stt-deepgram.js)
        |-- turn:complete    --> llm-worker (Groq follow-ups)
        |                    --> live-evaluation (Insights scores)
        |-- session stop     --> report-worker / report-service
        v
  MongoDB  (Session, TranscriptTurn, Report, User, calendars…)
        |
        +--> dashboard (/app when built, or Vite :5173 in dev)
              Meetings · Calendar · Reports · imagine chat · Settings
```

### Live session flow

1. User opens Meet / Teams / Zoom; extension injects the Dynamic Island + panel.
2. User starts listening → `POST /bot/start` (URL + language + interviewer name).
3. Server starts `BotManager`; Playwright joins as `BOT_DISPLAY_NAME` (default `Xobin`).
4. Audio → Deepgram → `transcript:update` / `turn:complete` over WebSocket.
5. Candidate turns trigger autopilot LLM follow-ups; live evaluation updates **Insights**.
6. Overlay shows Live transcript, Insights, Notes; interviewer can ask manually / set candidate.
7. Stop / leave → report generation → dashboard report + **imagine** Q&A on that report.

### Where things run (important)

| Piece | Runs on |
| --- | --- |
| Chrome extension UI | The interviewer’s browser (any device) |
| API + Playwright bot + STT + LLM | The **server host** (local Node, Docker, or cloud) |

Remote extension use: point the popup **Server URL** at the host (`http://LAN_IP:8080`). The bot still joins from that host, not from the extension device.

---

## Chrome extension (deep dive)

**Path:** `apps/extension/`  
**Load:** `chrome://extensions` → Developer mode → Load unpacked → select `apps/extension`.

### Files

| File | Role |
| --- | --- |
| `manifest.json` | MV3; host permissions for Meet / Teams / Zoom; content scripts + service worker |
| `content.js` | Injects UI host, meeting leave → `/bot/stop`, `botToggle` → `/bot/start`, participant helpers |
| `background.js` | Service worker: `FETCH_PROXY`, WebSocket, rewrites `localhost:8080` → stored `api_base` |
| `platforms.js` | Platform detection helpers on the page |
| `ui/index.html` | Overlay markup (island, tabs, settings) |
| `ui/renderer.js` | Overlay logic: Live / Insights / Notes, WS events, follow-ups, settings |
| `ui/styles.css` | Glass UI styles |
| `ui/popup.html` / `popup.js` | Extension popup: login stub, **Server URL**, Google connect |

### Overlay UX

- **Dynamic Island** — collapse/expand, start/stop listening, settings, Assist
- **Live** — diarized transcript stream
- **Insights** — live evaluation (strengths / gaps / skills / fit)
- **Notes** — interviewer notes synced to the session
- Island settings — STT language (Deepgram list), overlay opacity

### Server URL (multi-device)

1. Open the extension popup (while signed in).
2. Under **Server**, set e.g. `http://192.168.1.20:8080` or your Railway URL.
3. **Save** (hits `/health`). Stored as `chrome.storage.local.api_base`.
4. All REST + WS traffic uses that base (`ws://` / `wss://` derived automatically).

Default: `http://localhost:8080`.

### Platforms (extension hosts)

- `https://meet.google.com/*`
- `https://*.zoom.us/*`
- `https://teams.microsoft.com/*`, `https://teams.live.com/*`

---

## Dashboard

**Path:** `apps/dashboard/` (React + Vite, HashRouter)

| Surface | Purpose |
| --- | --- |
| Login / Signup | Google OAuth → JWT in `localStorage` |
| Dashboard / Meetings | Upcoming + past sessions |
| Calendar | Google Calendar events via server |
| Reports | Scorecard, transcript, notes, action items |
| **imagine** | Per-report chat (`POST /reports/:sessionId/ask`) grounded in that interview |
| Settings | Profile (name/photo), bot display name, Deepgram language, integrations, privacy, export |

**Dev:** `cd apps/dashboard && npm run dev` → usually `http://localhost:5173`  
**Prod / Docker:** built into the image and served at `http://HOST:8080/app/`

---

## Server API (high level)

Entry: `apps/server/index.js` — listens on `0.0.0.0:PORT` (default `8080`).

| Endpoint / area | Purpose |
| --- | --- |
| `GET /health` | Healthcheck (Docker / Railway / Render) |
| `GET /api/config` | Public / WS base URLs |
| `POST /bot/start`, `POST /bot/stop` | Bot lifecycle |
| `GET /bot/participants` | Participant list |
| `/ws` | WebSocket hub (transcript, LLM, evaluation, reports) |
| `/auth/*` | Google / Microsoft / Zoom OAuth, preferences |
| `/reports/*` | List/detail, notes, regenerate, **ask** (imagine) |
| `/meetings/*`, `/calendars/*` | Meetings + calendar sync |
| `/app/*` | Static dashboard when `apps/dashboard/dist` exists |

Workers / services: `llm-worker.js`, `report-worker.js`, `live-evaluation.js`, `report-service.js`, `ws-hub.js`, `bot-dispatcher.js` (calendar auto-join).

---

## Bot + STT

- Platforms: `apps/bot/platforms/google-meet.js`, `teams.js`, `zoom.js`
- Orchestration: `apps/desktop/main/bot-manager.js`
- STT: `apps/desktop/main/stt-deepgram.js` (+ transcript-sources ladder for multichannel / DOM mono)
- **Google Meet** usually needs a one-time browser login / cookies in `apps/bot/user_data` (anonymous join is blocked). Zoom / Teams often join as guests (subject to platform anti-bot changes).

---

## Calendar auto-join

OAuth + webhooks exist for Google, Microsoft, and Zoom. **Google** is the path that works freely for most indie/dev setups. Microsoft / Zoom calendar APIs often need paid or verified org accounts — see notes in git history / provider consoles. Bot language and display name for dispatched joins come from `User.preferredLanguage` / `botDisplayName` (Settings → General).

---

## Environment

```bash
cp .env.example .env
```

**Required**

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | MongoDB connection |
| `JWT_SECRET` | Auth tokens |
| `GROQ_API_KEY_1` (or `GROQ_API_KEY`) | LLM + reports + imagine |
| `DEEPGRAM_API_KEY` | Live transcription |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Login + calendar |

**Common optional**

| Variable | Purpose |
| --- | --- |
| `BOT_DISPLAY_NAME` | Name shown in the meeting |
| `FIXED_SPEAKER_COUNT` | Diarization lock (default `2`) |
| `PUBLIC_URL` / `API_BASE_URL` / `WEBHOOK_BASE_URL` | Public / LAN / ngrok / Railway URLs |
| `TEST_MEETING_URL` | Force bot URL while iterating |
| `UPSTASH_REDIS_URL` | Prod queues (local often in-memory) |

---

## Local setup

### Prerequisites

- Node.js 18+
- MongoDB (Atlas URI is fine)
- Deepgram + Groq keys
- Chrome
- Playwright browsers for the bot (`npx playwright install` as needed)

### Install

```bash
npm install
cd apps/dashboard && npm install && cd ../..
```

### Run backend (Windows)

```bat
.\run_extension.bat
```

Starts `apps/server` (with optional WebRTC debug) and ngrok on port 8080.  
Or: `node apps/server/index.js` from the repo root (loads root `.env`).

### Run dashboard (dev)

```bash
cd apps/dashboard
npm run dev
```

### Load extension

1. `chrome://extensions` → Developer mode → Load unpacked → `apps/extension`
2. Open a Meet / Teams / Zoom tab
3. Use the island **Play** / listen control to start the bot
4. Reload the extension after changing `content.js`, `background.js`, or `ui/*`

### Docker (API + dashboard)

Requires Docker Desktop.

```bat
.\run_docker.bat
```

Or: `docker compose up -d --build`

- Health: `http://localhost:8080/health`
- Dashboard: `http://localhost:8080/app/`
- Another device on the same Wi‑Fi: set extension Server URL to `http://YOUR_LAN_IP:8080` (open firewall port 8080)

Cloud (Railway / Render): use the root `Dockerfile`, health path `/health`, set `PUBLIC_URL` / `API_BASE_URL` / `WEBHOOK_BASE_URL` to the public HTTPS URL. Playwright meeting joins from cloud IPs are often blocked — LAN Docker is more reliable for demos.

---

## Interviewer walkthrough

1. Open the meeting tab; confirm the Dynamic Island is visible.
2. Start listening → bot joins.
3. Watch **Live** transcript; use **Insights** for live fit / skills.
4. Optional: set candidate, manual Follow-up, Screen Assist, Notes.
5. Leave / stop → open dashboard **Reports** → review scorecard → ask **imagine**.

---

## WebSocket channels (extension ↔ server)

Handled mainly in `apps/server/services/ws-hub.js`.

**Client → server (examples):** `ask`, `bot:start`, `candidate:set`, `participants:request`, `transcript:comment`, `action-items:sync`, `agent:approve-takeover` / `agent:deny-takeover`

**Server → client (examples):** `transcript:update`, `participants:update`, `llm:*`, `evaluation:update`, `report:ready`, `bot:status`, `session:started` / stopped

---

## Mongo models (core)

- **User** — auth profile, `preferredLanguage`, `botDisplayName`, `avatarUrl`
- **Session** — meeting URL, platform, title / jobRole, participants, notes
- **TranscriptTurn** — speaker, text, timestamps, comments
- **Report** — scorecard, summary, recommendation, skills, status
- **ActionItem** — commitments (`pending` / `done`)
- **CalendarConnection** / scheduled meetings — auto-join pipeline

---

## Important file map

| Path | Role |
| --- | --- |
| `apps/extension/content.js` | Inject UI, start/stop bot from the meeting tab |
| `apps/extension/background.js` | `api_base`, FETCH proxy, WebSocket |
| `apps/extension/ui/renderer.js` | Overlay UX (Live / Insights / Notes) |
| `apps/extension/ui/popup.js` | Server URL + popup auth |
| `apps/server/index.js` | API entry, `/bot/start`, static `/app` |
| `apps/server/services/ws-hub.js` | WebSocket rooms |
| `apps/server/services/live-evaluation.js` | Insights scoring |
| `apps/server/services/report-assistant.js` | imagine answers |
| `apps/server/workers/llm-worker.js` | Live follow-ups |
| `apps/server/workers/report-worker.js` | Post-meeting reports |
| `apps/desktop/main/bot-manager.js` | Bot + STT orchestration |
| `apps/bot/platforms/*.js` | Meet / Teams / Zoom join + scrape |
| `apps/dashboard/src/pages/Dashboard.jsx` | Dashboard shell |
| `apps/dashboard/src/components/dashboard/ReportView.jsx` | Report + imagine panel |
| `apps/dashboard/src/components/dashboard/Integrations.jsx` | Settings (profile, languages, integrations) |

---

## Agent / maintainer guidelines

1. Prefer existing pipelines (`ws-hub`, `BotManager`, `FETCH_PROXY`) over new IPC.
2. Extension UI lives under `apps/extension/ui/`; host page uses a shadow root (`window.__MEETINGAI_SHADOW__` when present).
3. If overlay CSS “stops applying mid-file”, check `styles.css` for UTF-16 / null-byte corruption.
4. Do not reintroduce the removed two-person interview **Sim** panel unless explicitly requested.
5. Do not commit `.env` or bot `user_data` secrets.
6. Keep comments minimal; match existing style.
7. Track unfinished product work in `todo.md` when present — not as half-finished code comments.

---

## Related docs

- `.env.example` — environment variables
- `apps/dashboard/README.md` — dashboard Vite notes
- `railway.toml` — Railway Dockerfile deploy hints
- `todo.md` — backlog (if present)

---

## License

See root `package.json` / project license fields.
