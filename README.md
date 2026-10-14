# AdGuard Home Web Dashboard

A modern, fast, responsive web dashboard and telemetry layer for [AdGuard Home](https://adguard.com/adguard-home.html).

Built with **React 19**, **TypeScript**, **Tailwind CSS v4**, and an **Express 5** backend proxy. It delivers real-time DNS streaming, multi-day statistics, client telemetry, threat defense controls, multi-server node management, and an AI network copilot — designed to run smoothly on desktop browsers and **Google Chrome on Android phones**.

---

## Architecture Overview

This project is a non-destructive companion layer for AdGuard Home. Your DNS resolution and network filtering continue to operate independently.

```
┌─────────────────────────────────────────────────────────────┐
│                       Client Devices                        │
│   Desktop Browser (Chrome, Firefox, Safari)                 │
│   Mobile Browser (Google Chrome on Android, Safari on iOS)  │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP / SSE
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 React 19 Frontend (Vite)                    │
│   • Dark theme with green / red semantic accents            │
│   • Responsive layouts (Sidebar + Mobile Bottom Nav)        │
│   • Real-time SSE query log stream                          │
│   • Multi-day timeline buckets (24h, 7d, 30d, 90d)          │
└──────────────────────────────┬──────────────────────────────┘
                               │ /api proxy
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 Express 5 Backend Proxy                     │
│   • Rate limiting & RFC 1918 private network CORS isolation │
│   • In-memory SSE pub/sub pipeline                          │
│   • Multi-node switcher with AES-256-GCM encryption         │
│   • AI Network Copilot (Google Gemini API)                  │
└──────────────────────────────┬──────────────────────────────┘
                               │ REST API (Basic Auth)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                     AdGuard Home Core                       │
│   (Default: http://127.0.0.1:3000 or your router / server) │
└─────────────────────────────────────────────────────────────┘
```

---

## Features

- **Overview Dashboard**: High-level DNS metrics, live queries/sec rate, authentic 24-hour timeline graphs, top requested domains, top blocked domains, and top querying clients.
- **Live DNS Stream**: Real-time query streaming via Server-Sent Events (SSE). Pause, resume, search, and filter queries by Status (*Allowed*, *Blocked*, *SafeBrowsing*, *Parental*), Protocol, Response Type, Client IP, or Domain.
- **Client Management**: Identify devices on your network with authentic query counts, block rates, and client detail drill-downs.
- **Security & Rules**: Manage custom DNS block/allow rules, parental control, safe search, malware/phishing protection, and upstream DNS resolver benchmarking.
- **Settings & Node Switcher**: Switch between multiple AdGuard Home instances (e.g. Primary router, Secondary Raspberry Pi) with encrypted server credential storage.
- **Mobile-First Responsive UX**: Optimized for Google Chrome on Android with safe-area insets, mobile bottom navigation, touch-friendly tap targets, and Progressive Web App (PWA) installation support.

---

## Prerequisites

- **Node.js**: Version `20.x` or `22.x+` (Run `node -v` to check)
- **AdGuard Home**: An active AdGuard Home instance on your local machine, router, Raspberry Pi, or home server.

---

## Quick Start

### 1. Configure AdGuard Home Credentials

Create or edit `server/.env`:

```env
# Address of your AdGuard Home instance
AGH_HOST=http://127.0.0.1:3000

# AdGuard Home web administrator credentials
AGH_USERNAME=admin
AGH_PASSWORD=your_secure_password_here

# Port for the Express backend proxy
PORT=8080

# (Optional) Google Gemini API key for AI Copilot features
GEMINI_API_KEY=

# (Optional) Comma-separated allowed external CORS origins (e.g. https://dns.mydomain.com)
CORS_ORIGINS=
```

> **Security Note:** Never commit `server/.env` or `server/servers.json` to version control. Both are ignored in `.gitignore`.

### 2. Start the Application

#### Option A: Quick-Launch (Windows)
Double-click `start.bat`. This automatically starts the backend API on port `8080` and opens the frontend development server on port `5173`.

#### Option B: Manual Command Line
Open two terminal windows:

**Terminal 1 — Backend API Server:**
```powershell
cd server
npm start
```
*The API server will listen on `http://localhost:8080`.*

**Terminal 2 — Frontend Dashboard:**
```powershell
cd dashboard
npm run dev
```
*The frontend will run on `http://localhost:5173`.*

---

## Accessing from Mobile (Chrome on Android)

You can use the dashboard from your smartphone or tablet on the same Wi-Fi network without installing any APK:

1. Find your computer's local IP address (e.g., `192.168.1.15`).
   - On Windows: run `ipconfig` in Command Prompt or PowerShell.
2. Ensure both your computer and your phone are connected to the same Wi-Fi network.
3. On your Android phone, open **Google Chrome** and browse to:
   ```
   http://192.168.1.15:5173
   ```
   *(Or `http://192.168.1.15:8080` if running the built production server).*
4. **Install as App (Optional PWA)**:
   - In Chrome on Android, tap the three dots menu (**⋮**) in the top right corner.
   - Tap **"Add to Home screen"** or **"Install app"**.
   - The dashboard will now launch as a standalone, fullscreen app directly from your home screen.

---

## Available Scripts

### Root Directory
- `npm start` — Runs the Express backend server (`server`).
- `npm run dev:server` — Starts the backend server.
- `npm run dev:dashboard` — Starts the Vite frontend dev server.
- `npm run build` — Compiles and bundles the frontend for production.
- `npm run test` — Executes the backend Jest test suite.
- `npm run lint` — Runs fast TypeScript/React linter checks (`oxlint`).

### Windows Service Helpers
- `start.bat` — Starts both backend API and frontend in separate processes.
- `start-dashboard.bat` — Launches the unified server on port `8080`.
- `stop-dashboard.bat` — Terminates running Node server processes.
- `install-windows-startup.bat` — Configures the server to start silently in the background on Windows boot.
- `uninstall-windows-startup.bat` — Removes the background Windows startup task.

---

## Production Build & Deployment

To deploy the dashboard for production:

1. **Build the Frontend:**
   ```powershell
   cd dashboard
   npm run build
   ```
   This generates an optimized web bundle in `dashboard/dist/`.

2. **Run in Production Mode:**
   The backend server automatically serves the compiled `dashboard/dist/` bundle on port `8080`:
   ```powershell
   cd server
   npm start
   ```
   Access the dashboard at `http://localhost:8080` or `http://<YOUR-IP>:8080`.

---

## Security Model

1. **Local Network & RFC 1918 Isolation**: CORS is locked down to same-origin requests and standard private network subnets (`192.168.0.0/16`, `10.0.0.0/8`, `172.16.0.0/12`). Arbitrary public websites cannot query your local DNS proxy.
2. **Encrypted Node Storage**: Multi-server configurations stored in `server/servers.json` are encrypted at rest using authenticated **AES-256-GCM** encryption. Server credentials are never displayed or transmitted in plain text.
3. **Redacted API Responses**: Passwords and private API tokens are filtered out of all API responses returned to the client.
4. **Header Hardening**: Strict HTTP security headers are enabled, including `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, and restrictive Content Security Policies.
5. **CSV Injection Protection**: All export utilities (DNS logs, Client lists) sanitize dynamic cells to prevent spreadsheet formula injection.

---

## Running Tests

To verify the codebase:

```powershell
# 1. Run backend automated test suite (56 unit & integration tests)
cd server
npm test

# 2. Verify frontend TypeScript typing and production build
cd ../dashboard
npm run build

# 3. Run frontend linter
npm run lint
```

---

## Troubleshooting

- **Backend unreachable on phone browser**:
  - Verify your Windows Firewall allows inbound connections on port `5173` (dev) or `8080` (production).
  - Ensure both the PC and Android phone are on the same local Wi-Fi network (and not on a guest network with client isolation).
- **"Offline · Tap to set IP" error**:
  - Click the Globe icon in the top bar to verify the Gateway URL.
  - In standard setup, this should be left on the default (`Current Host`).
- **AdGuard Home returns 502**:
  - Verify that AdGuard Home is running on your machine or router.
  - Check that the `AGH_HOST`, `AGH_USERNAME`, and `AGH_PASSWORD` values in `server/.env` match your installation.

---

## License

This project is licensed under the MIT License.
