# AdGuard Home Dashboard Frontend

The web client for the AdGuard Home Unified Dashboard, built with **React 19**, **TypeScript**, **Tailwind CSS v4**, and **Vite**.

---

## Architecture & Structure

```
dashboard/
├── src/
│   ├── api.ts                     # Axios client, SSE connection handlers, gateway configuration
│   ├── App.tsx                    # Main layout, route definitions, error boundaries, top navigation
│   ├── main.tsx                   # Application entry point, theme mounting
│   ├── index.css                  # Tailwind CSS v4 styling, custom scrollbars, obsidian variables
│   │
│   ├── pages/                     # Primary top-level route views (6 native tabs)
│   │   ├── Overview.tsx           # High-level DNS metrics, live queries/sec, 24h timeline charts
│   │   ├── LiveDNS.tsx            # Real-time SSE query log ticker with multi-filter bar
│   │   ├── WorldMap.tsx           # Interactive 3D-feel canvas World Map (AdGuard Atlas)
│   │   ├── Clients.tsx            # Network client list, query counts, and block percentages
│   │   ├── ClientDetail.tsx       # Per-client DNS history, bound IPs, and statistics
│   │   ├── Security.tsx           # DNS blocklists, whitelist, custom rules, parental control
│   │   └── Settings.tsx           # Multi-node cluster switcher, upstream benchmarks, AI Copilot
│   │
│   ├── components/                # Modular UI components
│   │   ├── map/                   # AdGuard Atlas World Map engine
│   │   │   ├── AtlasMap.ts        # 60 FPS Canvas rendering engine (flight arcs, rings, markers, zoom)
│   │   │   ├── AtlasPanels.tsx    # StatsHUD, LiveFeedPanel, and SelectionDrawer components
│   │   │   ├── AtlasBits.tsx      # SVG glyphs, Unicode regional country flags, time formatters
│   │   │   ├── MapView.tsx        # React canvas wrapper with imperative zoom and setHome controls
│   │   │   ├── store.ts           # Centralized AtlasStore, time window filtering (15m–24h)
│   │   │   ├── geometry.ts        # D3 Natural Earth projection and GeoJSON country hit-testing
│   │   │   ├── scheduler.ts       # Rate-governed arc animation and glow queue scheduler
│   │   │   ├── types.ts           # Type definitions for destinations, events, snapshots
│   │   │   └── demo/generator.ts  # Offline synthetic traffic simulator
│   │   ├── BackendConfigModal.tsx # Dynamic gateway IP configuration modal
│   │   ├── ProtectionModal.tsx    # Quick protection pause/resume dialog
│   │   ├── TopBar.tsx             # Global header with status chips, search, and quick toggles
│   │   ├── Sidebar.tsx            # Desktop navigation sidebar
│   │   └── MobileNav.tsx          # Mobile bottom navigation bar
│   │
│   └── test/                      # Frontend unit test suites
├── dist/                          # Production build output (served by Express)
├── package.json                   # Dependencies and build scripts
├── tsconfig.json                  # Strict TypeScript configuration
└── vite.config.ts                 # Vite bundler configuration & local API reverse proxy
```

---

## Key Frontend Capabilities

- **React 19 & Concurrent Rendering:** Efficient state management using `useSyncExternalStore` and `useMemo` for high-throughput DNS streams.
- **Canvas Rendering Engine (AtlasMap):** Two-layer canvas architecture (base continent layer + effects layer) for rendering up to 140 simultaneous flight arcs, landing pulse rings, and glow shaders at 60 FPS without React reconciliation overhead.
- **Background Tab Throttling:** Automatically pauses the canvas animation loop when the browser tab is hidden (`document.visibilitychange`), reducing CPU and GPU usage to **0%**.
- **Responsive Layout:** Dynamic UI adapting from desktop widescreen displays down to small mobile viewports (< 768px) with touch gestures and safe-area insets.
- **Dynamic Gateway Binding:** Allows setting and testing custom backend IP endpoints on the fly via `localStorage`.

---

## Development & Build Commands

```powershell
# 1. Install dependencies
npm install

# 2. Start Vite development server with Hot Module Replacement (HMR)
npm run dev

# 3. Type check and build optimized production bundle in dist/
npm run build

# 4. Preview production build locally
npm run preview

# 5. Run linter
npm run lint
```

---

## License

This project is licensed under the [MIT License](../LICENSE).
