import type { CSSProperties, ReactNode } from 'react';
import { placeKey, type AtlasStore, type Row, type Snapshot } from './store';
import { ClassGlyph, Domain, countryFlag, fmt, fmtCompact, fmtShare, fmtTime, whereOf } from './AtlasBits';
import { X } from 'lucide-react';

interface PanelProps {
  store: AtlasStore;
  snap: Snapshot;
  windowMinutes: number;
  privacyForced?: boolean;
  onClose?: () => void;
}

const barWidthStyle = (fraction: number): CSSProperties => ({
  width: `${Math.max(4, Math.min(100, fraction * 100))}%`,
});

function Sparkline({ buckets }: { buckets: Snapshot['view']['buckets'] }) {
  const max = Math.max(1, ...buckets.map((b) => b[0] + b[1] + b[2]));
  return (
    <div className="flex items-end gap-[2px] h-9 w-full py-1" aria-hidden>
      {buckets.map((b, i) => {
        const total = b[0] + b[1] + b[2];
        const hPct = total === 0 ? 0 : Math.max(8, (total / max) * 100);
        const blockedPct = total === 0 ? 0 : (b[1] / total) * 100;
        return (
          <div
            key={i}
            className="flex-1 rounded-xs overflow-hidden transition-all duration-300"
            style={{
              height: `${hPct}%`,
              background: total === 0 ? 'var(--surface-3)' : blockedPct > 50 ? 'var(--red)' : 'var(--green)',
              opacity: total === 0 ? 0.3 : 0.85,
            }}
          />
        );
      })}
    </div>
  );
}

