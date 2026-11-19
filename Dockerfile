# Build dashboard
FROM node:20-bookworm-slim AS dashboard-build
WORKDIR /dash
COPY apps/dashboard/package.json apps/dashboard/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY apps/dashboard/ ./
ENV VITE_API_URL=
ENV VITE_BASE=/app/
RUN npm run build

# API + Playwright bot runtime
FROM mcr.microsoft.com/playwright:v1.61.1-jammy
WORKDIR /app

# Install pulseaudio and ALSA for Chrome AudioContext support
USER root
RUN apt-get update && apt-get install -y pulseaudio alsa-utils && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
RUN npx playwright install chrome

COPY . .
COPY --from=dashboard-build /dash/dist ./apps/dashboard/dist

ENV NODE_ENV=production
ENV PORT=8080
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/health || exit 1

CMD rm -f /tmp/.X99-lock && pulseaudio -D --exit-idle-time=-1 --system & Xvfb :99 -screen 0 1280x800x24 -nolisten tcp & export DISPLAY=:99 && node apps/server/index.js
