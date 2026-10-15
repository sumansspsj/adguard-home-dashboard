import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { MapView, type MapViewHandle } from '../components/map/MapView';
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
  Crosshair,
  Loader2,
  Plus,
  Minus,
  RotateCcw,
  Laptop,
  ChevronDown,
  Globe,
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
  const [detecting, setDetecting] = useState(false);
  const [detectMsg, setDetectMsg] = useState<string | null>(null);

  const handleAutoDetect = () => {
    setDetecting(true);
    setDetectMsg(null);

    if (typeof window !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = Math.round(pos.coords.latitude * 10000) / 10000;
          const lon = Math.round(pos.coords.longitude * 10000) / 10000;
          setHomeInput((prev) => ({
            ...prev,
            lat,
            lon,
            label: prev.label === 'Home' || !prev.label ? 'My Location' : prev.label,
          }));
          setDetecting(false);
          setDetectMsg('Detected via device GPS/Wi-Fi!');
        },
        async () => {
          // Fallback to public IP geolocation
          try {
            const res = await fetch('https://ipapi.co/json/');
            const data = await res.json();
            if (data && typeof data.latitude === 'number' && typeof data.longitude === 'number') {
              setHomeInput({
                lat: Math.round(data.latitude * 10000) / 10000,
                lon: Math.round(data.longitude * 10000) / 10000,
                label: data.city || data.region || 'Home',
              });
              setDetectMsg(`Detected: ${data.city || data.country_name}`);
            } else {
              setDetectMsg('Could not detect location automatically.');
            }
          } catch {
            setDetectMsg('Could not detect location automatically.');
          } finally {
            setDetecting(false);
          }
        },
        { timeout: 6000 }
      );
    } else {
      setDetecting(false);
      setDetectMsg('Geolocation not supported by browser.');
    }
  };

  // Create persistent store instance
  const store = useMemo(() => {
    const saved = Number(localStorage.getItem('agh_atlas_window')) || 60;
    return new AtlasStore(saved, { theme: 'dark' });
  }, []);

  // Subscribe to store snapshot
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);

  const mapRef = useRef<MapViewHandle>(null);
  const hasActiveFilters = Boolean(
    snap.filters.device || snap.selection || snap.filters.text.trim()
  );

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

  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const padding = useMemo(
    () => ({
      top: 60,
      right: isMobile ? 16 : (showFeed ? 340 : 20),
      bottom: 60,
      left: isMobile ? 16 : (showStats ? 310 : 20),
    }),
    [isMobile, showStats, showFeed]
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

          {/* Client Device Selector Dropdown */}
          {snap.view.devices.length > 0 && (
            <div className="relative inline-flex items-center">
              <Laptop className="w-3.5 h-3.5 text-[var(--muted)] absolute left-2.5 pointer-events-none" />
              <select
                value={snap.filters.device || ''}
                onChange={(e) => store.setFilters({ device: e.target.value || null })}
                className="pl-7 pr-6 py-1 rounded-full bg-[var(--surface)]/90 backdrop-blur-md border border-[var(--border)] hover:border-[var(--strong-border)] text-xs text-[var(--text)] transition-colors cursor-pointer shadow-md focus:outline-hidden font-medium max-w-[140px] sm:max-w-[170px] truncate"
                title="Filter map to a specific client device"
              >
                <option value="">All Devices ({snap.view.devices.length})</option>
                {snap.view.devices.map((dev) => (
                  <option key={dev} value={dev}>
                    {dev}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3 h-3 text-[var(--muted)] absolute right-2 pointer-events-none" />
            </div>
          )}
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

          {/* Time Window Selector (15m, 1h, 6h, 24h) */}
          <div className="hidden sm:flex items-center gap-1 p-0.5 rounded-lg bg-[var(--surface)]/90 backdrop-blur-md border border-[var(--border)] shadow-md text-xs">
            {[
              { label: '15m', val: 15 },
              { label: '1h', val: 60 },
              { label: '6h', val: 360 },
              { label: '24h', val: 1440 },
            ].map((opt) => (
              <button
                key={opt.val}
                type="button"
                onClick={() => {
                  store.setWindowMinutes(opt.val);
                  localStorage.setItem('agh_atlas_window', String(opt.val));
                }}
                className={`px-2 py-0.5 rounded-md font-semibold font-mono text-[11px] transition-colors cursor-pointer ${
                  snap.windowMinutes === opt.val
                    ? 'bg-[var(--button-bg)] text-[var(--button-text)] shadow-xs'
                    : 'text-[var(--muted)] hover:text-[var(--text)]'
                }`}
                title={`Show queries from past ${opt.label}`}
              >
                {opt.label}
              </button>
            ))}
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
          ref={mapRef}
          store={store}
          config={clientConfig}
          padding={padding}
          places={snap.view.places}
          selection={snap.selection}
          paused={snap.paused}
          theme="dark"
          labels={labels}
        />

        {/* Floating Bottom-Right Zoom & Reset Controls */}
        <div className="absolute bottom-4 right-4 z-20 flex flex-col gap-1.5 pointer-events-auto">
          <button
            type="button"
            onClick={() => mapRef.current?.zoomIn()}
            className="p-2 rounded-lg bg-[var(--surface)]/90 backdrop-blur-md border border-[var(--border)] hover:border-[var(--strong-border)] hover:bg-[var(--surface-2)] text-[var(--text)] transition-colors cursor-pointer shadow-md"
            title="Zoom In"
            aria-label="Zoom In"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => mapRef.current?.zoomOut()}
            className="p-2 rounded-lg bg-[var(--surface)]/90 backdrop-blur-md border border-[var(--border)] hover:border-[var(--strong-border)] hover:bg-[var(--surface-2)] text-[var(--text)] transition-colors cursor-pointer shadow-md"
            title="Zoom Out"
            aria-label="Zoom Out"
          >
            <Minus className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => mapRef.current?.resetZoom()}
            className="p-2 rounded-lg bg-[var(--surface)]/90 backdrop-blur-md border border-[var(--border)] hover:border-[var(--strong-border)] hover:bg-[var(--surface-2)] text-[var(--text)] transition-colors cursor-pointer shadow-md"
            title="Reset Map View"
            aria-label="Reset Map View"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Floating Center: Active Filter Indicators */}
      {hasActiveFilters && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 p-1 px-2.5 rounded-full bg-[var(--surface)]/95 backdrop-blur-md border border-[var(--border)] shadow-xl text-xs pointer-events-auto animate-fade-in max-w-[90vw] overflow-x-auto no-scrollbar">
          <span className="text-[10px] uppercase font-bold tracking-wider text-[var(--muted)] pl-1 hidden sm:inline">
            Filters:
          </span>

          {snap.filters.device && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--surface-2)] border border-[var(--border)] text-xs text-[var(--text)] shadow-2xs">
              <Laptop className="w-3 h-3 text-[var(--green)]" />
              <span className="font-mono text-[11px] truncate max-w-[110px]">{snap.filters.device}</span>
              <button
                type="button"
                onClick={() => store.setFilters({ device: null })}
                className="hover:text-[var(--red)] cursor-pointer ml-0.5"
                title="Clear device filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}

          {snap.selection && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--surface-2)] border border-[var(--border)] text-xs text-[var(--text)] shadow-2xs">
              <Globe className="w-3 h-3 text-[var(--green)]" />
              <span className="font-medium truncate max-w-[130px]">
                {snap.selection.kind === 'country' ? snap.selection.name : snap.view.detail?.title || 'Selected place'}
              </span>
              <button
                type="button"
                onClick={() => store.select(null)}
                className="hover:text-[var(--red)] cursor-pointer ml-0.5"
                title="Clear location filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}

          {snap.filters.text && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--surface-2)] border border-[var(--border)] text-xs text-[var(--text)] shadow-2xs">
              <span className="font-mono text-[11px] truncate max-w-[110px]">"{snap.filters.text}"</span>
              <button
                type="button"
                onClick={() => store.setFilters({ text: '' })}
                className="hover:text-[var(--red)] cursor-pointer ml-0.5"
                title="Clear search filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}

          <button
            type="button"
            onClick={() => {
              store.setFilters({ device: null, text: '' });
              store.select(null);
            }}
            className="text-[11px] text-[var(--muted)] hover:text-[var(--red)] px-1.5 py-0.5 font-medium cursor-pointer"
            title="Reset all filters"
          >
            Reset all
          </button>
        </div>
      )}

      {/* Floating Left: Statistics HUD */}
      {showStats && (
        <div className="absolute top-14 left-3 z-20 pointer-events-auto animate-fade-in max-h-[calc(100%-70px)] overflow-y-auto no-scrollbar">
          <StatsHUD
            store={store}
            snap={snap}
            windowMinutes={snap.windowMinutes}
            onClose={() => setShowStats(false)}
          />
        </div>
      )}

      {/* Floating Right: Live Query Feed Panel */}
      {showFeed && (
        <div className="absolute top-14 right-3 z-20 pointer-events-auto animate-fade-in">
          <LiveFeedPanel
            store={store}
            snap={snap}
            onClose={() => setShowFeed(false)}
          />
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

            {/* Quick Auto-Detect button */}
            <button
              type="button"
              onClick={handleAutoDetect}
              disabled={detecting}
              className="w-full flex items-center justify-center gap-2 py-1.5 px-3 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--surface-3)] border border-[var(--border)] hover:border-[var(--strong-border)] text-xs text-[var(--text)] transition-colors cursor-pointer font-medium disabled:opacity-60"
            >
              {detecting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--green)]" />
              ) : (
                <Crosshair className="w-3.5 h-3.5 text-[var(--green)]" />
              )}
              <span>{detecting ? 'Detecting your coordinates…' : 'Auto-Detect My Location'}</span>
            </button>

            {detectMsg && (
              <p className="text-[11px] text-[var(--green)] font-medium text-center">{detectMsg}</p>
            )}

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