function TopList({
  title,
  rows,
  render,
  onPick,
  hint,
  mono,
}: {
  title: string;
  rows: Row[];
  render: (row: Row) => ReactNode;
  onPick: (row: Row) => void;
  hint: string;
  mono?: boolean;
}) {
  const max = rows[0]?.count ?? 1;
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] uppercase font-bold tracking-wider text-[var(--muted)]">{title}</div>
      {rows.length === 0 ? (
        <p className="text-xs text-[var(--muted)] italic py-1">No activity yet</p>
      ) : (
        <div className="space-y-1">
          {rows.map((row) => (
            <button
              key={row.key}
              type="button"
              onClick={() => onPick(row)}
              title={hint}
              className="w-full text-left group flex items-center justify-between gap-2 p-1.5 rounded-lg bg-[var(--surface-2)]/70 hover:bg-[var(--surface-2)] border border-transparent hover:border-[var(--border)] transition-colors cursor-pointer relative overflow-hidden"
            >
              {/* Background fill proportional to count */}
              <div
                className="absolute inset-y-0 left-0 bg-[var(--surface-3)]/60 rounded-lg pointer-events-none transition-all duration-300"
                style={barWidthStyle(row.count / max)}
              />
              <span className={`relative text-xs truncate z-10 ${mono ? 'font-mono text-[11px]' : 'font-medium'} text-[var(--text)]`}>
                {render(row)}
              </span>
              <div className="relative flex items-center gap-1.5 shrink-0 z-10 font-mono text-[11px] text-[var(--muted)]">
                {row.blocked > 0 && (
                  <span className="text-[9px] px-1 rounded bg-[var(--red-bg)] text-[var(--red)] border border-[var(--red)]/30 font-semibold">
                    {row.blocked} blocked
                  </span>
                )}
                <span>{fmtCompact(row.count)}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function StatsHUD({ store, snap, windowMinutes, onClose }: PanelProps) {
  const { view } = snap;
  const activeWin = snap.windowMinutes || windowMinutes || 60;
  const windowLabel = activeWin >= 60 ? `${activeWin / 60}h` : `${activeWin}m`;

  return (
    <div className="bg-[var(--surface)]/90 backdrop-blur-md border border-[var(--border)] rounded-xl p-3.5 space-y-3.5 text-[var(--text)] shadow-xl w-72 max-w-[calc(100vw-32px)]">
      {/* Time Window Selector & Close */}
      <div className="flex items-center justify-between pb-2 border-b border-[var(--border)] gap-2">
        <span className="text-[10px] uppercase font-bold tracking-wider text-[var(--muted)]">Window</span>
        <div className="flex items-center gap-1">
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[10px] font-mono">
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
                className={`px-1.5 py-0.5 rounded transition-colors cursor-pointer ${
                  activeWin === opt.val
                    ? 'bg-[var(--button-bg)] text-[var(--button-text)] font-bold shadow-xs'
                    : 'text-[var(--muted)] hover:text-[var(--text)]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-md text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
              title="Close Stats HUD"
              aria-label="Close Stats HUD"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 gap-2 pb-2.5 border-b border-[var(--border)]">
        <div>
          <span className="text-[10px] uppercase font-bold tracking-wider text-[var(--muted)]">
            Queries ({windowLabel})
          </span>
          <div className="text-xl font-bold font-mono tracking-tight text-[var(--text)]">
            {fmtCompact(view.total)}
          </div>
          <span className="text-[10px] text-[var(--muted)] font-mono">
            {fmt(view.perMinute)}/min
          </span>
        </div>
        <div>
          <span className="text-[10px] uppercase font-bold tracking-wider text-[var(--muted)]">
            Blocked
          </span>
          <div className="text-xl font-bold font-mono tracking-tight text-[var(--red)]">
            {fmtShare(view.blockedShare)}
          </div>
          <span className="text-[10px] text-[var(--muted)] font-mono">
            {fmt(view.byClass.blocked)} refused
          </span>
        </div>
      </div>

      {/* Query Volume Sparkline */}
      <div>
        <div className="flex items-center justify-between text-[10px] text-[var(--muted)] font-mono mb-1">
          <span>Activity Timeline</span>
          <span>-{windowLabel} → now</span>
        </div>
        <Sparkline buckets={view.buckets} />
      </div>

      {/* Top Countries Bar Chart */}
      <TopList
        title={`Destinations (${view.countries} countries)`}
        rows={view.topCountries}
        render={(r) => (
          <span className="flex items-center gap-1.5">
            <span className="text-xs leading-none" role="img" aria-label={r.label}>
              {countryFlag(r.cc)}
            </span>
            <span className="truncate">{r.label}</span>
          </span>
        )}
        onPick={(r) => store.select({ kind: 'country', cc: r.cc ?? '', name: r.label })}
        hint="Click to filter map to this country"
      />

      {/* Top Domains */}
      <TopList
        title="Top Requested Domains"
        rows={view.topDomains}
        render={(r) => <Domain value={r.label} privacy={snap.privacy} />}
        onPick={(r) => store.setFilters({ text: r.label })}
        hint="Click to search queries for this domain"
        mono
      />
    </div>
  );
}

export function LiveFeedPanel({
  store,
  snap,
  onClose,
}: {
  store: AtlasStore;
  snap: Snapshot;
  onClose?: () => void;
}) {
  const { view } = snap;

  return (
    <div className="bg-[var(--surface)]/90 backdrop-blur-md border border-[var(--border)] rounded-xl p-3 text-[var(--text)] shadow-xl w-80 max-w-[calc(100vw-32px)] flex flex-col h-[380px]">
      <div className="flex items-center justify-between pb-2 border-b border-[var(--border)] shrink-0">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--green)] opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--green)]" />
          </span>
          <span className="text-xs font-bold tracking-tight text-[var(--text)]">Live Query Stream</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-[var(--muted)]">{view.feed.length} logged</span>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-md text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
              title="Close Live Stream"
              aria-label="Close Live Stream"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Scrollable feed items */}
      <div className="flex-1 overflow-y-auto space-y-1.5 pt-2 pr-1 no-scrollbar text-xs">
        {view.feed.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-[var(--muted)] italic">
            Waiting for DNS queries…
          </div>
        ) : (
          view.feed.map((e) => (
            <div
              key={e.id}
              role="button"
              tabIndex={0}
              onKeyDown={(evt) => {
                if (evt.key === 'Enter' || evt.key === ' ') {
                  evt.preventDefault();
                  if (e.dest) store.select({ kind: 'place', key: placeKey(e.dest) });
                }
              }}
              onClick={() => e.dest && store.select({ kind: 'place', key: placeKey(e.dest) })}
              className="p-1.5 rounded-lg bg-[var(--surface-2)]/60 hover:bg-[var(--surface-2)] border border-transparent hover:border-[var(--border)] transition-colors cursor-pointer group focus:outline-hidden focus:border-[var(--text)]"
            >
              <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <ClassGlyph cls={e.cls} size={11} />
                  <span className="font-mono text-[11px] truncate text-[var(--text)] group-hover:text-white">
                    {e.domain}
                  </span>
                </div>
                <span className="text-[10px] font-mono text-[var(--muted)] shrink-0">{fmtTime(e.t)}</span>
              </div>
              <div className="flex items-center justify-between gap-1 mt-0.5 text-[10px] text-[var(--muted)]">
                <span className="truncate">{e.client}</span>
                <span className="truncate text-right font-medium text-[var(--text-2)]">{whereOf(e)}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function SelectionDrawer({ store, snap }: { store: AtlasStore; snap: Snapshot }) {
  const { detail } = snap.view;
  const { selection } = snap;
  if (!detail || !selection) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-80 max-w-full bg-[var(--surface)] border-l border-[var(--border)] shadow-2xl p-4 flex flex-col justify-between animate-fade-in">
      <div className="space-y-4 overflow-y-auto pr-1">
        <div className="flex items-start justify-between border-b border-[var(--border)] pb-3">
          <div>
            <h3 className="text-base font-bold text-[var(--text)] tracking-tight flex items-center gap-1.5">
              {selection.kind === 'country' && selection.cc && (
                <span className="text-base leading-none">{countryFlag(selection.cc)}</span>
              )}
              <span>{detail.title}</span>
            </h3>
            {detail.subtitle && <p className="text-xs text-[var(--muted)]">{detail.subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={() => store.select(null)}
            className="p-1 rounded-md text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] cursor-pointer"
            aria-label="Close details"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-2.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)]">
          <div className="text-[10px] uppercase font-bold text-[var(--muted)]">Total Queries</div>
          <div className="text-xl font-bold font-mono text-[var(--text)]">{fmt(detail.total)}</div>
        </div>

        {/* Domains that resolved to this country/place */}
        <TopList
          title="Top Domains Target"
          rows={detail.domains}
          render={(r) => <Domain value={r.label} privacy={snap.privacy} />}
          onPick={(r) => store.setFilters({ text: r.label })}
          hint="Click to filter by domain"
          mono
        />

        {/* Devices targeting this place */}
        <TopList
          title="Querying Devices"
          rows={detail.devices}
          render={(r) => <span>{r.label}</span>}
          onPick={(r) => store.setFilters({ device: r.label })}
          hint="Click to filter by device"
        />

        {detail.cities.length > 0 && (
          <TopList
            title="Cities / Locations"
            rows={detail.cities}
            render={(r) => <span>{r.label}</span>}
            onPick={(r) => store.select({ kind: 'place', key: r.key })}
            hint="Click to focus on city"
          />
        )}
      </div>

      <div className="pt-3 border-t border-[var(--border)]">
        <button
          type="button"
          onClick={() => store.select(null)}
          className="w-full secondary-btn text-xs py-2 cursor-pointer"
        >
          Clear Selection
        </button>
      </div>
    </div>
  );
}
