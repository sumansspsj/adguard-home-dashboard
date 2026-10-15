import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { MapView } from '../components/map/MapView';
import { AtlasStore } from '../components/map/store';
import { StatsHUD, LiveFeedPanel, SelectionDrawer } from '../components/map/AtlasPanels';
import { STATIC_DEMO_CONFIG, type ClientConfig, type QueryClass } from '../components/map/types';
import { DemoGenerator } from '../components/map/demo/generator';
import { getApiUrl } from '../api';
import {
  Play,
  Pause,
  Maximize2,
  Minimize2,
  Sparkles,
  MapPin,
  Eye,
  EyeOff,
  BarChart2,
  Radio,
  X,
  Check,
} from 'lucide-react';

export default function WorldMapPage() {
  const [clientConfig, setClientConfig] = useState<ClientConfig>(() => {
    const savedHome = localStorage.getItem('agh_atlas_home');
    if (savedHome) {
      try {
        const parsed = JSON.parse(savedHome);
        return { ...STATIC_DEMO_CONFIG, home: parsed };
      } catch { /* fallback */ }
    }
    return STATIC_DEMO_CONFIG;
  });

  const [demoMode, setDemoMode] = useState(false);
  const [labels, setLabels] = useState(1);
  const [kiosk, setKiosk] = useState(false);
  const [showStats, setShowStats] = useState(true);
  const [showFeed, setShowFeed] = useState(false);
  const [homeModalOpen, setHomeModalOpen] = useState(false);
  const [homeInput, setHomeInput] = useState({
    lat: clientConfig.home.lat,
    lon: clientConfig.home.lon,
    label: clientConfig.home.label || 'Home',
  });

  // Create persistent store instance
  const store = useMemo(() => new AtlasStore(15 * 60 * 1000, { theme: 'dark' }), []);

  // Subscribe to store snapshot
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);

  // 1. Fetch remote atlas configuration and initial snapshot on mount
  useEffect(() => {
    fetch(getApiUrl('/atlas/config'))
      .then((res) => res.json())
      .then((cfg: ClientConfig) => {
        if (cfg && cfg.home) {
          const savedHome = localStorage.getItem('agh_atlas_home');
          if (savedHome) {
            try {
              cfg.home = JSON.parse(savedHome);
            } catch { /* ignore */ }
          }
          setClientConfig(cfg);
          setHomeInput({ lat: cfg.home.lat, lon: cfg.home.lon, label: cfg.home.label });
        }
      })
      .catch(() => {
        // Fallback to demo/static config
      });

    // Warm up store with initial snapshot
    fetch(getApiUrl('/atlas/snapshot'))
      .then((res) => res.json())
      .then((data) => {
        if (data && Array.isArray(data.events) && data.events.length > 0) {
          store.reset(data.events, data.now);
          if (data.status) store.setStatus(data.status);
        }
      })
      .catch(() => {});
  }, [store]);

  // 2. Start store periodic recomputation timer
  useEffect(() => {
    const stop = store.start(450);
    return stop;
  }, [store]);

  // 3. Connect to live SSE stream (or run Demo generator)
  useEffect(() => {
    if (demoMode) {
      // Offline synthetic demo traffic generator
      const gen = new DemoGenerator(Date.now(), Date.now() - 15 * 60 * 1000);
      const initial = gen.advance(Date.now());
      store.reset(initial);
      store.setConnection('live');

      const id = setInterval(() => {
        if (!store.getSnapshot().paused) {
          const batch = gen.advance(Date.now());
          if (batch.length > 0) store.ingest(batch);
        }
      }, 700);

      return () => clearInterval(id);
    }

    // Live mode: connect to Express SSE endpoint
    store.setConnection('connecting');
    const es = new EventSource(getApiUrl('/atlas/stream'));

    es.addEventListener('open', () => {
      store.setConnection('live');
    });

    es.addEventListener('snapshot', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data.events) {
          store.reset(data.events, data.now);
        }
        if (data.status) {
          store.setStatus(data.status);
        }
        store.setConnection('live');
      } catch { /* ignore */ }
    });

    es.addEventListener('events', (e: MessageEvent) => {
      try {
        const events = JSON.parse(e.data);
        if (Array.isArray(events) && events.length > 0) {
          store.ingest(events);
        }
      } catch { /* ignore */ }
    });

    es.addEventListener('status', (e: MessageEvent) => {
      try {
        const status = JSON.parse(e.data);
        store.setStatus(status);
      } catch { /* ignore */ }
    });

    es.onerror = () => {
      store.setConnection('lost');
    };

    return () => {
      es.close();
    };
  }, [store, demoMode]);

  const toggleQueryClass = (cls: QueryClass) => {
    store.toggleClass(cls);
  };

  const handleSaveHome = () => {
    const updated = {
      lat: Number(homeInput.lat) || 28.6139,
      lon: Number(homeInput.lon) || 77.2090,
      label: homeInput.label || 'Home',
    };
    setClientConfig((prev) => ({ ...prev, home: updated }));
    localStorage.setItem('agh_atlas_home', JSON.stringify(updated));

    // Also notify backend if reachable
    fetch(getApiUrl('/atlas/config/home'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    }).catch(() => {});

    setHomeModalOpen(false);
  };

  const padding = useMemo(
    () => ({
      top: 60,
      right: showFeed ? 340 : 20,
      bottom: 60,
      left: showStats ? 310 : 20,
    }),
    [showStats, showFeed]
  );

  return (
    <div className={`relative w-full h-[calc(100vh-100px)] min-h-[500px] overflow-hidden rounded-xl border border-[var(--border)] bg-[#090909] text-[var(--text)] flex flex-col ${kiosk ? 'fixed inset-0 z-50 rounded-none h-screen border-none' : ''}`}>
      {/* Top Controls Bar */}
      <div className="absolute top-3 inset-x-3 z-30 flex items-center justify-between gap-2 pointer-events-none">
        {/* Left: Mode Chip & Home Location Badge */}
        <div className="flex items-center gap-2 pointer-events-auto">
          {/* Status Chip */}
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[var(--surface)]/90 backdrop-blur-md border border-[var(--border)] text-xs shadow-md">
            <span
              className={`w-2 h-2 rounded-full ${
                demoMode
                  ? 'bg-amber-400'
                  : snap.connection === 'live'
                  ? 'bg-[var(--green)] animate-pulse'
                  : snap.connection === 'lost'
                  ? 'bg-[var(--red)]'
                  : 'bg-[var(--muted)]'
              }`}
            />
            <span className="font-semibold text-xs tracking-tight">
              {demoMode ? 'Demo Simulator' : snap.connection === 'live' ? 'Live Stream' : 'Connecting…'}
            </span>
          </div>

          {/* Home Location Marker Button */}
          <button
            type="button"
            onClick={() => setHomeModalOpen(true)}
            className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--surface)]/90 backdrop-blur-md border border-[var(--border)] hover:border-[var(--strong-border)] text-xs text-[var(--text)] transition-colors cursor-pointer shadow-md"
            title="Set your Home GPS Coordinates"
          >
            <MapPin className="w-3.5 h-3.5 text-[var(--green)]" />
            <span className="font-medium truncate max-w-[130px]">{clientConfig.home.label}</span>
          </button>
        </div>

        {/* Right: Quick Action Controls */}
        <div className="flex items-center gap-1.5 pointer-events-auto">
          {/* Class Filters (Desktop) */}
          <div className="hidden lg:flex items-center gap-1 p-0.5 rounded-lg bg-[var(--surface)]/90 backdrop-blur-md border border-[var(--border)] shadow-md text-xs">
            <button
              type="button"
              onClick={() => toggleQueryClass('allowed')}
              className={`px-2 py-0.5 rounded-md font-semibold transition-colors cursor-pointer ${
                snap.filters.classes.allowed ? 'bg-[var(--green-bg)] text-[var(--green)]' : 'text-[var(--muted)]'
              }`}
              title="Toggle Allowed Queries (Green Arcs)"
            >
              Allowed
            </button>
            <button
              type="button"
              onClick={() => toggleQueryClass('blocked')}
              className={`px-2 py-0.5 rounded-md font-semibold transition-colors cursor-pointer ${
                snap.filters.classes.blocked ? 'bg-[var(--red-bg)] text-[var(--red)]' : 'text-[var(--muted)]'
              }`}
              title="Toggle Blocked Queries"
            >
              Blocked
            </button>
            <button
              type="button"
              onClick={() => toggleQueryClass('local')}
              className={`px-2 py-0.5 rounded-md font-semibold transition-colors cursor-pointer ${
                snap.filters.classes.local ? 'bg-purple-950/60 text-purple-400' : 'text-[var(--muted)]'
              }`}
              title="Toggle Local Network Queries"
            >
              LAN
            </button>
          </div>

          {/* Toggle Labels */}
          <button
            type="button"
            onClick={() => setLabels((v) => (v > 0 ? 0 : 1))}
            className={`p-1.5 rounded-lg bg-[var(--surface)]/90 backdrop-blur-md border border-[var(--border)] text-xs transition-colors cursor-pointer shadow-md ${
              labels > 0 ? 'text-[var(--text)]' : 'text-[var(--muted)]'
            }`}
            title={labels > 0 ? 'Hide Place Labels' : 'Show Place Labels'}
          >
            {labels > 0 ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          </button>

          {/* Pause / Resume */}
          <button
            type="button"
            onClick={() => store.setPaused(!snap.paused)}
            className="p-1.5 rounded-lg bg-[var(--surface)]/90 backdrop-blur-md border border-[var(--border)] hover:bg-[var(--surface-2)] text-xs transition-colors cursor-pointer shadow-md"
            title={snap.paused ? 'Resume Animation' : 'Pause Animation'}
          >
            {snap.paused ? <Play className="w-4 h-4 text-[var(--green)]" /> : <Pause className="w-4 h-4" />}
          </button>

          {/* Demo Mode Toggle */}
          <button
            type="button"
            onClick={() => setDemoMode((v) => !v)}
            className={`p-1.5 rounded-lg bg-[var(--surface)]/90 backdrop-blur-md border border-[var(--border)] text-xs transition-colors cursor-pointer shadow-md ${
              demoMode ? 'bg-amber-950/60 text-amber-300 border-amber-600/50' : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}
            title={demoMode ? 'Switch to Live Network' : 'Switch to Demo Simulator'}
          >
            <Sparkles className="w-4 h-4" />
          </button>

          {/* Toggle Stats Panel */}
          <button
            type="button"
            onClick={() => setShowStats((v) => !v)}
            className={`p-1.5 rounded-lg bg-[var(--surface)]/90 backdrop-blur-md border border-[var(--border)] text-xs transition-colors cursor-pointer shadow-md ${
              showStats ? 'text-[var(--text)]' : 'text-[var(--muted)]'
            }`}
            title="Toggle Statistics HUD"
          >
            <BarChart2 className="w-4 h-4" />
          </button>

          {/* Toggle Live Feed */}
          <button
            type="button"
            onClick={() => setShowFeed((v) => !v)}
            className={`p-1.5 rounded-lg bg-[var(--surface)]/90 backdrop-blur-md border border-[var(--border)] text-xs transition-colors cursor-pointer shadow-md ${
              showFeed ? 'text-[var(--text)]' : 'text-[var(--muted)]'
            }`}
            title="Toggle Live Query Ticker"
          >
            <Radio className="w-4 h-4" />
          </button>

          {/* Fullscreen / Kiosk Toggle */}
          <button
            type="button"
            onClick={() => setKiosk((v) => !v)}
            className="p-1.5 rounded-lg bg-[var(--surface)]/90 backdrop-blur-md border border-[var(--border)] hover:bg-[var(--surface-2)] text-xs transition-colors cursor-pointer shadow-md"
            title={kiosk ? 'Exit Fullscreen' : 'Fullscreen Map'}
          >
            {kiosk ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Interactive Canvas World Map */}
      <div className="relative flex-1 w-full h-full">
        <MapView
          store={store}
          config={clientConfig}
          padding={padding}
          places={snap.view.places}
          selection={snap.selection}
          paused={snap.paused}
          theme="dark"
          labels={labels}
        />
      </div>

      {/* Floating Left: Statistics HUD */}
      {showStats && (
        <div className="absolute top-14 left-3 z-20 pointer-events-auto animate-fade-in max-h-[calc(100%-70px)] overflow-y-auto no-scrollbar">
          <StatsHUD store={store} snap={snap} windowMinutes={15} />
        </div>
      )}

      {/* Floating Right: Live Query Feed Panel */}
      {showFeed && (
        <div className="absolute top-14 right-3 z-20 pointer-events-auto animate-fade-in">
          <LiveFeedPanel store={store} snap={snap} />
        </div>
      )}

      {/* Country & Place Selection Detail Drawer */}
      <SelectionDrawer store={store} snap={snap} />

      {/* Home Location Configuration Modal */}
      {homeModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget) setHomeModalOpen(false);
          }}
        >
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 shadow-2xl w-full max-w-sm space-y-4 animate-scale-in text-[var(--text)]">
            <div className="flex items-center justify-between pb-2 border-b border-[var(--border)]">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-[var(--green)]" />
                <h3 className="text-sm font-bold text-[var(--text)]">Home Pin Location</h3>
              </div>
              <button
                type="button"
                onClick={() => setHomeModalOpen(false)}
                className="p-1 rounded text-[var(--muted)] hover:text-[var(--text)] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-[var(--muted)]">
              Where animated arcs radiate from on the world map. Coordinates stay local on your computer.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] uppercase font-bold text-[var(--muted)] mb-1">
                  Location Label
                </label>
                <input
                  type="text"
                  value={homeInput.label}
                  onChange={(e) => setHomeInput({ ...homeInput, label: e.target.value })}
                  placeholder="Home / City"
                  className="w-full px-3 py-1.5 text-xs rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] focus:outline-hidden focus:border-[var(--text)]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] uppercase font-bold text-[var(--muted)] mb-1">
                    Latitude
                  </label>
                  <input
                    type="number"
                    step="0.0001"
                    value={homeInput.lat}
                    onChange={(e) => setHomeInput({ ...homeInput, lat: Number(e.target.value) })}
                    placeholder="28.6139"
                    className="w-full px-3 py-1.5 text-xs font-mono rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] focus:outline-hidden focus:border-[var(--text)]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] uppercase font-bold text-[var(--muted)] mb-1">
                    Longitude
                  </label>
                  <input
                    type="number"
                    step="0.0001"
                    value={homeInput.lon}
                    onChange={(e) => setHomeInput({ ...homeInput, lon: Number(e.target.value) })}
                    placeholder="77.2090"
                    className="w-full px-3 py-1.5 text-xs font-mono rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] focus:outline-hidden focus:border-[var(--text)]"
                  />
                </div>
              </div>

              {/* Quick Preset Cities */}
              <div className="pt-1">
                <span className="text-[10px] text-[var(--muted)] uppercase font-semibold">Quick Presets:</span>
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {[
                    { label: 'London', lat: 51.5074, lon: -0.1278 },
                    { label: 'New York', lat: 40.7128, lon: -74.006 },
                    { label: 'New Delhi', lat: 28.6139, lon: 77.209 },
                    { label: 'Singapore', lat: 1.3521, lon: 103.8198 },
                    { label: 'Sydney', lat: -33.8688, lon: 151.2093 },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setHomeInput({ label: preset.label, lat: preset.lat, lon: preset.lon })}
                      className="text-[11px] px-2 py-0.5 rounded bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--strong-border)] cursor-pointer"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border)]">
              <button
                type="button"
                onClick={() => setHomeModalOpen(false)}
                className="secondary-btn text-xs py-1.5 px-3 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveHome}
                className="primary-btn text-xs py-1.5 px-4 flex items-center gap-1.5 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Save Location</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
