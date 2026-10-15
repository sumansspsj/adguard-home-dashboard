# AdGuard Home Web Dashboard

[![React](https://img.shields.io/badge/React-19.0-61dafb?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4.0-38bdf8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Express](https://img.shields.io/badge/Express-5.0-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![Tests](https://img.shields.io/badge/Tests-60%2F60_Passed-4ade80?logo=jest&logoColor=white)](https://jestjs.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A modern, fast, responsive web dashboard, real-time telemetry layer, and **interactive 3D-feel World Map** for [AdGuard Home](https://adguard.com/adguard-home.html).

Built with **React 19**, **TypeScript**, **Tailwind CSS v4**, and an **Express 5** backend proxy. It delivers real-time DNS streaming, multi-day statistics, client telemetry, threat defense controls, multi-server node management, an interactive global DNS flight-arc map, and an AI network copilot — designed to run smoothly on desktop browsers and **mobile devices** (Chrome on Android, Safari on iOS).

---

## Architecture Overview

This project operates as an unobtrusive, non-destructive companion layer for your AdGuard Home setup. Your DNS resolution and network filtering continue to operate independently.

```
┌────────────────────────────────────────────────────────────────────────┐
│                             Client Devices                             │
│   Desktop Browser (Chrome, Firefox, Safari, Edge)                      │
│   Mobile Browser (Google Chrome on Android, Safari on iOS)             │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP / SSE
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        React 19 Frontend (Vite)                        │
│   • Dark theme with green / red semantic accents & obsidian styling    │
│   • Responsive layouts (Sidebar navigation + Mobile bottom nav)        │
│   • Real-time SSE query log ticker & rate counter                      │
│   • Interactive Canvas World Map (AdGuard Atlas) with GeoIP arcs       │
│   • Multi-day timeline buckets (24h, 7d, 30d, 90d)                     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ /api proxy (Port 8080 / 5173)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        Express 5 Backend Proxy                         │
│   • Rate limiting & RFC 1918 private network CORS isolation            │
│   • In-memory SSE pub/sub pipeline & live query deduplication          │
│   • Embedded GeoIP resolution (geoip-lite / MaxMind MMDB)              │
│   • 24-hour query buffer retention & automatic cold-start seeding      │
│   • Multi-node switcher with AES-256-GCM encryption                    │
│   • AI Network Copilot (Google Gemini API integration)                 │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ REST API (Basic Auth)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                           AdGuard Home Core                            │
│   (Default: http://192.168.1.115:80, 127.0.0.1:3000, or router/server) │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Key Features

### 1. Overview Dashboard
- High-level DNS metrics: Total queries, blocked threats, malware/phishing block share, and average upstream processing latency.
- Live queries-per-second activity rate with pulse indicators.
- 24-hour query volume bar charts, top requested domains, top blocked domains, and top querying clients.

### 2. Live DNS Stream
- Real-time query streaming via Server-Sent Events (SSE).
- Instant pause/resume, freeform search, and filtering by query status (*Allowed*, *Blocked*, *SafeBrowsing*, *Parental*), Protocol (*UDP*, *DoH*, *DoT*, *DNSCrypt*), Response Type (*A*, *AAAA*, *HTTPS*), Client IP, or Domain.
- Client log inspector and quick-block action drawer.

### 3. World Map (AdGuard Atlas)
- **Live Flight Arcs:** Real-time visual flight arcs that radiate from your home location across the globe to the destination servers answering your DNS queries.
- **Configurable Time Windows:** Switch seamlessly between **15m**, **1h**, **6h**, and **24h** windows with instant local re-aggregation and zero network latency.
- **24-Hour Memory Retention:** Retains up to 50,000 events with automatic multi-page cold-start history seeding from your AdGuard Home query log.
- **Per-Device Traffic Filter:** Select any device on your network (*Smart TV*, *iPhone*, *PC*) to trace only that device's global connections on the map.
- **Active Filter Indicators:** Dismissible pill badges (*Device*, *Country*, *Domain*) with a one-click reset to easily manage map filters.
- **On-Screen Zoom Controls:** Floating `[+]`, `[-]`, and `[⟲ Reset]` controls for effortless navigation on laptops, touchpads, and phones.
- **Battery-Saving Tab Throttling:** Automatically pauses the 60 FPS canvas loop when the browser tab is hidden or minimized, reducing CPU/GPU usage to **0%**.
- **One-Click Home Location Auto-Detection:** Uses HTML5 device GPS or public IP geolocation to automatically place your Home Pin with a single tap.
- **Unicode Country Flags:** Displays authentic regional flag badges (🇺🇸, 🇩🇪, 🇮🇳, 🇬🇧, 🇯🇵) in destination rankings and detail drawers.
- **Offline Demo Simulator:** Built-in synthetic traffic generator for testing and demonstration when offline.

### 4. Client Telemetry & Management
- Identify all devices communicating with your DNS server with real-time query counts and block percentages.
- Custom client nicknames, IP binding, and individualized query logs.

### 5. Threat Defense & Rules
- Custom user rules management with syntax verification (`||domain^`, `@@||domain^`).
- Upstream DNS resolver benchmarking and race engine (compares Cloudflare, Google, Quad9, AdGuard DNS, and local resolvers).
- SafeSearch enforcement (Google, Bing, YouTube, DuckDuckGo) and Parental Control toggles.

### 6. Multi-Node Cluster Management
- Connect and switch between multiple AdGuard Home nodes (e.g. Primary router + Secondary Raspberry Pi).
- Server credentials encrypted at rest using **AES-256-GCM**.

### 7. Mobile-First Responsive PWA
- Tailored for Google Chrome on Android and Safari on iOS.
- Safe-area insets, mobile bottom navigation, touch-optimized tap targets, and Progressive Web App (PWA) installation support.

---

## Prerequisites

- **Node.js**: Version `20.x` or `22.x+` (Run `node -v` to check)
- **AdGuard Home**: An active AdGuard Home instance running on your router, Raspberry Pi, local machine, or home server.

---

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/sumansspsj/adguard-home-dashboard.git
cd adguard-home-dashboard
```

### 2. Configure Credentials

Create or edit `server/.env`:

```env
# Address of your AdGuard Home instance
AGH_HOST=http://192.168.1.115:80

# AdGuard Home web administrator credentials
AGH_USERNAME=admin
AGH_PASSWORD=your_secure_password_here

# Port for the Express backend proxy (default: 8080)
PORT=8080

# (Optional) Home location coordinates for the World Map
HOME_LAT=28.6139
HOME_LON=77.2090
HOME_LABEL=Home

# (Optional) Google Gemini API key for AI Copilot features
GEMINI_API_KEY=

# (Optional) Comma-separated allowed external CORS origins
CORS_ORIGINS=
```

> **Security Note:** Never commit `server/.env` or `server/servers.json` to version control. Both are protected in `.gitignore`.

### 3. Install Dependencies

```powershell
# Install root, backend, and frontend packages
npm install
cd server && npm install
cd ../dashboard && npm install
cd ..
```

### 4. Run the Dashboard

#### Option A: Windows Quick-Launch (Recommended)
Double-click [`start.bat`](start.bat). This automatically:
1. Starts the backend API server on port `8080`.
2. Starts the frontend Vite development server on port `5173`.
3. Opens the terminal with active logs.

#### Option B: Production Single-Port Mode
To run everything on a single port (`8080` & `5173`) 24/7:
```powershell
# 1. Compile frontend
cd dashboard
npm run build

# 2. Start unified production server
cd ../server
npm start
```
*Access the dashboard at `http://localhost:8080` or `http://localhost:5173`.*

---

## Accessing from Mobile (Chrome on Android / iOS Safari)

You can access the dashboard from your smartphone or tablet on your home Wi-Fi:

1. Find your host computer's local IP address (e.g. `192.168.1.15`).
   - On Windows: Run `ipconfig` in PowerShell.
2. Ensure your phone is connected to the same Wi-Fi network.
3. Open Chrome on Android and navigate to:
   ```
   http://192.168.1.15:5173
   ```
   *(Or `http://192.168.1.15:8080` if running production mode).*
4. **Install as App (PWA):**
   - In Chrome, tap the three dots menu (**⋮**) in the top right.
   - Tap **"Install app"** or **"Add to Home screen"**.
   - The dashboard will now launch as a full-screen, standalone app.

---

## Available Scripts

### Root Directory
- `npm start` — Starts the Express backend server (`server`).
- `npm run dev:server` — Starts the backend server in development mode.
- `npm run dev:dashboard` — Starts the Vite frontend dev server.
- `npm run build` — Compiles and optimizes the frontend for production (`dashboard/dist`).
- `npm run test` — Executes the automated Jest test suite.
- `npm run lint` — Runs fast TypeScript/React lint checks (`oxlint`).

### Windows Batch Utilities
- `start.bat` — Launches both backend API and frontend in persistent command windows.
- `start-dashboard.bat` — Launches the unified server on port `8080`.
- `stop-dashboard.bat` — Gracefully stops all running Node dashboard processes.
- `install-windows-startup.bat` — Configures the dashboard to start silently in the background on Windows boot.
- `uninstall-windows-startup.bat` — Removes the background Windows startup task.

---

## Running Tests

The test suite validates parameter clamping, proxy routing, AES-256 encryption, security headers, rule validation, and Atlas World Map endpoints:

```powershell
# Run backend Jest test suite (60 unit & integration tests)
cd server
npm test

# Verify frontend TypeScript typing and production build
cd ../dashboard
npm run build
```

---

## Security Model

1. **RFC 1918 Private Network Isolation**: CORS is restricted to same-origin requests and standard private subnets (`192.168.0.0/16`, `10.0.0.0/8`, `172.16.0.0/12`). Arbitrary public websites cannot access your local DNS proxy.
2. **Encrypted Node Storage**: Multi-server configurations are encrypted at rest using **AES-256-GCM**.
3. **Redacted API Responses**: Passwords and authentication headers are filtered from all API responses.
4. **Header Hardening**: Strict HTTP security headers are enabled (`X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, and strict CSP).
5. **CSV Formula Injection Sanitization**: All log and client CSV export utilities sanitize formulas (`=`, `+`, `-`, `@`) to protect spreadsheets.

---

## Troubleshooting

- **"Backend API unreachable. Tap to configure server endpoint IP"**:
  - Ensure the backend server is running (`node server/index.js` or `start.bat`).
  - If viewing from a phone, click **Configure Gateway** and enter your computer's LAN IP (e.g. `http://192.168.1.15:8080`).
- **AdGuard Home returns 502**:
  - Verify your AdGuard Home service is running.
  - Check `AGH_HOST`, `AGH_USERNAME`, and `AGH_PASSWORD` in `server/.env`.
- **World Map shows "Waiting for DNS queries…"**:
  - Ensure DNS traffic is flowing through AdGuard Home.
  - Click the **15m / 1h / 6h / 24h** buttons to switch time windows and inspect historical queries.

---

## License

This project is licensed under the [MIT License](LICENSE).
